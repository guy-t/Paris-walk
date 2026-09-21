import { describe, expect, it } from "vitest";
import { cumulative, haversine, type LatLon } from "./geo.js";
import {
  HIKE_MATCH,
  WALK_MATCH,
  interp,
  passesNear,
  positionAt,
  project,
  projectAll,
  snap,
} from "./match.js";

/**
 * A straight line heading due east from a point in Paris, `n` points at
 * `spacing` metres. Latitude is fixed so distances along it are predictable.
 */
function eastLine(n: number, spacing = 100, lat = 48.85, lon0 = 2.35): LatLon[] {
  const degPerM = 1 / (Math.cos((lat * Math.PI) / 180) * 111320);
  return Array.from({ length: n }, (_, i) => [lat, lon0 + i * spacing * degPerM] as LatLon);
}

/** Out and back along the same line: 1 km east, then 1 km west on a parallel 5 m away. */
function outAndBack(): LatLon[] {
  const out = eastLine(11, 100);
  const back = eastLine(11, 100, 48.85 + 5 / 110540).reverse();
  return [...out, ...back];
}

describe("project", () => {
  it("finds the nearest point on a simple line", () => {
    const line = eastLine(11);
    const cum = cumulative(line);
    // 250 m along, displaced 20 m north.
    const pos: LatLon = [48.85 + 20 / 110540, line[2][1] + (line[3][1] - line[2][1]) * 0.5];
    const m = project(line, cum, pos, { global: true });
    expect(m).not.toBeNull();
    expect(m!.prog).toBeCloseTo(250, -1);
    expect(m!.dist).toBeCloseTo(20, 0);
    expect(m!.idx).toBe(2);
  });

  it("returns null when the line is out of range", () => {
    const line = eastLine(11);
    expect(project(line, cumulative(line), [40, 2.35], { global: true })).toBeNull();
  });

  it("reports the segment bearing, so a caller can tell which way the route runs", () => {
    const line = eastLine(5);
    const m = project(line, cumulative(line), [48.85, line[1][1]], { global: true });
    expect(m!.segBearing).toBeCloseTo(90, 0); // due east
  });

  describe("on a route that doubles back", () => {
    const line = outAndBack();
    const cum = cumulative(line);
    // Midway along, where the outbound and return legs are 5 m apart.
    const pos: LatLon = [48.85 + 2.5 / 110540, line[5][1]];

    it("picks the outbound leg when travelling east", () => {
      const m = project(line, cum, pos, { ...WALK_MATCH, lastProgress: 500, heading: 90 });
      expect(m!.prog).toBeLessThan(1100); // still on the way out
    });

    it("picks the return leg when travelling west", () => {
      const m = project(line, cum, pos, { ...WALK_MATCH, lastProgress: 1500, heading: 270 });
      expect(m!.prog).toBeGreaterThan(1100); // on the way back
    });

    it("without a heading, the progress window alone still separates the legs", () => {
      const out = project(line, cum, pos, { ...WALK_MATCH, lastProgress: 500 });
      const back = project(line, cum, pos, { ...WALK_MATCH, lastProgress: 1600 });
      expect(out!.prog).toBeLessThan(1100);
      expect(back!.prog).toBeGreaterThan(1100);
    });
  });

  it("charges a backwards match more than its distance alone", () => {
    const line = eastLine(21);
    const cum = cumulative(line);
    const pos: LatLon = [48.85, line[7][1]]; // 700 m along, inside the window
    const behind = project(line, cum, pos, { ...WALK_MATCH, lastProgress: 900 });
    // It still matches — it is right on the line — but the score carries the
    // penalty for implying we walked 200 m backwards.
    expect(behind!.dist).toBeLessThan(1);
    expect(behind!.score).toBeGreaterThan(20);
  });

  it("ignores the whole line outside the window when anchored", () => {
    const line = eastLine(101); // 10 km
    const cum = cumulative(line);
    const pos: LatLon = [48.85, line[90][1]]; // 9 km along
    // Anchored at 0 with the hike window of 1.5 km, 9 km away is out of range.
    const windowed = project(line, cum, pos, { ...HIKE_MATCH, lastProgress: 0 });
    expect(windowed).toBeNull();
    // Globally it is found without trouble.
    expect(snap(line, cum, pos)!.prog).toBeCloseTo(9000, -2);
  });
});

describe("positionAt", () => {
  const line = eastLine(11);
  const cum = cumulative(line);

  it("interpolates within a segment", () => {
    const { pos, idx, t } = positionAt(line, cum, 250);
    expect(idx).toBe(2);
    expect(t).toBeCloseTo(0.5, 2);
    expect(pos[1]).toBeCloseTo((line[2][1] + line[3][1]) / 2, 4);
  });

  it("clamps at both ends", () => {
    expect(positionAt(line, cum, -100).pos[1]).toBeCloseTo(line[0][1], 6);
    expect(positionAt(line, cum, 99999).pos[1]).toBeCloseTo(line[10][1], 6);
  });

  it("round-trips with project", () => {
    const { pos } = positionAt(line, cum, 640);
    expect(snap(line, cum, pos)!.prog).toBeCloseTo(640, 1);
  });
});

describe("interp", () => {
  it("reads a per-point array at a fractional index", () => {
    expect(interp([0, 10, 20], 1, 0.5)).toBe(15);
  });

  it("holds the last value at the end of the array", () => {
    expect(interp([0, 10], 1, 0.5)).toBe(10);
  });
});

describe("passesNear", () => {
  it("finds both passes where a loop revisits a place", () => {
    const line = outAndBack();
    const cum = cumulative(line);
    const passes = passesNear(line, cum, [48.85, line[5][1]], 60);
    expect(passes).toHaveLength(2);
    expect(passes[0].prog).toBeLessThan(1100);
    expect(passes[1].prog).toBeGreaterThan(1100);
  });

  it("merges one approach seen across several segments", () => {
    const line = eastLine(21);
    const passes = passesNear(line, cumulative(line), [48.85, line[10][1]], 60);
    expect(passes).toHaveLength(1);
  });

  it("finds nothing when the line stays away", () => {
    const line = eastLine(11);
    expect(passesNear(line, cumulative(line), [48.86, 2.35], 60)).toHaveLength(0);
  });
});

describe("projectAll", () => {
  /** A line out and back: every point near it is passed twice. */
  const outAndBack = () => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 100; i++) pts.push([43.15, -4.75 + i * 0.0005]);
    for (let i = 99; i >= 0; i--) pts.push([43.1504, -4.75 + i * 0.0005]);
    return pts;
  };

  const cumOf = (pts: ReadonlyArray<[number, number]>) => {
    const c = [0];
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1]! + haversine(pts[i - 1]!, pts[i]!));
    return c;
  };

  it("finds both passes of a line that doubles back", () => {
    const pts = outAndBack();
    const hits = projectAll(pts, cumOf(pts), [43.1502, -4.7255]);
    expect(hits.length).toBe(2);
    expect(Math.abs(hits[0]!.prog - hits[1]!.prog)).toBeGreaterThan(1000);
  });

  it("returns the nearest pass first", () => {
    const pts = outAndBack();
    // Closer to the outward leg than the return.
    const hits = projectAll(pts, cumOf(pts), [43.1501, -4.7255]);
    expect(hits[0]!.dist).toBeLessThan(hits[1]!.dist);
  });

  it("agrees with project about the best one", () => {
    const pts = outAndBack();
    const cum = cumOf(pts);
    const pos: [number, number] = [43.1501, -4.7255];
    const best = project(pts, cum, pos, { global: true })!;
    expect(projectAll(pts, cum, pos)[0]!.prog).toBeCloseTo(best.prog, 0);
  });

  it("does not split one pass into several", () => {
    // A straight line past the point is a single approach, however many
    // segments it is made of.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 200; i++) pts.push([43.15, -4.75 + i * 0.0002]);
    expect(projectAll(pts, cumOf(pts), [43.1501, -4.73])).toHaveLength(1);
  });

  it("says nothing about a point nowhere near the line", () => {
    const pts = outAndBack();
    expect(projectAll(pts, cumOf(pts), [44.5, -3.0])).toEqual([]);
  });

  it("keeps a far-off pass out when a threshold is given", () => {
    const pts = outAndBack();
    // The two legs are ~45 m apart; a tight threshold keeps only the near one.
    const hits = projectAll(pts, cumOf(pts), [43.15, -4.7255], { maxDist: 20 });
    expect(hits).toHaveLength(1);
  });
});
