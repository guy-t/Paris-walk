/**
 * Turning a list of GPX points into everything the dashboards need: distance,
 * a smoothed elevation profile, cumulative climb, and a time estimate.
 */

import { cumulative, haversine, type AnyPoint, type Point3 } from "./geo.js";

export interface ProcessedTrack {
  pts: readonly Point3[];
  /** Distance from the start to each point, metres. */
  cum: number[];
  /** Smoothed elevation at each point, metres. */
  ele: number[];
  /** Total length, metres. */
  length: number;
  /** Total ascent and descent, metres. */
  up: number;
  down: number;
  /** Ascent and descent accumulated up to each point. */
  upCum: number[];
  downCum: number[];
  /** Tobler-predicted seconds elapsed at each point, and for the whole track. */
  tobCum: number[];
  tobler: number;
  minEle: number;
  maxEle: number;
}

/**
 * Tobler's hiking function, rescaled so that flat ground matches the walker's
 * own pace rather than Tobler's 5.04 km/h.
 *
 * The original is 6·exp(−3.5·|slope + 0.1|) km/h, which peaks on a gentle
 * *descent* — walking downhill is faster than on the flat, up to a point. This
 * uses 0.05 rather than Tobler's 0.1 because the tracks here are steeper than
 * the alpine roads he fitted, and the floor of 0.15 m/s stops a cliff-edge
 * data spike predicting an infinite ETA.
 *
 * @param slope rise over run, so 0.1 is a 10% gradient
 * @param paceKmh the walker's pace on the flat, km/h
 */
export function toblerSpeed(slope: number, paceKmh: number): number {
  const base = paceKmh / 3.6;
  const rel = Math.exp(-3.5 * Math.abs(slope + 0.05)) / Math.exp(-3.5 * 0.05);
  return Math.max(0.15, base * rel);
}

/**
 * Measure a track.
 *
 * Elevation is smoothed over a 5-point window before anything is derived from
 * it: raw GPS/SRTM elevation jitters by several metres between neighbouring
 * points, and summing those jitters would report hundreds of metres of climb
 * on flat ground. Ascent then only accumulates once the height has moved 3 m
 * from the last reference point, which is the same idea applied a second time.
 */
export function processTrack(pts: readonly Point3[], paceKmh: number): ProcessedTrack {
  const n = pts.length;
  const cum = cumulative(pts);
  const ele = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      s += pts[j][2] || 0;
      c++;
    }
    ele[i] = s / c;
  }

  let up = 0;
  let down = 0;
  let ref = ele[0];
  const upCum = [0];
  const downCum = [0];
  for (let i = 1; i < n; i++) {
    const d = ele[i] - ref;
    if (d >= 3) {
      up += d;
      ref = ele[i];
    } else if (d <= -3) {
      down -= d;
      ref = ele[i];
    }
    upCum[i] = up;
    downCum[i] = down;
  }

  let tobler = 0;
  const tobCum = [0];
  for (let i = 1; i < n; i++) {
    const dd = cum[i] - cum[i - 1];
    const slope = dd > 0 ? (ele[i] - ele[i - 1]) / dd : 0;
    tobler += dd / toblerSpeed(slope, paceKmh);
    tobCum[i] = tobler;
  }

  return {
    pts,
    cum,
    ele,
    length: cum[n - 1],
    up,
    down,
    upCum,
    downCum,
    tobCum,
    tobler,
    minEle: Math.min(...ele),
    maxEle: Math.max(...ele),
  };
}

/** Straight-line length of a line, for lines with no elevation. */
export function lineLength(line: readonly AnyPoint[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i]);
  return d;
}

/**
 * Repair missing elevations before a track is measured.
 *
 * A GPS device that has not yet resolved altitude writes no `<ele>` at all,
 * and GPX readers — including this one — turn that into 0. On a mountain
 * track that is not a low reading, it is a *missing* one, and treating it as
 * real is expensive: the Fuente Dé valley circuit began with six such points,
 * which the profile read as a 1000 m climb out of nowhere. That inflated the
 * total ascent, the "climb left" tile, and the Tobler estimate (a 300% slope
 * pins the predicted speed at its floor for those segments).
 *
 * The heuristic: a value of exactly 0 is missing when the track's median
 * elevation is well above sea level. That deliberately leaves genuine
 * sea-level tracks — a canal, a coastal path — untouched, where 0 means 0.
 *
 * Leading and trailing runs take the nearest real value; interior runs are
 * interpolated across the gap.
 */
export function repairElevation(pts: readonly Point3[], seaLevelThreshold = 50): Point3[] {
  const out = pts.map((p) => [p[0], p[1], p[2]] as Point3);
  const real = out.map((p) => p[2]).filter((e) => e !== 0);
  if (real.length === 0 || real.length === out.length) return out;

  // If this track lives at sea level, 0 is a real reading and not a gap.
  const median = real.slice().sort((a, b) => a - b)[Math.floor(real.length / 2)];
  if (Math.abs(median) < seaLevelThreshold) return out;

  const known: number[] = [];
  for (let i = 0; i < out.length; i++) if (out[i][2] !== 0) known.push(i);
  const first = known[0];
  const last = known[known.length - 1];

  for (let i = 0; i < out.length; i++) {
    if (out[i][2] !== 0) continue;
    if (i < first) {
      out[i][2] = out[first][2];
    } else if (i > last) {
      out[i][2] = out[last][2];
    } else {
      // Interior gap: interpolate between the readings either side.
      let lo = i;
      while (lo >= 0 && out[lo][2] === 0) lo--;
      let hi = i;
      while (hi < out.length && out[hi][2] === 0) hi++;
      const span = hi - lo;
      out[i][2] = Math.round(out[lo][2] + ((out[hi][2] - out[lo][2]) * (i - lo)) / span);
    }
  }
  return out;
}
