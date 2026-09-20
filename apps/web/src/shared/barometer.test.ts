// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { barometerAvailable, readPressure } from "./barometer.js";

function bridge(impl: { available?: () => boolean; read?: () => string | null }) {
  (globalThis as Record<string, unknown>)["SlowNavBarometer"] = impl;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["SlowNavBarometer"];
});

describe("barometerAvailable", () => {
  it("is false in a browser, which has no barometer to offer", () => {
    expect(barometerAvailable()).toBe(false);
  });

  it("is false on a phone without the sensor", () => {
    bridge({ available: () => false });
    expect(barometerAvailable()).toBe(false);
  });

  it("is true when the shell says the sensor is there", () => {
    bridge({ available: () => true });
    expect(barometerAvailable()).toBe(true);
  });

  it("is false rather than throwing when the bridge misbehaves", () => {
    bridge({ available: () => { throw new Error("no"); } });
    expect(barometerAvailable()).toBe(false);
  });
});

describe("readPressure", () => {
  it("reads a reading", () => {
    bridge({ read: () => JSON.stringify({ hPa: 887.4, at: 1_700_000_000_000 }) });
    expect(readPressure()).toEqual({ hPa: 887.4, at: 1_700_000_000_000 });
  });

  it("gives nothing before the first reading arrives", () => {
    bridge({ read: () => null });
    expect(readPressure()).toBeNull();
  });

  it("rejects a reading no atmosphere produces, rather than showing it", () => {
    // A sensor fault must not turn into a plausible-looking altitude.
    bridge({ read: () => JSON.stringify({ hPa: 0, at: 1 }) });
    expect(readPressure()).toBeNull();
    bridge({ read: () => JSON.stringify({ hPa: 5000, at: 1 }) });
    expect(readPressure()).toBeNull();
  });

  it("survives the bridge returning something that is not a reading", () => {
    bridge({ read: () => "{ not json" });
    expect(readPressure()).toBeNull();
    bridge({ read: () => JSON.stringify({ hPa: "cold" }) });
    expect(readPressure()).toBeNull();
  });
});
