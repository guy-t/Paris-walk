import { describe, expect, it } from "vitest";
import type { Point3 } from "./geo.js";
import { processTrack, toblerSpeed } from "./track.js";

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
