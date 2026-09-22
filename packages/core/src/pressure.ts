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

/** A reading, when it was taken, and how high the phone was. */
export interface PressureSample {
  /** Station pressure at the phone, hPa. */
  hPa: number;
  /** ms since epoch. */
  at: number;
  /**
   * Height the reading was taken at, metres — the walker's position on the
   * route, not the barometer's own answer.
   *
   * Without it the trend cannot tell a walk uphill from a depression, and
   * the walk wins every time: pressure falls about 1 hPa per 8.5 m, so
   * climbing 26 m in three hours reads as the conventional "falling
   * quickly" threshold, and day 2's 745 m of ascent reads as -84 hPa —
   * nearly three times the whole span from a deep low to a strong high.
   */
  ele?: number | null;
  /**
   * Air temperature there, °C, from the forecast.
   *
   * Optional, and the reduction falls back to the standard column without
   * it — but a standard reduction leaves a residual that grows with height,
   * so on a cold day a long climb can still read as weather.
   */
  tempC?: number | null;
}

/** Standard atmosphere sea-level pressure, hPa. */
export const STANDARD_MSL = 1013.25;

/** …and its temperature: 15 °C at sea level, falling 6.5 °C per kilometre. */
const LAPSE_K_PER_M = 0.0065;
const STANDARD_SEA_LEVEL_K = 288.15;

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

/**
 * Correct a pressure altitude for the air not being at standard temperature.
 *
 * The barometric formula assumes 15 °C at sea level falling 6.5 °C/km, and
 * the height it returns is wrong by the ratio of the real mean temperature
 * of the air column to that assumption. It is the largest error left once
 * the sea-level pressure is known, and it runs the intuitive way: cold air
 * is dense, so the pressure at a given height is lower than standard and the
 * formula reads high. At 1900 m on a −5 °C morning — the top of the Fuente
 * Dé cable car in October — that is +53 m; at 1100 m on a 20 °C afternoon
 * it is −45 m.
 *
 * `metres` is the uncorrected height, which is a good enough first guess for
 * the column it stands in: one pass gets within a couple of metres.
 *
 * @param tempC air temperature where the walker is, from the forecast.
 */
export function correctForTemperature(metres: number, tempC: number): number {
  if (!Number.isFinite(metres) || !Number.isFinite(tempC)) return metres;
  const half = (LAPSE_K_PER_M * metres) / 2;
  const meanReal = tempC + 273.15 + half;
  const meanStandard = STANDARD_SEA_LEVEL_K - half;
  if (!(meanReal > 0) || !(meanStandard > 0)) return metres;
  return metres * (meanReal / meanStandard);
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
 *
 * Give it the air temperature and the reduction uses the column that is
 * actually there rather than the standard one. That matters more than it
 * sounds: the residual of a standard reduction scales with height, so on a
 * day 20 °C off standard a 745 m climb still leaves 3.4 hPa behind — which
 * is the whole "falling quickly" threshold, and would have the app
 * announcing a storm on the ascent all over again. With the real
 * temperature the hill cancels exactly.
 */
export function mslFromReading(hPa: number, metres: number, tempC?: number | null): number {
  if (tempC == null || !Number.isFinite(tempC)) {
    return hPa / Math.pow(1 - metres / 44330, 5.255);
  }
  // Temperature at sea level implied by the reading's own temperature,
  // lapsing at the standard 6.5 °C/km.
  const seaLevelK = tempC + 273.15 + LAPSE_K_PER_M * metres;
  const hereK = seaLevelK - LAPSE_K_PER_M * metres;
  if (!(hereK > 0) || !(seaLevelK > 0)) return hPa / Math.pow(1 - metres / 44330, 5.255);
  return hPa * Math.pow(seaLevelK / hereK, 5.255);
}

/**
 * The sea-level pressure a sample implies, or null when its height is unknown.
 *
 * This is the number the weather actually moves. Reducing every reading to
 * sea level before comparing them is what separates the weather from the
 * walk: the hill cancels out, and what is left is the depression coming
 * over the Picos.
 */
export function reduceToMsl(s: PressureSample): number | null {
  if (s.ele == null || !Number.isFinite(s.ele)) return null;
  return mslFromReading(s.hPa, s.ele, s.tempC);
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

/** The middle value, which one bad reading cannot drag. */
function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** How much of each end of the window is averaged, to keep one reading from deciding. */
const ENDS_MS = 15 * 60_000;

/**
 * Which way the *weather* is going, and what that means on a hill.
 *
 * On sea-level-reduced pressure, never on what the barometer reads. Reported
 * from the hill: walking uphill made the app announce a storm, and it was
 * right to — on raw pressure a climb is indistinguishable from a depression,
 * and far larger. 1 hPa is 8.5 m, so 26 m of ascent in three hours is the
 * whole "falling quickly" threshold and day 2's 745 m of climb is -84 hPa,
 * against the roughly 30 hPa that separates a deep low from a strong high.
 * Reducing each reading to sea level with the height it was taken at cancels
 * the hill and leaves the weather.
 *
 * A reading whose height is unknown is dropped rather than mixed in: half a
 * series reduced and half not would be worse than no trend at all.
 *
 * Each end of the window is a median over 15 minutes, because a single
 * reading taken in a doorway or a gust should not be what says a storm is
 * coming. The thresholds are the conventional ones for a three-hour change:
 * under 1 hPa is noise, 1-3 is worth knowing, over 3 is weather arriving or
 * clearing quickly.
 */
export function pressureTrend(
  history: readonly PressureSample[],
  now = Date.now(),
  windowMs = 3 * 3600_000,
): PressureTrend {
  const recent = history
    .filter((s) => now - s.at <= windowMs)
    .map((s) => ({ at: s.at, msl: reduceToMsl(s) }))
    .filter((s): s is { at: number; msl: number } => s.msl != null);
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

  const startMsl = median(recent.filter((s) => s.at - first.at <= ENDS_MS).map((s) => s.msl));
  const endMsl = median(recent.filter((s) => last.at - s.at <= ENDS_MS).map((s) => s.msl));
  const deltaHPa = endMsl - startMsl;
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
