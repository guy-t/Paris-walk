import { describe, expect, it } from "vitest";
import type { Point3 } from "./geo.js";
import { fillElevations, processTrack, toblerSpeed } from "./track.js";

const LAT = 43.15;
const DEG_PER_M_LON = 1 / (Math.cos((LAT * Math.PI) / 180) * 111320);

/** A line due east with the given elevations, 100 m between points. */
function track(eles: number[]): Point3[] {
  return eles.map((e, i) => [LAT, -4.75 + i * 100 * DEG_PER_M_LON, e] as Point3);
}

describe("toblerSpeed", () => {
  it("matches the walker's own pace on the flat", () => {
    expect(toblerSpeed(0, 5)).toBeCloseTo(5 / 3.6, 3);
  });

  it("is fastest on a gentle descent, not on the flat", () => {
    // Tobler's curve peaks just below level ground — walking downhill is quicker.
    expect(toblerSpeed(-0.05, 5)).toBeGreaterThan(toblerSpeed(0, 5));
  });

  it("slows down steeply uphill", () => {
    expect(toblerSpeed(0.3, 5)).toBeLessThan(toblerSpeed(0.1, 5));
    expect(toblerSpeed(0.1, 5)).toBeLessThan(toblerSpeed(0, 5));
  });

  it("never returns zero, however absurd the slope", () => {
    expect(toblerSpeed(10, 5)).toBeGreaterThanOrEqual(0.15);
    expect(toblerSpeed(-10, 5)).toBeGreaterThanOrEqual(0.15);
  });

  it("scales with the walker's pace", () => {
    expect(toblerSpeed(0.1, 6)).toBeCloseTo(toblerSpeed(0.1, 3) * 2, 6);
  });
});

describe("toblerSpeed uphill", () => {
  it("does not depend on the offset, because uphill it cancels", () => {
    // exp(-3.5·|s+k|) / exp(-3.5·k) is exp(-3.5·s) for every s >= 0, whatever k
    // is. So the 0.05 the app uses in place of Tobler's 0.1 changes nothing
    // about climbs — it only slows descents, which is not what its comment
    // claimed it was for. Recorded so the next person does not re-derive it.
    for (const slope of [0, 0.05, 0.1, 0.2, 0.3, 0.4]) {
      expect(toblerSpeed(slope, 4.2)).toBeCloseTo((4.2 / 3.6) * Math.exp(-3.5 * slope), 9);
    }
  });
});

describe("fillElevations", () => {
  const line = (eles: (number | null)[]) =>
    eles.map((e, i) => [LAT, -4.75 + i * 100 * DEG_PER_M_LON, e] as const);

  it("interpolates a gap along the line", () => {
    const out = fillElevations(line([100, null, null, 400]));
    expect(out.map((p) => Math.round(p[2]))).toEqual([100, 200, 300, 400]);
  });

  it("holds the outermost reading flat rather than extrapolating", () => {
    // The six points at the start of day 4 of the Picos state no elevation.
    // With nothing before them to slope from, inventing a gradient would be
    // guessing; holding the first real reading adds no climb that is not there.
    const out = fillElevations(line([null, null, 1098, 1105, null]));
    expect(out.map((p) => Math.round(p[2]))).toEqual([1098, 1098, 1098, 1105, 1105]);
  });

  it("keeps a genuine zero, which is sea level and not a missing reading", () => {
    // The coast path into San Sebastián really does read 0 m, and eight of its
    // points do. Coercing a missing reading to 0 made those indistinguishable.
    const out = fillElevations(line([0, 0, 12]));
    expect(out.map((p) => p[2])).toEqual([0, 0, 12]);
  });

  it("adds no climb where a missing reading used to invent a cliff", () => {
    // Day 4 of the Picos, in miniature: the first points state nothing, the
    // rest climb gently. The real ascent is tens of metres, and the `|| 0`
    // reported it as a climb out of the sea — 1469 m against a real 371 m.
    const eles = [null, null, 1100, 1110, 1120, 1130, 1140, 1150];
    const filled = processTrack(fillElevations(line(eles)), 4.2);
    const zeroed = processTrack(
      line(eles).map((p) => [p[0], p[1], p[2] ?? 0] as Point3),
      4.2,
    );
    expect(filled.up).toBeLessThan(60);
    expect(filled.minEle).toBeGreaterThan(1000);
    expect(zeroed.up).toBeGreaterThan(filled.up * 10);
    // And the ETA is read off that profile, so it was wrong too.
    expect(zeroed.tobler).toBeGreaterThan(filled.tobler * 1.5);
  });

  it("treats a line with no elevations at all as flat", () => {
    const out = fillElevations(line([null, null, null]));
    expect(out.map((p) => p[2])).toEqual([0, 0, 0]);
    expect(processTrack(out, 4.2).up).toBe(0);
  });
});

describe("processTrack", () => {
  it("measures length along the track", () => {
    const t = processTrack(track([100, 100, 100, 100, 100]), 5);
    expect(t.length).toBeCloseTo(400, 0);
    expect(t.cum).toHaveLength(5);
    expect(t.cum[0]).toBe(0);
  });

  it("does not count GPS jitter as climb", () => {
    // Flat ground, but the elevation reading wobbles by a metre or two.
    const t = processTrack(track([100, 102, 99, 101, 98, 100, 101, 99, 100]), 5);
    expect(t.up).toBeLessThan(5);
    expect(t.down).toBeLessThan(5);
  });

  it("counts a real climb", () => {
    // 20 points climbing 50 m each: 950 m from the first point to the last.
    // The 5-point smoothing window is truncated at both ends, so the profile
    // starts at the mean of the first three (150 m) and ends at the mean of
    // the last three (1000 m) — a reported 850 m. Under-reporting the ends by
    // one window is the price of not over-reporting jitter everywhere else,
    // and on a real track of hundreds of points it is a rounding error.
    const climb = Array.from({ length: 20 }, (_, i) => 100 + i * 50);
    const t = processTrack(track(climb), 5);
    expect(t.up).toBeCloseTo(850, 6);
    expect(t.down).toBe(0);
  });

  it("counts a climb and the descent after it separately", () => {
    const up = Array.from({ length: 15 }, (_, i) => 100 + i * 50); // to 800
    const down = Array.from({ length: 15 }, (_, i) => 800 - i * 50); // back to 100
    const t = processTrack(track([...up, ...down]), 5);
    expect(t.up).toBeGreaterThan(600);
    expect(t.down).toBeGreaterThan(600);
  });

  it("accumulates climb monotonically along the track", () => {
    const t = processTrack(track([100, 150, 200, 250, 300]), 5);
    for (let i = 1; i < t.upCum.length; i++) {
      expect(t.upCum[i]).toBeGreaterThanOrEqual(t.upCum[i - 1]);
    }
    expect(t.upCum[t.upCum.length - 1]).toBe(t.up);
  });

  it("smooths the elevation profile", () => {
    const t = processTrack(track([100, 100, 200, 100, 100]), 5);
    // The spike is averaged down rather than taken at face value.
    expect(t.maxEle).toBeLessThan(200);
    expect(t.maxEle).toBeGreaterThan(100);
  });

  it("predicts longer for the same distance uphill than on the flat", () => {
    const flat = processTrack(track([100, 100, 100, 100, 100]), 5);
    const climb = processTrack(track([100, 130, 160, 190, 220]), 5);
    expect(climb.tobler).toBeGreaterThan(flat.tobler);
  });

  it("predicts a flat walk at roughly the walker's pace", () => {
    const t = processTrack(track([100, 100, 100, 100, 100]), 5);
    // 400 m at 5 km/h is 288 s.
    expect(t.tobler).toBeCloseTo(288, -1);
  });

  it("accumulates predicted time monotonically", () => {
    const t = processTrack(track([100, 130, 160, 120, 200]), 5);
    for (let i = 1; i < t.tobCum.length; i++) {
      expect(t.tobCum[i]).toBeGreaterThan(t.tobCum[i - 1]);
    }
    expect(t.tobCum[t.tobCum.length - 1]).toBeCloseTo(t.tobler, 6);
  });

  it("reports the elevation range", () => {
    const t = processTrack(track([100, 200, 300, 200, 100]), 5);
    expect(t.minEle).toBeLessThan(t.maxEle);
    expect(t.minEle).toBeGreaterThanOrEqual(100);
    expect(t.maxEle).toBeLessThanOrEqual(300);
  });
});
