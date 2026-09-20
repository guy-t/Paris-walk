import { describe, expect, it } from "vitest";
import {
  addSample,
  altitudeFromPressure,
  mslFromReading,
  pressureAtAltitude,
  pressureTrend,
  STANDARD_MSL,
  type PressureSample,
} from "./pressure.js";

describe("altitudeFromPressure", () => {
  it("puts standard sea-level pressure at sea level", () => {
    expect(altitudeFromPressure(STANDARD_MSL)).toBeCloseTo(0, 1);
  });

  it("agrees with the textbook figures for the heights this app walks", () => {
    // ~1100 m and ~1900 m in a standard atmosphere.
    expect(altitudeFromPressure(887)).toBeGreaterThan(1050);
    expect(altitudeFromPressure(887)).toBeLessThan(1200);
    expect(altitudeFromPressure(805)).toBeGreaterThan(1850);
    expect(altitudeFromPressure(805)).toBeLessThan(2000);
  });

  it("round-trips against the pressure for a height", () => {
    for (const m of [0, 500, 1900, 2600]) {
      expect(altitudeFromPressure(pressureAtAltitude(m))).toBeCloseTo(m, 0);
    }
  });

  it("shows how far out an uncalibrated reading can be", () => {
    // A deep low against the standard atmosphere: the same pressure reads
    // several hundred metres high. This is why the forecast's sea-level
    // pressure is used when there is one.
    const real = pressureAtAltitude(1900, 985);
    expect(altitudeFromPressure(real, 985)).toBeCloseTo(1900, 0);
    expect(altitudeFromPressure(real) - 1900).toBeGreaterThan(200);
  });

  it("refuses nonsense rather than returning a number", () => {
    expect(altitudeFromPressure(0)).toBeNaN();
    expect(altitudeFromPressure(-5)).toBeNaN();
  });
});

describe("mslFromReading", () => {
  it("recovers the sea-level pressure from a reading at a known height", () => {
    expect(mslFromReading(pressureAtAltitude(1200, 1002), 1200)).toBeCloseTo(1002, 1);
  });
});

describe("addSample", () => {
  const s = (at: number, hPa: number): PressureSample => ({ at, hPa });

  it("ignores readings taken less than a minute apart", () => {
    const h = addSample([s(0, 1000)], s(30_000, 1001));
    expect(h).toHaveLength(1);
  });

  it("keeps readings a minute or more apart", () => {
    expect(addSample([s(0, 1000)], s(60_000, 1001))).toHaveLength(2);
  });

  it("forgets readings older than the window", () => {
    const old = [s(0, 1000), s(3600_000, 1001)];
    const h = addSample(old, s(5 * 3600_000, 1002), 4 * 3600_000);
    expect(h.map((x) => x.at)).toEqual([3600_000, 5 * 3600_000]);
  });

  it("stays bounded however long the walk is", () => {
    let h: PressureSample[] = [];
    for (let i = 0; i < 2000; i++) h = addSample(h, s(i * 60_000, 1000), Infinity);
    expect(h.length).toBeLessThanOrEqual(240);
  });
});

describe("pressureTrend", () => {
  const run = (points: Array<[hours: number, hPa: number]>): PressureSample[] =>
    points.map(([h, hPa]) => ({ at: h * 3600_000, hPa }));

  it("says nothing useful from under an hour of readings", () => {
    const t = pressureTrend(run([[0, 1010], [0.5, 1008]]), 0.5 * 3600_000);
    expect(t.direction).toBe("unknown");
    expect(t.note).toContain("hour");
  });

  it("calls a flat three hours steady", () => {
    const t = pressureTrend(run([[0, 1010], [1.5, 1010.3], [3, 1009.8]]), 3 * 3600_000);
    expect(t.direction).toBe("steady");
  });

  it("warns when pressure is falling quickly", () => {
    const t = pressureTrend(run([[0, 1010], [1.5, 1007], [3, 1005]]), 3 * 3600_000);
    expect(t.direction).toBe("falling");
    expect(t.note).toContain("coming in");
  });

  it("distinguishes a slow fall from a fast one", () => {
    const slow = pressureTrend(run([[0, 1010], [3, 1008]]), 3 * 3600_000);
    expect(slow.direction).toBe("falling");
    expect(slow.note).not.toContain("quickly");
  });

  it("reads a rise as clearing", () => {
    const t = pressureTrend(run([[0, 1000], [3, 1005]]), 3 * 3600_000);
    expect(t.direction).toBe("rising");
    expect(t.note).toContain("Rising");
  });

  it("scales a short run so an hour of data means the same as three", () => {
    // 2 hPa down in one hour is the same rate as 6 in three: quick.
    const t = pressureTrend(run([[2, 1010], [3, 1008]]), 3 * 3600_000);
    expect(t.overHours).toBeCloseTo(1, 1);
    expect(t.note).toContain("quickly");
  });
});
