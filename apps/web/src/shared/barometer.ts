/**
 * The phone's barometer, where there is one.
 *
 * Only the Android shell can reach it: there is no barometer in any shipping
 * web API, which is exactly the kind of thing the native shell exists for.
 * In a browser every call here says "no", and the app simply does without —
 * the same shape as every other capability in `platform.ts`.
 *
 * Reading is a pull. The sensor fires far more often than anything here
 * cares about, so the native side keeps the latest value and this asks for
 * it on the app's own schedule, which is once a minute: pressure moves over
 * hours, and the trend is what it is for.
 */

import type { PressureSample } from "@slownav/core";

interface BarometerBridge {
  available?: () => boolean;
  read?: () => string | null;
}

function bridge(): BarometerBridge | undefined {
  return (globalThis as { SlowNavBarometer?: BarometerBridge }).SlowNavBarometer;
}

/** True only on a phone that has the sensor, in the shell that can reach it. */
export function barometerAvailable(): boolean {
  try {
    return bridge()?.available?.() === true;
  } catch {
    return false;
  }
}

/** The latest reading, or null before one has arrived — or ever, in a browser. */
export function readPressure(): PressureSample | null {
  try {
    const raw = bridge()?.read?.();
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { hPa, at } = parsed as { hPa?: unknown; at?: unknown };
    // A plausible reading is between the Dead Sea and the top of Everest;
    // anything else is a sensor fault, and a fault must not become a
    // 4,000 m altitude on a dashboard.
    if (typeof hPa !== "number" || !Number.isFinite(hPa) || hPa < 300 || hPa > 1100) return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    return { hPa, at };
  } catch {
    return null;
  }
}
