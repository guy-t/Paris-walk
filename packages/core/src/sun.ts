/**
 * Sunrise and sunset, so the hiking app can warn that the ETA is after dark.
 *
 * The NOAA low-precision algorithm: good to about a minute, which is far
 * inside the uncertainty of any walking estimate, and it needs no network and
 * no timezone database — the returned Date objects are absolute instants, so
 * the browser formats them in local time for free.
 */

const RAD = Math.PI / 180;
const DAY_MS = 864e5;

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

/**
 * Sunrise and sunset for a place and day, or null inside the polar circles
 * when the sun does not cross the horizon at all.
 */
export function sunTimes(lat: number, lon: number, date: Date = new Date()): SunTimes | null {
  // Unix epoch to Julian date. The single-file apps carried a spurious extra
  // -0.5 here, which put every sunrise and sunset exactly twelve hours out and
  // so made the hiking app's "after dark" warning fire all afternoon.
  const jd = date.getTime() / DAY_MS + 2440587.5;
  const n = jd - 2451545 + 0.0008;
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360; // solar mean anomaly
  const C =
    1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360; // ecliptic longitude
  const jTransit =
    2451545 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.44 * RAD));
  // -0.833° accounts for refraction and the sun's disc, as NOAA defines it.
  const cosH =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) /
    (Math.cos(lat * RAD) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null; // polar day or polar night
  const H = Math.acos(cosH) / RAD / 360;
  const toDate = (j: number) => new Date((j - 2440587.5) * DAY_MS);
  return { sunrise: toDate(jTransit - H), sunset: toDate(jTransit + H) };
}
