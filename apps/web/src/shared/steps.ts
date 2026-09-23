/**
 * The phone's step counter, where there is one and the walker allows it.
 *
 * Android-only, like the barometer: no shipping web API exposes a step
 * counter, which is exactly the kind of gap the native shell exists to fill.
 * In a browser every call here says "no" and the app does without.
 *
 * Reading is a pull, for the same reason as the barometer: the sensor is a
 * cumulative register, so asking for it on the app's own schedule loses
 * nothing. What it gains is a measurement that keeps arriving when the
 * satellites stop — the register counts in hardware whether or not anyone is
 * listening, so it spans a pocket and a cliff alike.
 *
 * Unlike the barometer it needs asking for. From Android 10, reading the
 * counter needs ACTIVITY_RECOGNITION, which is a runtime permission and
 * therefore a question — so `present()` says the sensor exists and
 * `available()` says it can actually be read, and nobody is asked until they
 * turn the setting on.
 */

import type { StepReading } from "@slownav/core";

interface StepsBridge {
  present?: () => boolean;
  available?: () => boolean;
  read?: () => string | null;
}

interface PermissionBridge {
  granted?: () => boolean;
  request?: () => void;
}

function bridge(): StepsBridge | undefined {
  return (globalThis as { SlowNavSteps?: StepsBridge }).SlowNavSteps;
}

function permission(): PermissionBridge | undefined {
  return (globalThis as { SlowNavStepPermission?: PermissionBridge }).SlowNavStepPermission;
}

/** The event the shell fires once the walker has answered the permission. */
export const STEPS_EVENT = "slownav:steps";

/** True where the sensor exists, whether or not it may be read yet. */
export function stepCounterPresent(): boolean {
  try {
    return bridge()?.present?.() === true;
  } catch {
    return false;
  }
}

/** True only where it can actually be read: the sensor is there and permitted. */
export function stepCounterAvailable(): boolean {
  try {
    return bridge()?.available?.() === true;
  } catch {
    return false;
  }
}

/**
 * Ask for the counter, if it has not been asked for already.
 *
 * Returns immediately; the answer arrives as a `STEPS_EVENT` on `window`,
 * after which `stepCounterAvailable()` tells the truth. It is deliberately
 * not a promise: a permission dialog can be dismissed by rotating the phone,
 * and a promise that never settles is worse than an event that never fires.
 */
export function requestStepCounter(): void {
  try {
    if (permission()?.granted?.() === true) return;
    permission()?.request?.();
  } catch {
    /* no shell, or no such sensor: the caller already handles "no" */
  }
}

/** The latest count, or null before one has arrived — or ever, in a browser. */
export function readSteps(): StepReading | null {
  try {
    const raw = bridge()?.read?.();
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { steps, at } = parsed as { steps?: unknown; at?: unknown };
    // A count is a non-negative integer. Anything else is a fault, and a
    // fault must not become a distance on a dashboard.
    if (typeof steps !== "number" || !Number.isFinite(steps) || steps < 0) return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    return { steps: Math.round(steps), at };
  } catch {
    return null;
  }
}
