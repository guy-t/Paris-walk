import { describe, expect, it } from "vitest";
import type { Point3 } from "./geo.js";
import { processTrack, repairElevation } from "./track.js";

const at = (i: number, ele: number): Point3 => [43.15 + i * 0.001, -4.75, ele];

describe("repairElevation", () => {
  it("fills leading zeros from the first real reading", () => {
    const pts = [at(0, 0), at(1, 0), at(2, 1050), at(3, 1100)];
    expect(repairElevation(pts).map((p) => p[2])).toEqual([1050, 1050, 1050, 1100]);
  });

  it("fills trailing zeros from the last real reading", () => {
    const pts = [at(0, 900), at(1, 950), at(2, 0)];
    expect(repairElevation(pts).map((p) => p[2])).toEqual([900, 950, 950]);
  });

  it("interpolates across a gap in the middle", () => {
    const pts = [at(0, 1000), at(1, 0), at(2, 0), at(3, 1300)];
    expect(repairElevation(pts).map((p) => p[2])).toEqual([1000, 1100, 1200, 1300]);
  });

  it("leaves a sea-level track alone, where zero is a real elevation", () => {
    // A canal: 0 m is the actual height, not a missing reading.
    const pts = [at(0, 0), at(1, 2), at(2, 0), at(3, 1)];
    expect(repairElevation(pts).map((p) => p[2])).toEqual([0, 2, 0, 1]);
  });

  it("passes through a track with no zeros at all", () => {
    const pts = [at(0, 500), at(1, 600)];
    expect(repairElevation(pts).map((p) => p[2])).toEqual([500, 600]);
  });

  it("gives up gracefully when every reading is missing", () => {
    const pts = [at(0, 0), at(1, 0)];
    expect(repairElevation(pts).map((p) => p[2])).toEqual([0, 0]);
  });

  it("does not mutate the input", () => {
    const pts = [at(0, 0), at(1, 1050)];
    repairElevation(pts);
    expect(pts[0][2]).toBe(0);
  });

  it("removes the phantom climb from a track that starts without altitude", () => {
    // Six missing readings, then a real valley circuit around 1050–1200 m.
    const broken: Point3[] = [
      ...Array.from({ length: 6 }, (_, i) => at(i, 0)),
      ...Array.from({ length: 20 }, (_, i) => at(6 + i, 1050 + i * 5)),
    ];
    const before = processTrack(broken, 5);
    const after = processTrack(repairElevation(broken), 5);
    expect(before.up).toBeGreaterThan(800); // phantom kilometre of climb
    expect(after.up).toBeLessThan(120); // the real, gentle rise
    expect(after.minEle).toBeGreaterThan(1000);
  });
});
