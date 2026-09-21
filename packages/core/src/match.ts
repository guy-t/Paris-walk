/**
 * Map-matching: where on the planned line is this GPS fix?
 *
 * Naively you would take the nearest point on the line. That fails on every
 * route these apps actually use:
 *
 *  - The Paris loop walks the same streets twice, in opposite directions.
 *  - A hiking circuit returns down the valley it climbed.
 *  - A canal doubles back on itself around a meander.
 *
 * So the nearest point is often the wrong one, and a walker who is 15 m from
 * two stretches of route would see the instructions flip between them. Instead
 * each segment is *scored*: lateral distance, plus a penalty for implying we
 * went backwards, a penalty for implying an implausible jump forwards, and a
 * penalty for pointing against the direction of travel. The best score wins.
 *
 * The scoring constants differ per app and are deliberately not unified —
 * `HIKE_MATCH` and `WALK_MATCH` below reproduce the values each app was tuned
 * with. A mountain track is matched over a wide window because fixes are
 * sparse under tree cover; a city walk uses a tight backward window because
 * street canyons throw fixes sideways, not along.
 */

import { METRES_PER_LAT, type AnyPoint, type LatLon } from "./geo.js";

export interface MatchOptions {
  /** Progress (metres along the line) of the previous match; null to search the whole line. */
  lastProgress?: number | null;
  /** Direction of travel in degrees, if known. Segments pointing the other way are penalised. */
  heading?: number | null;
  /** How far behind `lastProgress` to keep looking, in metres. */
  windowBack?: number;
  /** How far ahead of `lastProgress` to keep looking, in metres. */
  windowAhead?: number;
  /** Search the entire line, ignoring the window and the progress penalties. */
  global?: boolean;
  /** Score added per metre of implied backwards movement. */
  backPenalty?: number;
  /** Metres of forward jump that cost nothing (GPS noise, a missed fix). */
  aheadFree?: number;
  /** Score added per metre of forward jump beyond `aheadFree`. */
  aheadPenalty?: number;
  /** Score added for a segment at 90° to `heading`; doubled at 180°. */
  headingPenalty?: number;
  /** Ignore segments whose start is further than this from the fix, in metres. */
  maxOffset?: number;
  /** Segments shorter than this have too noisy a bearing to judge direction by. */
  minSegForHeading?: number;
  /**
   * Skip scoring a segment once its lateral distance alone already exceeds the
   * best score found so far. A large speed-up on long city routes; off by
   * default because it can pick a different (equally valid) segment among ties.
   */
  prune?: boolean;
}

export interface Match {
  /** Lateral distance from the fix to the line, in metres. */
  dist: number;
  /** Distance along the line, in metres. */
  prog: number;
  /** Index of the segment's first point. */
  idx: number;
  /** How far along that segment, 0..1. */
  t: number;
  /** Bearing of the matched segment, degrees from north. */
  segBearing: number;
  /** Distance plus penalties — for comparing candidates, not for display. */
  score: number;
}

/** Tuning the hiking app was calibrated with: sparse fixes, wide symmetric window. */
export const HIKE_MATCH: MatchOptions = {
  windowBack: 1500,
  windowAhead: 1500,
  backPenalty: 0.08,
  aheadFree: 200,
  aheadPenalty: 0.02,
  headingPenalty: 15,
  minSegForHeading: 2,
};

/** Tuning the Paris walk was calibrated with: tight backwards window, strong direction bias. */
export const WALK_MATCH: MatchOptions = {
  windowBack: 250,
  windowAhead: 2000,
  backPenalty: 0.15,
  aheadFree: 300,
  aheadPenalty: 0.03,
  headingPenalty: 20,
  minSegForHeading: 3,
  prune: true,
};

/**
 * Best match of `pos` onto the line, or null if nothing was in range.
 *
 * `cum` must be the output of `cumulative(line)` — it is passed in rather than
 * recomputed because this runs on every GPS fix.
 */
/**
 * Every place on the line this point could reasonably be.
 *
 * `project` answers "where is this, most likely" and is right for a GPS fix.
 * It is wrong for a waypoint on a track that doubles back on itself, where
 * "most likely" is a coin toss decided by a few metres: the Potes to
 * Cosgaya file holds the main route and the harder option end to end, both
 * start at the monastery, and the single Monastery Santo Toribio waypoint
 * resolves to the harder option's pass — eleven kilometres from where the
 * main route reaches it.
 *
 * So this returns each distinct pass instead: one entry per local minimum of
 * distance to the line, nearest first, ignoring anything further off than
 * `maxDist`. The caller decides which is meant, usually by asking which one
 * agrees with everything else it knows.
 */
export function projectAll(
  line: readonly AnyPoint[],
  cum: readonly number[],
  pos: AnyPoint,
  opts: { maxDist?: number; minGap?: number; limit?: number } = {},
): Array<{ prog: number; dist: number }> {
  const { maxDist = 150, minGap = 500, limit = 8 } = opts;
  if (line.length < 2) return [];
  const cosLat = Math.cos((pos[0] * Math.PI) / 180);

  // Distance to each segment, then the runs that dip below the threshold.
  // A pass is one such run; its best point is where the line comes closest.
  const found: Array<{ prog: number; dist: number }> = [];
  let run: { prog: number; dist: number } | null = null;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const px = (pos[1] - a[1]) * cosLat * 111320;
    const py = (pos[0] - a[0]) * METRES_PER_LAT;
    const bx = (b[1] - a[1]) * cosLat * 111320;
    const by = (b[0] - a[0]) * METRES_PER_LAT;
    const len2 = bx * bx + by * by || 1e-9;
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const d = Math.hypot(px - t * bx, py - t * by);

    if (d > maxDist) {
      if (run) found.push(run);
      run = null;
      continue;
    }
    const prog = (cum[i] ?? 0) + t * Math.sqrt(len2);
    if (!run || d < run.dist) run = { prog, dist: d };
  }
  if (run) found.push(run);

  // A route that loops back within a few hundred metres is one pass, not
  // two — the walker cannot tell them apart and neither can the anchoring.
  const out: Array<{ prog: number; dist: number }> = [];
  for (const f of found.sort((x, y) => x.dist - y.dist)) {
    if (out.some((o) => Math.abs(o.prog - f.prog) < minGap)) continue;
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

export function project(
  line: readonly AnyPoint[],
  cum: readonly number[],
  pos: AnyPoint,
  opts: MatchOptions = {},
): Match | null {
  const {
    lastProgress = null,
    heading = null,
    windowBack = 1500,
    windowAhead = 1500,
    global = false,
    backPenalty = 0.08,
    aheadFree = 200,
    aheadPenalty = 0.02,
    headingPenalty = 15,
    maxOffset = 3000,
    minSegForHeading = 2,
    prune = false,
  } = opts;

  // Windowing and the progress penalties both need somewhere to measure from.
  const anchored = !global && lastProgress != null;
  const cosLat = Math.cos((pos[0] * Math.PI) / 180);
  let best: Match | null = null;

  for (let i = 0; i < line.length - 1; i++) {
    if (anchored && (cum[i + 1] < lastProgress - windowBack || cum[i] > lastProgress + windowAhead)) {
      continue;
    }
    const a = line[i];
    const b = line[i + 1];
    const px = (pos[1] - a[1]) * cosLat * 111320;
    const py = (pos[0] - a[0]) * METRES_PER_LAT;
    if (Math.abs(px) > maxOffset || Math.abs(py) > maxOffset) continue;

    const bx = (b[1] - a[1]) * cosLat * 111320;
    const by = (b[0] - a[0]) * METRES_PER_LAT;
    const len2 = bx * bx + by * by || 1e-9;
    const len = Math.sqrt(len2);
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const d = Math.hypot(px - t * bx, py - t * by);
    if (prune && best && d > best.score + 5) continue;

    const prog = cum[i] + t * len;
    let score = d;
    if (anchored) {
      // Going backwards is usually a mis-match; jumping a long way forward is
      // usually the route doubling back past us.
      score += Math.max(0, lastProgress - prog) * backPenalty;
      score += Math.max(0, prog - lastProgress - aheadFree) * aheadPenalty;
    }
    const segBearing = ((Math.atan2(bx, by) * 180) / Math.PI + 360) % 360;
    if (heading != null && len > minSegForHeading) {
      const diff = Math.abs(((((heading - segBearing) % 360) + 540) % 360) - 180);
      // 0 when travelling along the segment, 2× the penalty when head-on.
      score += (1 - Math.cos((diff * Math.PI) / 180)) * headingPenalty;
    }
    if (!best || score < best.score) best = { score, dist: d, prog, idx: i, t, segBearing };
  }
  return best;
}

/** Nearest point on the line, anywhere — for map taps and for placing sights. */
export function snap(
  line: readonly AnyPoint[],
  cum: readonly number[],
  pos: AnyPoint,
): Match | null {
  return project(line, cum, pos, { global: true });
}

export interface Pass {
  prog: number;
  dist: number;
}

/**
 * Every place the line comes within `maxD` of a point.
 *
 * A loop can pass the same sight twice, and both passes are worth announcing.
 * Passes closer together than 200 m are merged — they are the same approach
 * seen across several segments, not two visits.
 */
export function passesNear(
  line: readonly AnyPoint[],
  cum: readonly number[],
  pos: AnyPoint,
  maxD = 60,
): Pass[] {
  const cosLat = Math.cos((pos[0] * Math.PI) / 180);
  const out: Pass[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const bx = (b[1] - a[1]) * cosLat * 111320;
    const by = (b[0] - a[0]) * METRES_PER_LAT;
    const px = (pos[1] - a[1]) * cosLat * 111320;
    const py = (pos[0] - a[0]) * METRES_PER_LAT;
    if (Math.abs(px) > maxD + 200 || Math.abs(py) > maxD + 200) continue;
    const len2 = bx * bx + by * by || 1e-9;
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d > maxD) continue;
    const prog = cum[i] + t * Math.sqrt(len2);
    const last = out[out.length - 1];
    if (last && prog - last.prog < 200) {
      if (d < last.dist) {
        last.dist = d;
        last.prog = prog;
      }
    } else out.push({ prog, dist: d });
  }
  return out;
}

export interface PositionAt {
  pos: LatLon;
  /** Index of the segment's first point. */
  idx: number;
  /** How far along that segment, 0..1. */
  t: number;
}

/** The point `progress` metres along the line. Binary search, so it is cheap to call often. */
export function positionAt(
  line: readonly AnyPoint[],
  cum: readonly number[],
  progress: number,
): PositionAt {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < progress) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (progress - cum[i - 1]) / seg));
  return {
    pos: [
      line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
      line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
    ],
    idx: i - 1,
    t,
  };
}

/**
 * Read a per-point array (elevation, cumulative climb, Tobler time) at a
 * fractional position returned by `positionAt`.
 */
export function interp(arr: readonly number[], idx: number, t: number): number {
  return arr[idx] + (arr[Math.min(idx + 1, arr.length - 1)] - arr[idx]) * t;
}
