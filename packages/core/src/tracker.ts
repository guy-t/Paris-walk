/**
 * Turning a stream of GPS fixes into a position on the route.
 *
 * The hard part is not the matching (see `match.ts`) but deciding when to
 * *believe* it. A phone in a street canyon or under a cliff will hand you a
 * fix 80 m sideways, then a good one, then another bad one. If every fix moved
 * the walker, the instructions would thrash between "turn left" and "you are
 * off the route". So this tracker confirms changes over several fixes before
 * acting on them:
 *
 *  - `confirmOff` consecutive off-route fixes before declaring off-route;
 *  - `confirmOn` consecutive on-route fixes before trusting a recovery;
 *  - `confirmJump` fixes agreeing on a large jump before re-syncing to it —
 *    which is how a loop that revisits a street gets resolved correctly;
 *  - anything less accurate than `weakAccuracy` is held, not matched at all,
 *    because a fix vaguer than the spacing of the streets cannot tell you
 *    which street you are on.
 *
 * The tracker holds no DOM and no browser API. It takes fixes in and returns
 * state out, which is what makes it testable against synthetic tracks — and
 * what will let a native Android build feed it barometer-corrected fixes
 * without any of this changing.
 */

import { bearing, haversine, type AnyPoint, type LatLon } from "./geo.js";
import { positionAt, project, type Match, type MatchOptions } from "./match.js";

/** A position fix, from the browser's Geolocation API or a native provider. */
export interface Fix {
  lat: number;
  lon: number;
  /** Radius of 68% confidence, metres. */
  accuracy: number;
  altitude?: number | null;
  /** Metres per second, if the provider gives it. */
  speed?: number | null;
  /** Degrees from north, if the provider gives it. */
  heading?: number | null;
  /** Milliseconds since the epoch. */
  timestamp: number;
}

export interface TrackerConfig {
  /** Scoring options for `project` — `HIKE_MATCH` or `WALK_MATCH`. */
  match: MatchOptions;
  /**
   * Fixes less accurate than this are held: position updates, but the route
   * position does not move. 80 m for city streets, 120 m in the mountains
   * where there is nothing nearby to confuse it with.
   */
  weakAccuracy: number;
  /**
   * Distance from the line that counts as off-route. A number, or a function
   * of the fix accuracy — the Paris walk uses `max(35, accuracy × 0.7)` so a
   * vague fix does not on its own trigger a detour.
   */
  offThreshold: number | ((accuracy: number) => number);
  /** Consecutive on-route fixes before a recovery is trusted. 1 disables confirmation. */
  confirmOn: number;
  /** Consecutive off-route fixes before off-route is declared. 1 disables confirmation. */
  confirmOff: number;
  /** Consecutive fixes agreeing on a jump before re-syncing. 1 disables confirmation. */
  confirmJump: number;
  /** A global match this far from the current progress counts as a jump, metres. */
  jumpMin: number;
  /**
   * Beyond this distance from the line, progress is not updated at all — the
   * match is too far away to mean anything. Null to always update.
   */
  maxSnap: number | null;
  /** Below this speed the provider's own heading is noise, m/s. */
  headingMinSpeed: number;
  /** Minimum movement between two fixes to derive a heading from them, metres. */
  headingMinMove: number;
  /** How many recent fixes to keep for deriving heading. */
  historySize: number;
}

/**
 * The hiking app's behaviour: a wide match window, no confirmation counters.
 *
 * `confirm*: 1` reproduces the original app exactly — it acted on every fix.
 * Raising these to 2/3/3 (as the walk config does) would make it steadier on a
 * ridge, but it is a change to live GPS behaviour and should be tried on a
 * real walk before being adopted.
 */
export const HIKE_TRACKING: Omit<TrackerConfig, "match"> = {
  weakAccuracy: 120,
  offThreshold: 50,
  confirmOn: 1,
  confirmOff: 1,
  confirmJump: 1,
  jumpMin: 250,
  maxSnap: 250,
  headingMinSpeed: 0.5,
  headingMinMove: 12,
  historySize: 8,
};

/** The Paris walk's behaviour: tight thresholds, full confirmation. */
export const WALK_TRACKING: Omit<TrackerConfig, "match"> = {
  weakAccuracy: 80,
  offThreshold: (acc) => Math.max(35, acc * 0.7),
  confirmOn: 2,
  confirmOff: 3,
  confirmJump: 3,
  jumpMin: 250,
  maxSnap: null,
  headingMinSpeed: 0.6,
  headingMinMove: 8,
  historySize: 8,
};

export interface TrackerState {
  /** Raw position of the latest fix. */
  pos: LatLon;
  accuracy: number;
  altitude: number | null;
  /** Metres per second — the provider's, or derived from the fix history. */
  speed: number | null;
  /** Degrees from north, or null while stationary. */
  heading: number | null;
  /** Metres along the planned line. */
  progress: number;
  /** True once off-route has been confirmed. */
  offRoute: boolean;
  /** Lateral distance to the line at the latest fix, metres. */
  offDistance: number;
  /** Bearing from here to the line, when off-route — which way to walk back. */
  offBearing: number | null;
  /** The fix was too vague to match; position moved but progress did not. */
  weak: boolean;
  /** Progress jumped to a different part of the route this fix. */
  resynced: boolean;
  /** The match this state came from, or null if the fix was held. */
  match: Match | null;
}

interface HistoryEntry {
  pos: LatLon;
  t: number;
}

export class RouteTracker {
  private readonly line: readonly AnyPoint[];
  private readonly cum: readonly number[];
  private readonly cfg: TrackerConfig;

  private history: HistoryEntry[] = [];
  private headingValue: number | null = null;
  /** True until a fix has been confidently placed on the route. */
  private lost = true;
  private onCount = 0;
  private offCount = 0;
  private jumpCount = 0;

  /** Metres along the line. Survives weak fixes and gaps unchanged. */
  progress = 0;
  offRoute = false;

  constructor(line: readonly AnyPoint[], cum: readonly number[], cfg: TrackerConfig) {
    this.line = line;
    this.cum = cum;
    this.cfg = cfg;
  }

  /** Forget the fix history — after a pause, where the next fix may be far away. */
  reset(): void {
    this.history = [];
    this.headingValue = null;
    this.lost = true;
    this.onCount = 0;
    this.offCount = 0;
    this.jumpCount = 0;
  }

  /** Declare where we are, e.g. when a saved session is resumed. */
  anchor(progress: number): void {
    this.progress = progress;
    this.lost = false;
    this.onCount = this.cfg.confirmOn;
    this.offCount = 0;
    this.jumpCount = 0;
  }

  get heading(): number | null {
    return this.headingValue;
  }

  private threshold(accuracy: number): number {
    const t = this.cfg.offThreshold;
    return typeof t === "function" ? t(accuracy) : t;
  }

  /**
   * Update the heading.
   *
   * The provider's own heading is only meaningful while actually moving —
   * standing still, it is the direction of the last noise. So below
   * `headingMinSpeed` the heading is derived from the fix history instead,
   * looking back to the most recent fix at least `headingMinMove` away.
   */
  private updateHeading(fix: Fix, pos: LatLon): void {
    if (fix.heading != null && !isNaN(fix.heading) && (fix.speed ?? 0) > this.cfg.headingMinSpeed) {
      this.headingValue = fix.heading;
      return;
    }
    for (let i = this.history.length - 2; i >= 0; i--) {
      if (haversine(this.history[i].pos, pos) >= this.cfg.headingMinMove) {
        this.headingValue = bearing(this.history[i].pos, pos);
        return;
      }
    }
  }

  /** Speed from the provider, or derived across the fix history. */
  private deriveSpeed(fix: Fix, pos: LatLon): number | null {
    if (fix.speed != null && !isNaN(fix.speed)) return fix.speed;
    const oldest = this.history[0];
    if (!oldest) return null;
    const dt = (fix.timestamp - oldest.t) / 1000;
    return dt > 4 ? haversine(oldest.pos, pos) / dt : null;
  }

  /**
   * Feed in a fix and get the resulting state.
   *
   * Never throws and never leaves the tracker in a broken state: a fix that
   * cannot be matched simply leaves `progress` where it was.
   */
  update(fix: Fix): TrackerState {
    const pos: LatLon = [fix.lat, fix.lon];
    const accuracy = fix.accuracy || 50;

    const base: TrackerState = {
      pos,
      accuracy,
      altitude: fix.altitude ?? null,
      speed: null,
      heading: this.headingValue,
      progress: this.progress,
      offRoute: this.offRoute,
      offDistance: 0,
      offBearing: null,
      weak: false,
      resynced: false,
      match: null,
    };

    // Too vague to say which path we are on. Show the position, hold everything else.
    if (accuracy > this.cfg.weakAccuracy) return { ...base, weak: true };

    this.history.push({ pos, t: fix.timestamp });
    if (this.history.length > this.cfg.historySize) this.history.shift();
    this.updateHeading(fix, pos);
    const speed = this.deriveSpeed(fix, pos);

    const threshold = this.threshold(accuracy);
    const windowed = project(this.line, this.cum, pos, {
      ...this.cfg.match,
      lastProgress: this.progress,
      heading: this.headingValue,
      global: this.lost,
    });
    if (!windowed) return { ...base, speed, heading: this.headingValue };

    let progress = this.progress;
    let offRoute = this.offRoute;
    let offDistance = windowed.dist;
    let resynced = false;
    let match = windowed;

    if (windowed.dist <= threshold) {
      // On the route.
      this.onCount++;
      this.offCount = 0;
      this.jumpCount = 0;
      if (this.lost || this.onCount >= this.cfg.confirmOn) {
        this.lost = false;
        progress = windowed.prog;
        offRoute = false;
      }
    } else {
      this.onCount = 0;
      this.offCount++;

      // We might be on the route after all, just not where the window looked —
      // the other pass of a loop, or a stretch walked while the screen was off.
      const global = project(this.line, this.cum, pos, {
        ...this.cfg.match,
        global: true,
        heading: this.headingValue,
      });
      if (global && global.dist <= threshold && Math.abs(global.prog - this.progress) > this.cfg.jumpMin) {
        this.jumpCount++;
        if (this.jumpCount >= this.cfg.confirmJump) {
          this.jumpCount = 0;
          this.offCount = 0;
          this.lost = false;
          progress = global.prog;
          offRoute = false;
          offDistance = global.dist;
          resynced = true;
          match = global;
        }
      } else {
        this.jumpCount = 0;
      }

      if (!resynced && this.offCount >= this.cfg.confirmOff) {
        offRoute = true;
        // A small wander off the pavement still makes progress along the line.
        const near = this.cfg.maxSnap == null ? 150 : Math.min(150, this.cfg.maxSnap);
        if (windowed.dist < near && windowed.prog >= this.progress - 30) progress = windowed.prog;
      }
    }

    // A match hundreds of metres away is not evidence of anything.
    if (this.cfg.maxSnap != null && match.dist > this.cfg.maxSnap) progress = this.progress;

    this.progress = progress;
    this.offRoute = offRoute;

    // Which way is the route from here?
    let offBearing: number | null = null;
    if (offRoute) {
      const target = positionAt(
        this.line,
        this.cum,
        Math.min(this.cum[this.cum.length - 1], match.prog + 10),
      ).pos;
      offBearing = bearing(pos, target);
    }

    return {
      pos,
      accuracy,
      altitude: fix.altitude ?? null,
      speed,
      heading: this.headingValue,
      progress,
      offRoute,
      offDistance,
      offBearing,
      weak: false,
      resynced,
      match,
    };
  }
}

/** Build a tracker configured the way the hiking app was. */
export function hikeTracker(
  line: readonly AnyPoint[],
  cum: readonly number[],
  match: MatchOptions,
  overrides: Partial<TrackerConfig> = {},
): RouteTracker {
  return new RouteTracker(line, cum, { ...HIKE_TRACKING, match, ...overrides });
}

/** Build a tracker configured the way the Paris walk was. */
export function walkTracker(
  line: readonly AnyPoint[],
  cum: readonly number[],
  match: MatchOptions,
  overrides: Partial<TrackerConfig> = {},
): RouteTracker {
  return new RouteTracker(line, cum, { ...WALK_TRACKING, match, ...overrides });
}
