/**
 * Steps, and the one thing they are good for that GPS is not.
 *
 * A phone's step counter is a hardware register that counts since the last
 * reboot, at almost no power, and — the point here — it keeps counting under
 * a cliff, in a pocket, and while the app is asleep. Satellites do none of
 * that. So when the fixes go vague and the route position is held, the step
 * count is the only measurement of the walk that is still arriving.
 *
 * What it cannot do is say *where* the walker is. Steps give a distance along
 * the ground, not a position on a line, and a walker who has taken a wrong
 * turn has walked just as far. So nothing here ever moves the route position:
 * it produces a number the screen can offer alongside "position 8 min old",
 * for the walker to act on by swiping the cue if it looks right.
 *
 * The stride is measured rather than asked for. Height is a poor predictor of
 * it and nobody wants a setup question; the walk itself supplies both terms —
 * metres of confident progress over steps taken in the same stretch. It is
 * kept per walker rather than per hike, so it is already calibrated on day 2.
 */

/** A cumulative count from the phone's own counter, and when it was read. */
export interface StepReading {
  /** Steps since the phone last rebooted. Monotonic, and large. */
  steps: number;
  at: number;
}

/** What the walk has taught us about this walker's stride. */
export interface Stride {
  /** Metres of confident progress accumulated. */
  metres: number;
  /** Steps taken over the same stretch. */
  steps: number;
}

/**
 * The stride to assume before the walk has measured one.
 *
 * 0.72 m is a middling adult walking stride on the flat. It is deliberately
 * not presented as accurate — `strideOf` says whether it has been measured,
 * and the UI says "about" either way.
 */
export const DEFAULT_STRIDE_M = 0.72;

/**
 * The range a walking stride can be in.
 *
 * Outside it the sample is not a walker: a chairlift adds metres with no
 * steps, a stationary phone in a rucksack adds steps with no metres, and a
 * route-position re-sync can add hundreds of metres in one fix. Any of those
 * folded into the average would poison it for the rest of the week.
 */
export const MIN_STRIDE_M = 0.4;
export const MAX_STRIDE_M = 1.1;

/** Steps before the ratio means anything. About 300 m of walking. */
export const STRIDE_MIN_STEPS = 400;

export function newStride(): Stride {
  return { metres: 0, steps: 0 };
}

/**
 * Fold one stretch of walking into the stride, if it looks like walking.
 *
 * Returns the same object unchanged when the sample is implausible, so a
 * caller can tell whether anything was learnt.
 */
export function addStride(s: Stride, metres: number, steps: number): Stride {
  if (!Number.isFinite(metres) || !Number.isFinite(steps)) return s;
  if (metres <= 0 || steps <= 0) return s;
  const implied = metres / steps;
  if (implied < MIN_STRIDE_M || implied > MAX_STRIDE_M) return s;
  return { metres: s.metres + metres, steps: s.steps + steps };
}

/** The stride to use, and whether it came from the walk or from the default. */
export function strideOf(s: Stride): { metres: number; measured: boolean } {
  if (s.steps < STRIDE_MIN_STEPS || s.metres <= 0) {
    return { metres: DEFAULT_STRIDE_M, measured: false };
  }
  const raw = s.metres / s.steps;
  return {
    metres: Math.min(MAX_STRIDE_M, Math.max(MIN_STRIDE_M, raw)),
    measured: true,
  };
}

/** Roughly how far `steps` steps carried this walker, in metres. */
export function distanceFromSteps(steps: number, s: Stride): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0;
  return steps * strideOf(s).metres;
}

/**
 * Steps between two readings of a counter that counts since boot.
 *
 * A reboot mid-walk resets it to zero, and the phone that has just been
 * rebooted has not walked backwards — so a fall is no steps, not a negative
 * number that would wreck the session total.
 */
export function stepsBetween(from: StepReading | null, to: StepReading | null): number {
  if (!from || !to) return 0;
  const d = to.steps - from.steps;
  return d > 0 ? d : 0;
}

/**
 * The fastest a walker's feet go. Running is about 180; 220 is nobody.
 *
 * Above it the two numbers being divided do not belong to each other — a
 * phone shaken in a rucksack, or a counter that reported a backlog in one
 * event after the sensor was re-registered. Either way the honest answer is
 * that there is no cadence to give, not a four-figure one on a dashboard.
 */
export const MAX_CADENCE = 220;

/**
 * Steps per minute across two readings, or null when there is no interval
 * worth dividing by.
 *
 * Cadence is what tells a walker whether they are still walking, which the
 * GPS-derived speed cannot say while the fixes are too vague to place.
 */
export function cadence(from: StepReading | null, to: StepReading | null): number | null {
  if (!from || !to) return null;
  const mins = (to.at - from.at) / 60000;
  if (mins < 0.25) return null;
  const rate = stepsBetween(from, to) / mins;
  return rate > MAX_CADENCE ? null : rate;
}
