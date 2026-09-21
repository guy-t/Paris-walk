/**
 * The hiking app's own domain: settings, the library of tracks, and the ETA.
 */

import {
  DEFAULT_PROVIDER_ID,
  hashStr,
  interp,
  positionAt,
  processTrack,
  project,
  repairElevation,
  store,
  type Point3,
  type ProcessedTrack,
  type Session,
  type Units,
  type Waypoint,
} from "@slownav/core";
import embedded from "./tracks.json";

export const APP = "hike";

export interface HikeSettings {
  units: Units;
  /** Flat-ground walking pace, km/h — what the Tobler estimate is scaled to. */
  pace: number;
  /** Distance from the track that counts as off it, metres. */
  off: number;
  /** Buzz when going off track. */
  vib: boolean;
  /** Warn when the ETA falls after sunset. */
  sun: boolean;
  /** Hold the screen awake while tracking. */
  wake: boolean;
  /** Chosen base map, by provider id. */
  provider: string;
  /** Draw sights on the map. Off declutters it without losing the list. */
  showSights: boolean;
  /**
   * Start tracking as soon as a hike is open.
   *
   * On by default: the app is opened at the start of a walk far more often
   * than it is browsed at home, and having to remember a button before
   * setting off is exactly the kind of thing you remember an hour later.
   */
  gpsOnOpen: boolean;
}

/**
 * Which base maps this app prefers, best first.
 *
 * The hiking app's routes are in the Picos, so the Spanish national survey is
 * the right default where it reaches — a coordinate cannot be relied on to
 * say which country's agency to trust near a border, but the app knows what
 * it is for. An imported GPX from elsewhere falls through to OpenTopoMap.
 */
export const PREFERRED_PROVIDERS = ["ign-es", "opentopo"] as const;

export const DEFAULT_SETTINGS: HikeSettings = {
  units: "metric",
  pace: 5,
  off: 50,
  vib: true,
  sun: true,
  wake: false,
  provider: DEFAULT_PROVIDER_ID,
  showSights: true,
  gpsOnOpen: true,
};

export function loadSettings(): HikeSettings {
  return { ...DEFAULT_SETTINGS, ...(store.get<Partial<HikeSettings>>("hike:settings") ?? {}) };
}

export function saveSettings(s: HikeSettings): void {
  store.set("hike:settings", s);
}

export interface Hike {
  id: string;
  name: string;
  pts: Point3[];
  wpts?: Waypoint[];
  /** True for the tracks shipped with the app, which cannot be deleted. */
  builtin?: boolean;
}

/** A waypoint with its distance along the track worked out. */
export interface WaypointAt extends Waypoint {
  prog: number;
}

/**
 * The embedded Picos tracks, plus anything the walker has imported.
 *
 * Elevations are repaired on the way out: one of the shipped tracks begins
 * with six points recorded before the device had an altitude fix, which
 * otherwise reads as a phantom kilometre of climb.
 */
export const library = {
  list(): Hike[] {
    const stored = store.get<Hike[]>("hike:library");
    // Anything but an array means the key was left in a state nothing here
    // wrote; the built-in hikes still have to come back.
    const custom = Array.isArray(stored) ? stored : [];
    const builtin = (embedded as Hike[]).map((h) => ({
      ...h,
      pts: repairElevation(h.pts),
      builtin: true,
    }));
    return [...builtin, ...custom];
  },
  get(id: string): Hike | undefined {
    return this.list().find((h) => h.id === id);
  },
  /**
   * Add a hike, replacing one with the same id.
   *
   * `idFor` derives the id from the file, so importing the same route twice
   * is meant to be idempotent — but this used to push regardless, leaving
   * two rows with one id and a delete that removed both. Opening a route
   * straight from an email makes re-importing the same file the ordinary
   * case rather than a slip, so it has to hold.
   */
  add(h: Hike): boolean {
    const stored = store.get<Hike[]>("hike:library");
    const custom = (Array.isArray(stored) ? stored : []).filter((x) => x.id !== h.id);
    custom.push(h);
    // store.set returns false rather than throwing — a full quota, or site
    // data switched off. This used to be dropped on the floor, so a failed
    // save looked exactly like a successful one: the app said "Imported",
    // and the hike was not in the list, then or ever. Whether that is fatal
    // is the caller's to decide, but it has to be told.
    return store.set("hike:library", custom);
  },
  remove(id: string): void {
    store.set(
      "hike:library",
      (store.get<Hike[]>("hike:library") ?? []).filter((h) => h.id !== id),
    );
  },
  /** A stable id for an imported file, so importing it twice does not duplicate it. */
  idFor(filename: string, pointCount: number): string {
    return `gpx:${hashStr(filename + pointCount)}`;
  },
};

/** Place a hike's waypoints along its track, dropping any that are nowhere near it. */
export function waypointsAlong(track: ProcessedTrack, wpts: readonly Waypoint[]): WaypointAt[] {
  return wpts
    .map((w, i): WaypointAt | null => {
      const p = project(track.pts, track.cum, [w.lat, w.lon], { global: true });
      if (!p || p.dist >= 300) return null;
      return { ...w, name: w.name || `Waypoint ${i + 1}`, prog: p.prog };
    })
    .filter((w): w is WaypointAt => w !== null);
}

export function prepare(h: Hike, paceKmh: number): ProcessedTrack {
  return processTrack(h.pts, paceKmh);
}

export interface Eta {
  /** Seconds remaining. */
  seconds: number;
  at: Date;
  /** What the estimate is based on — shown so the number can be trusted or not. */
  basis: "planned pace" | "your pace today";
  /** Tobler's own prediction for the remaining distance, unscaled. */
  toblerLeft: number;
}

/** Only calibrate to the walker's own pace after this much moving time, seconds. */
const CALIBRATE_AFTER_S = 20 * 60;
/** …and this much distance, metres. Below either, the sample is noise. */
const CALIBRATE_AFTER_M = 800;

/**
 * Time to the end of the track.
 *
 * Starts from Tobler's hiking function over the remaining profile, then — once
 * there is enough of a sample — scales it by how this walker is actually
 * doing today against what Tobler predicted for the ground already covered.
 * A heavy pack, deep snow or a hangover all show up here without anyone
 * having to tell the app about them.
 *
 * The scaling is clamped to 0.5–3×: beyond that the sample is more likely to
 * be wrong than the walker is to be that fast or that slow.
 */
export function eta(
  track: ProcessedTrack,
  progress: number,
  session: Session | null,
  now = Date.now(),
): Eta {
  const { idx, t } = positionAt(track.pts, track.cum, progress);
  const toblerDone = interp(track.tobCum, idx, t);
  const toblerLeft = track.tobler - toblerDone;

  let factor = 1;
  let basis: Eta["basis"] = "planned pace";

  if (session && session.moving > CALIBRATE_AFTER_S && session.dist > CALIBRATE_AFTER_M) {
    // What did Tobler predict for the stretch this session actually walked?
    const from = positionAt(track.pts, track.cum, Math.max(0, progress - session.dist));
    const predicted = toblerDone - interp(track.tobCum, from.idx, from.t);
    const elapsed = (now - session.start) / 1000;
    if (predicted > 300) {
      factor = Math.min(3, Math.max(0.5, elapsed / predicted));
      basis = "your pace today";
    }
  }

  const seconds = toblerLeft * factor;
  return { seconds, at: new Date(now + seconds * 1000), basis, toblerLeft };
}
