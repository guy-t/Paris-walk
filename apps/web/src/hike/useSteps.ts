/**
 * Steps, and the distance they stand in for when the satellites cannot.
 *
 * Two jobs, and only the second is new. The first is a number for the
 * dashboard, which is what anyone means by "count my steps". The second is
 * what earns the sensor its place: while the route position is held, because
 * every fix is too vague to place, the step count is still arriving — and it
 * can say roughly how far the walker has come since it was last known.
 *
 * It never moves the route position. Steps measure ground covered, not
 * progress along a line, and a walker who took a wrong turn covered just as
 * much. So this produces a number the cue offers beside "position 8 min old",
 * for the walker to act on by swiping if it looks right. That is the rule the
 * barometer already follows: excellent at change, no use as a position, and
 * the UI must never let the two be confused.
 *
 * The stride is measured from the walk rather than asked for, by pairing the
 * session's distance — which is metres of confident progress along the line,
 * already filtered of jumps — with the steps taken over the same interval. A
 * stretch that does not look like walking is rejected rather than averaged
 * in, so a held stretch (steps, no metres) and a re-sync (metres, no steps)
 * both fall out on their own. It is kept per walker rather than per hike, so
 * day 2 starts calibrated.
 */

import {
  addStride,
  cadence as cadenceOf,
  distanceFromSteps,
  newStride,
  stepsBetween,
  store,
  strideOf,
  type StepReading,
  type Stride,
} from "@slownav/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  STEPS_EVENT,
  readSteps,
  stepCounterAvailable,
  stepCounterPresent,
} from "../shared/steps.js";

/** The measured stride belongs to the walker, not to a hike. */
const STRIDE_KEY = "hike:stride";

/**
 * How often to read the counter.
 *
 * Ten seconds. The register is cumulative so nothing is lost by asking
 * rarely, and a cadence over a shorter window than that is mostly
 * quantisation — the sensor reports in whole steps when it feels like it.
 */
const READ_EVERY_MS = 10000;

/** Cadence is measured across this much of the recent past. */
const CADENCE_WINDOW_MS = 90000;

export interface StepsState {
  /** The sensor exists, is permitted, and the walker has turned it on. */
  available: boolean;
  /** The sensor exists but has not been allowed yet, so it can be asked for. */
  askable: boolean;
  /** Steps since tracking began, or null before the first reading. */
  walked: number | null;
  /** Steps a minute over the last minute and a half, or null while still. */
  cadence: number | null;
  /** This walker's stride in metres, and whether the walk measured it. */
  stride: { metres: number; measured: boolean };
  /**
   * Roughly how far the walker has come since the route position was last
   * placed. Null unless the counter is running and the position is held.
   */
  heldDistance: number | null;
}

function loadStride(): Stride {
  const stored = store.get<Partial<Stride>>(STRIDE_KEY);
  if (
    !stored ||
    typeof stored.metres !== "number" ||
    typeof stored.steps !== "number" ||
    !Number.isFinite(stored.metres) ||
    !Number.isFinite(stored.steps)
  ) {
    return newStride();
  }
  return { metres: stored.metres, steps: stored.steps };
}

export interface UseStepsOptions {
  /** True while the app is taking fixes. Nothing is counted otherwise. */
  tracking: boolean;
  /** Whether the walker has turned the counter on. */
  enabled: boolean;
  /** Seconds since the route position last came from a fix. */
  heldFor: number;
  /** The session's distance so far, metres — the stride's other term. */
  dist: number;
}

export function useSteps({ tracking, enabled, heldFor, dist }: UseStepsOptions): StepsState {
  const [present, setPresent] = useState(() => stepCounterPresent());
  const [allowed, setAllowed] = useState(() => stepCounterAvailable());
  const [latest, setLatest] = useState<StepReading | null>(null);
  const [stride, setStride] = useState<Stride>(loadStride);

  /** The reading tracking began at, which the session total counts from. */
  const opened = useRef<StepReading | null>(null);
  /** Readings kept only long enough to derive a cadence from. */
  const recent = useRef<StepReading[]>([]);
  /** The reading at the moment the route position was last placed. */
  const placed = useRef<StepReading | null>(null);
  /** The last pair the stride was sampled from. */
  const sampled = useRef<{ reading: StepReading; dist: number } | null>(null);

  // Read through refs so the sampler is not torn down and restarted every
  // time the walker moves a few metres.
  const heldRef = useRef(heldFor);
  heldRef.current = heldFor;
  const distRef = useRef(dist);
  distRef.current = dist;

  // The shell fires this once the walker has answered the permission dialog.
  useEffect(() => {
    const recheck = () => {
      setPresent(stepCounterPresent());
      setAllowed(stepCounterAvailable());
    };
    window.addEventListener(STEPS_EVENT, recheck);
    return () => window.removeEventListener(STEPS_EVENT, recheck);
  }, []);

  const available = present && allowed && enabled;

  useEffect(() => {
    if (!available || !tracking) return;
    const take = () => {
      const now = readSteps();
      if (!now) return;
      opened.current ??= now;
      setLatest(now);

      const keep = recent.current.filter((r) => now.at - r.at <= CADENCE_WINDOW_MS);
      keep.push(now);
      recent.current = keep;

      // Where the route position was last known. A fix that placed the walker
      // reports `heldFor` of zero, so the count from that moment is what the
      // held distance is measured against.
      if (heldRef.current === 0 || placed.current == null) placed.current = now;

      // And one stride sample per interval. A held stretch contributes no
      // metres, a re-sync no steps, and `addStride` refuses both.
      const was = sampled.current;
      sampled.current = { reading: now, dist: distRef.current };
      if (!was) return;
      const metres = distRef.current - was.dist;
      const steps = stepsBetween(was.reading, now);
      setStride((s) => {
        const next = addStride(s, metres, steps);
        if (next !== s) store.set(STRIDE_KEY, next);
        return next;
      });
    };
    take();
    const id = setInterval(take, READ_EVERY_MS);
    return () => clearInterval(id);
  }, [available, tracking]);

  // A new walk counts from where it started, not from the last one.
  useEffect(() => {
    if (tracking) return;
    opened.current = null;
    placed.current = null;
    sampled.current = null;
    recent.current = [];
    setLatest(null);
  }, [tracking]);

  const cadence = useMemo(() => {
    const kept = recent.current;
    return cadenceOf(kept[0] ?? null, kept[kept.length - 1] ?? null);
    // `latest` is the trigger: the array itself is a ref and does not change
    // identity when a reading is appended.
  }, [latest]);

  return useMemo(
    () => ({
      available,
      askable: present && !allowed,
      walked: available && latest ? stepsBetween(opened.current, latest) : null,
      cadence,
      stride: strideOf(stride),
      heldDistance:
        available && latest && heldFor > 0
          ? distanceFromSteps(stepsBetween(placed.current, latest), stride)
          : null,
    }),
    [available, present, allowed, latest, cadence, stride, heldFor],
  );
}
