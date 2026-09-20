/**
 * A session: what happened on this walk, kept across a phone locking, the
 * browser being backgrounded, and the tab being closed and reopened.
 *
 * The distance walked is accumulated from *progress along the planned line*,
 * not from the straight-line gap between consecutive fixes. That matters more
 * than it sounds: summing raw fix-to-fix distances counts GPS jitter as
 * movement, so a phone resting on a café table accrues a kilometre an hour,
 * and every average derived from it is wrong. Progress along the line only
 * moves when the walker actually moves along the route.
 *
 * The cost of that choice is that walking off the route does not add distance.
 * That is the right trade for this app: the numbers on the dashboard are all
 * about the route, and the recorded trail keeps the literal path anyway.
 */

import { haversine } from "./geo.js";
import type { RecordedPoint } from "./gpx.js";
import { store } from "./storage.js";
import type { Fix } from "./tracker.js";

export interface Session {
  /** Start of the session, ms since epoch. */
  start: number;
  /** Seconds spent actually moving. */
  moving: number;
  /** Metres of progress along the planned line. */
  dist: number;
  /** The last fix accepted, for timing the next one against. */
  lastFix: { lat: number; lon: number; t: number } | null;
  /** The recorded path: [lat, lon, ele, time]. */
  trail: RecordedPoint[];
  /** Furthest progress reached, metres — what a resumed session restarts at. */
  maxProg: number;
  finished: boolean;
}

export interface SessionRecord {
  /** When the session started, ms since epoch. */
  date: number;
  elapsed: number;
  moving: number;
  dist: number;
  trail: RecordedPoint[];
}

export function newSession(start = Date.now()): Session {
  return { start, moving: 0, dist: 0, lastFix: null, trail: [], maxProg: 0, finished: false };
}

/** Below this speed the walker is standing still, m/s. */
const MOVING_SPEED = 0.4;
/** A gap longer than this is a pause, not walking — do not count it as moving time. */
const MAX_GAP_S = 90;
/** Only record a trail point once the walker has moved this far, metres. */
const TRAIL_STEP_M = 8;
/** …or this long, so a rest still leaves a mark on the trail. */
const TRAIL_MAX_GAP_MS = 30000;
/** A single fix cannot legitimately advance progress by more than this, metres. */
const MAX_STEP_M = 400;

export interface SessionUpdate {
  fix: Fix;
  /** Progress after this fix, metres along the line. */
  progress: number;
  /** Progress before this fix. */
  previousProgress: number;
  /** Speed in m/s, if known. */
  speed: number | null;
}

/**
 * Fold one fix into the session. Mutates and returns the same object — it is
 * updated on every fix and allocating a new one each time is waste.
 */
export function applyFix(s: Session, u: SessionUpdate): Session {
  const { fix, progress, previousProgress, speed } = u;
  const now = fix.timestamp;
  const pos: [number, number] = [fix.lat, fix.lon];

  // A fix predating the session start means the clock moved, not the walker.
  if (now < s.start) s.start = now;

  const last = s.lastFix;
  if (last) {
    const dt = (now - last.t) / 1000;
    if (dt > 0 && dt < MAX_GAP_S && (speed ?? 0) > MOVING_SPEED) s.moving += dt;
  }

  if (!last || haversine([last.lat, last.lon], pos) > TRAIL_STEP_M || now - last.t > TRAIL_MAX_GAP_MS) {
    s.trail.push([
      +pos[0].toFixed(6),
      +pos[1].toFixed(6),
      fix.altitude != null ? Math.round(fix.altitude) : null,
      now,
    ]);
  }
  s.lastFix = { lat: pos[0], lon: pos[1], t: now };

  // Only count forward progress, and only a plausible amount of it: a jump is
  // a re-sync to another part of the route, not distance the walker covered.
  const step = progress - previousProgress;
  if (last && step > 0 && step < MAX_STEP_M) s.dist += step;
  s.maxProg = Math.max(s.maxProg, progress);
  return s;
}

/** Seconds since the session began. */
export function elapsed(s: Session, now = Date.now()): number {
  return (now - s.start) / 1000;
}

/** Finish a session and turn it into a record to keep. */
export function toRecord(s: Session, now = Date.now()): SessionRecord {
  return {
    date: s.start,
    elapsed: elapsed(s, now),
    moving: s.moving,
    dist: s.dist,
    trail: s.trail,
  };
}

/**
 * Persistence.
 *
 * Sessions are saved under a per-route key so several routes can be in
 * progress at once, and saved often enough that the worst case — the browser
 * being killed by the OS — loses at most twenty seconds.
 */
export function sessionKey(app: string, routeId: string): string {
  return `${app}:session:${routeId}`;
}

export function loadSession(app: string, routeId: string): Session | null {
  const s = store.get<Session>(sessionKey(app, routeId));
  return s && !s.finished ? s : null;
}

export function saveSession(app: string, routeId: string, s: Session): void {
  store.set(sessionKey(app, routeId), s);
}

export function clearSession(app: string, routeId: string): void {
  store.del(sessionKey(app, routeId));
}

export function records(app: string, routeId: string): SessionRecord[] {
  return store.get<SessionRecord[]>(`${app}:records:${routeId}`) ?? [];
}

export function addRecord(app: string, routeId: string, rec: SessionRecord): void {
  const all = records(app, routeId);
  all.push(rec);
  store.set(`${app}:records:${routeId}`, all);
}
