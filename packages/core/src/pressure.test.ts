import { describe, expect, it } from "vitest";
import {
  addSample,
  correctForTemperature,
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

describe("correctForTemperature", () => {
  /** What the uncorrected formula returns for a true height in real air. */
  const reads = (trueM: number, tempC: number) => {
    const half = (0.0065 * trueM) / 2;
    return trueM * ((288.15 - half) / (tempC + 273.15 + half));
  };

  it("undoes the error a cold column puts in", () => {
    // The top of the Fuente Dé cable car on a −5 °C October morning.
    const uncorrected = reads(1900, -5);
    expect(uncorrected - 1900).toBeGreaterThan(45);
    expect(correctForTemperature(uncorrected, -5)).toBeCloseTo(1900, -1);
  });

  it("undoes it the other way on a warm afternoon", () => {
    const uncorrected = reads(1100, 20);
    expect(uncorrected - 1100).toBeLessThan(-40);
    expect(correctForTemperature(uncorrected, 20)).toBeCloseTo(1100, -1);
  });

  it("changes almost nothing when the air happens to be standard", () => {
    const h = 1100;
    const standardHere = 15 - 0.0065 * h;
    expect(correctForTemperature(h, standardHere)).toBeCloseTo(h, 0);
  });

  it("leaves a height alone rather than returning nonsense", () => {
    expect(correctForTemperature(1000, NaN)).toBe(1000);
    expect(Number.isNaN(correctForTemperature(NaN, 5))).toBe(true);
    expect(correctForTemperature(0, -40)).toBe(0);
  });
});

describe("pressureTrend", () => {
  // At sea level the reduction is the identity, so these read as written.
  const run = (points: Array<[hours: number, hPa: number]>): PressureSample[] =>
    points.map(([h, hPa]) => ({ at: h * 3600_000, hPa, ele: 0 }));

  /**
   * A walk: one sample a minute, climbing steadily, under a given sea-level
   * pressure, in air at a given temperature.
   *
   * The readings come from the column that temperature actually implies, not
   * from the standard one — a fixture that generated standard pressure and
   * then labelled it −5 °C would be contradicting itself, and would make the
   * temperature handling look right when it was not.
   */
  const walk = (
    hours: number,
    fromEle: number,
    toEle: number,
    mslAt: (hoursIn: number) => number,
    tempC = 5,
  ): PressureSample[] => {
    const out: PressureSample[] = [];
    for (let m = 0; m <= hours * 60; m++) {
      const f = m / (hours * 60);
      const ele = fromEle + (toEle - fromEle) * f;
      const seaLevelK = tempC + 273.15 + 0.0065 * ele;
      const hPa = mslAt(f * hours) * Math.pow((seaLevelK - 0.0065 * ele) / seaLevelK, 5.255);
      out.push({ at: m * 60_000, hPa, ele, tempC });
    }
    return out;
  };

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

  it("does not call a climb a storm", () => {
    // Reported from the hill. Day 2 climbs 745 m, which on raw pressure is
    // -84 hPa — nearly three times the span from a deep low to a strong
    // high, and permanently "weather coming in". The weather here is
    // perfectly steady, and the trend must say so.
    const t = pressureTrend(walk(3, 300, 1045, () => 1013), 3 * 3600_000);
    expect(t.direction).toBe("steady");
    expect(Math.abs(t.deltaHPa)).toBeLessThan(1);
  });

  it("does not call a descent a clearance", () => {
    const t = pressureTrend(walk(3, 1045, 300, () => 1013), 3 * 3600_000);
    expect(t.direction).toBe("steady");
  });

  it("still catches weather arriving while the walker climbs", () => {
    // The hill cancels; the 5 hPa of real fall underneath it does not.
    const t = pressureTrend(walk(3, 300, 1045, (h) => 1013 - (5 * h) / 3), 3 * 3600_000);
    expect(t.direction).toBe("falling");
    expect(t.note).toContain("coming in");
    expect(t.deltaHPa).toBeCloseTo(-5, 0);
  });

  it("catches it on the way down too, where the climb would have masked it", () => {
    const t = pressureTrend(walk(3, 1045, 300, (h) => 1013 - (5 * h) / 3), 3 * 3600_000);
    expect(t.direction).toBe("falling");
    expect(t.note).toContain("coming in");
  });

  it("ignores a reading whose height is unknown rather than mixing it in", () => {
    // Half a series reduced to sea level and half not is worse than no
    // trend: the unreduced half would carry the whole hill into the answer.
    const mixed: PressureSample[] = [
      { at: 0, hPa: 1010, ele: 0 },
      { at: 1.5 * 3600_000, hPa: 900 },
      { at: 3 * 3600_000, hPa: 1009.8, ele: 0 },
    ];
    expect(pressureTrend(mixed, 3 * 3600_000).direction).toBe("steady");
    expect(pressureTrend([{ at: 0, hPa: 1010 }], 3 * 3600_000).direction).toBe("unknown");
  });

  it("cancels the hill exactly, even in air well off standard", () => {
    // A standard reduction leaves a residual that grows with height: on a
    // −15 °C day this same climb reads as -3.4 hPa, which is the whole
    // "falling quickly" threshold and put the storm warning straight back.
    const cold = pressureTrend(walk(3, 300, 1045, () => 1013, -15), 3 * 3600_000);
    expect(cold.direction).toBe("steady");
    expect(Math.abs(cold.deltaHPa)).toBeLessThan(0.2);

    const withoutTemperature = walk(3, 300, 1045, () => 1013, -15).map(({ tempC, ...s }) => {
      void tempC;
      return s;
    });
    expect(Math.abs(pressureTrend(withoutTemperature, 3 * 3600_000).deltaHPa)).toBeGreaterThan(3);
  });

  it("is not decided by one reading taken in a doorway", () => {
    const steady = walk(3, 500, 500, () => 1013);
    const spiked = steady.map((s, i) => (i === steady.length - 1 ? { ...s, hPa: s.hPa - 6 } : s));
    expect(pressureTrend(spiked, 3 * 3600_000).direction).toBe("steady");
  });
});
