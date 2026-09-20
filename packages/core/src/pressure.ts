/**
 * The barometer: height that does not jitter, and weather that is coming.
 *
 * GPS altitude is the worst number the phone produces — ±10-20 m on a good
 * day, worse under a cliff — so a climb rate derived from it is mostly
 * noise. Pressure changes smoothly and fast with height (about 1 hPa per
 * 8.5 m near sea level), which makes it far better at "am I still going up,
 * and how quickly".
 *
 * What it cannot do alone is tell you where you are. Absolute barometric
 * height needs a sea-level reference, and that reference moves with the
 * weather — 30 hPa between a deep low and a strong high is 250 m of error.
 * So the forecast's `pressure_msl` is used as the reference when there is
 * one, and the result is honest about which it used.
 *
 * The same instrument answers a second question for free, and in the
 * mountains it is the more important one: pressure falling steadily means
 * the weather is on its way in, hours before it is visible.
 */

/** A reading, and when it was taken. */
export interface PressureSample {
  /** Station pressure at the phone, hPa. */
  hPa: number;
  /** ms since epoch. */
  at: number;
}

/** Standard atmosphere sea-level pressure, hPa. */
export const STANDARD_MSL = 1013.25;

/**
 * Height from pressure, by the international barometric formula.
 *
 * With no reference this is "pressure altitude": right about *changes*,
 * possibly a long way out in absolute terms. Give it the sea-level pressure
 * from the forecast and it becomes a real altitude.
 */
export function altitudeFromPressure(hPa: number, mslHPa: number = STANDARD_MSL): number {
  if (!(hPa > 0) || !(mslHPa > 0)) return NaN;
  return 44330 * (1 - Math.pow(hPa / mslHPa, 1 / 5.255));
}

/** The reverse: what a barometer should read at this height. */
export function pressureAtAltitude(metres: number, mslHPa: number = STANDARD_MSL): number {
  return mslHPa * Math.pow(1 - metres / 44330, 5.255);
}

/**
 * Sea-level pressure implied by a reading taken at a known height.
 *
 * Used the other way round from the forecast: standing at a point on the
 * route whose elevation is known, the barometer can calibrate itself.
 */
export function mslFromReading(hPa: number, metres: number): number {
  return hPa / Math.pow(1 - metres / 44330, 5.255);
}

/** Keep the history small: three hours at a sample a minute, and a little slack. */
export const HISTORY_CAP = 240;

/**
 * Add a reading, dropping anything older than the window and keeping the
 * list bounded. Samples closer together than a minute are ignored — the
 * trend is measured in hours and storage is not free.
 */
export function addSample(
  history: readonly PressureSample[],
  sample: PressureSample,
  windowMs = 4 * 3600_000,
): PressureSample[] {
  const last = history.at(-1);
  if (last && sample.at - last.at < 60_000) return [...history];
  return [...history, sample]
    .filter((s) => sample.at - s.at <= windowMs)
    .slice(-HISTORY_CAP);
}

export type TrendDirection = "rising" | "falling" | "steady" | "unknown";

export interface PressureTrend {
  direction: TrendDirection;
  /** Change over the window, hPa. Negative is falling. */
  deltaHPa: number;
  /** Hours the change was measured over — less than asked for early on. */
  overHours: number;
  /** One line for a walker, not a forecaster. */
  note: string;
}

/**
 * Which way the pressure is going, and what that means on a hill.
 *
 * The thresholds are the conventional ones for a three-hour change: under
 * 1 hPa is noise, 1-3 is a change worth knowing, over 3 is weather arriving
 * or clearing quickly. Under an hour of readings says "unknown" rather than
 * guessing from two minutes of data.
 */
export function pressureTrend(
  history: readonly PressureSample[],
  now = Date.now(),
  windowMs = 3 * 3600_000,
): PressureTrend {
  const recent = history.filter((s) => now - s.at <= windowMs);
  const first = recent[0];
  const last = recent.at(-1);
  const overHours = first && last ? (last.at - first.at) / 3600_000 : 0;

  if (!first || !last || overHours < 1) {
    return {
      direction: "unknown",
      deltaHPa: 0,
      overHours,
      note: "Not enough readings yet — give it an hour.",
    };
  }

  const deltaHPa = last.hPa - first.hPa;
  // Scale to a full three hours so the wording means the same thing at 1 h
  // of history as at 3 h.
  const perThree = (deltaHPa / overHours) * 3;

  if (Math.abs(perThree) < 1) {
    return { direction: "steady", deltaHPa, overHours, note: "Steady — no change on the way." };
  }
  if (perThree <= -3) {
    return {
      direction: "falling",
      deltaHPa,
      overHours,
      note: "Falling quickly — weather coming in. Worth shortening the day.",
    };
  }
  if (perThree < 0) {
    return { direction: "falling", deltaHPa, overHours, note: "Falling — turning wetter." };
  }
  if (perThree >= 3) {
    return { direction: "rising", deltaHPa, overHours, note: "Rising quickly — clearing." };
  }
  return { direction: "rising", deltaHPa, overHours, note: "Rising — settling down." };
}
