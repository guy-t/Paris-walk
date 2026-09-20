/**
 * Plane geometry on the sphere, at the scale a walker or a boat cares about.
 *
 * Everything here works on `[lat, lon]` (with an optional third element for
 * elevation), because that is how the GPX files, the Overpass replies and
 * Leaflet all speak. Distances come back in metres.
 *
 * Where the maths projects to a local plane it uses the flat-earth
 * approximation (111320 m per degree of longitude at the equator, 110540 m per
 * degree of latitude). Over the few kilometres these apps ever measure at once
 * the error is well under a metre, and it is fast enough to run on every GPS
 * fix on a phone.
 */

export type LatLon = [lat: number, lon: number];
/** A track point: latitude, longitude, and elevation in metres. */
export type Point3 = [lat: number, lon: number, ele: number];
/** Anything positional — `project` and friends only ever read [0] and [1]. */
export type AnyPoint = readonly [number, number, ...number[]];

/** Mean earth radius in metres. */
export const EARTH_RADIUS = 6371000;

const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversine(a: AnyPoint, b: AnyPoint): number {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(s));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north. */
export function bearing(a: AnyPoint, b: AnyPoint): number {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

/** "north", "southeast", … for a bearing in degrees. Used in spoken directions. */
export function cardinal(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Metres per degree of longitude at this latitude. */
export function metresPerLon(lat: number): number {
  return Math.cos(toRad(lat)) * 111320;
}

/** Metres per degree of latitude (near enough constant). */
export const METRES_PER_LAT = 110540;

/**
 * Ramer–Douglas–Peucker simplification with a tolerance in metres.
 *
 * Used both to shrink imported GPX (3 m) and to thin a line before asking
 * Overpass about a corridor around it (80–200 m), where sending every point
 * would make the query enormous.
 */
export function simplify<T extends AnyPoint>(pts: readonly T[], tolM: number): T[] {
  if (pts.length < 3) return pts.slice();
  const cosLat = Math.cos(toRad(pts[0][0]));
  const xy = pts.map((p) => [p[1] * cosLat * 111320, p[0] * METRES_PER_LAT] as const);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2));
      const d = Math.hypot(xy[i][0] - (ax + t * dx), xy[i][1] - (ay + t * dy));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolM) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** Running distance along a line: `cum[i]` is the distance from the start to point i. */
export function cumulative(line: readonly AnyPoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum[i] = cum[i - 1] + haversine(line[i - 1], line[i]);
  return cum;
}

/** Shortest distance in metres from a point to a polyline. */
export function distanceToLine(p: AnyPoint, pts: readonly AnyPoint[]): number {
  let best = Infinity;
  const cosLat = Math.cos(toRad(p[0]));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const bx = (b[1] - a[1]) * cosLat * 111320;
    const by = (b[0] - a[0]) * METRES_PER_LAT;
    const px = (p[1] - a[1]) * cosLat * 111320;
    const py = (p[0] - a[0]) * METRES_PER_LAT;
    const len2 = bx * bx + by * by || 1e-9;
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best) best = d;
  }
  return best;
}
