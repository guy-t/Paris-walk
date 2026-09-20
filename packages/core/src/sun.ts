/**
 * Sunrise and sunset, so the hiking app can warn that the ETA is after dark.
 *
 * The NOAA low-precision algorithm: good to about a minute, which is well
 * inside the uncertainty of any walking estimate, and it needs no network and
 * no timezone database — the returned Date objects are absolute instants, so
 * the browser renders them in the viewer's local time for free.
 *
 * Two bugs from the single-file version are fixed here, and both are worth
 * knowing about because both produced plausible-looking wrong answers:
 *
 *  1. A stray `- 0.5` in the Julian date conversion, which shifted every
 *     result by half a day.
 *  2. No rounding to a whole day. The algorithm's `n` is meant to be a whole
 *     number of days since J2000 — it selects *which day* to solve for. Left
 *     as a fraction, the answer slides with the time of day you ask: the same
 *     hike showed a sunset of 06:53 at breakfast and 00:22 in the evening.
 *
 * Together those happened to cancel out at 12:00 UTC and nowhere else, which
 * is why the app looked roughly right if you ever checked it at lunchtime.
 */

const RAD = Math.PI / 180;
const DAY_MS = 864e5;

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

/**
 * Sunrise and sunset for a place, on the local calendar day of `date`.
 *
 * Returns null inside the polar circles on days when the sun does not cross
 * the horizon at all.
 *
 * The day is taken from `date` in the *viewer's* local calendar, which is
 * what someone means by "today's sunset" — not the UTC day, which would roll
 * over mid-evening for anyone east of Greenwich.
 */
export function sunTimes(lat: number, lon: number, date: Date = new Date()): SunTimes | null {
  // Anchor on midday of the local calendar day, so the answer does not depend
  // on what time of day it happens to be when we ask.
  const midday = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const jd = midday.getTime() / DAY_MS + 2440587.5;
  const n = Math.round(jd - 2451545 + 0.0008); // whole days since J2000

  const jStar = n - lon / 360; // mean solar noon at this longitude
  const M = (357.5291 + 0.98560028 * jStar) % 360; // solar mean anomaly
  const C =
    1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360; // ecliptic longitude
  const jTransit =
    2451545 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.44 * RAD));

  // -0.833° is the sun's own radius plus atmospheric refraction, which is how
  // sunset is conventionally defined.
  const cosH =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) /
    (Math.cos(lat * RAD) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null; // polar day or polar night

  const H = Math.acos(cosH) / RAD / 360; // hour angle, as a fraction of a day
  const toDate = (j: number) => new Date((j - 2440587.5) * DAY_MS);
  return { sunrise: toDate(jTransit - H), sunset: toDate(jTransit + H) };
}
