import { describe, expect, it } from "vitest";
import {
  bearing,
  cardinal,
  cumulative,
  distanceToLine,
  haversine,
  simplify,
  type LatLon,
} from "./geo.js";

const NOTRE_DAME: LatLon = [48.8530, 2.3499];
const SACRE_COEUR: LatLon = [48.8867, 2.3431];

describe("haversine", () => {
  it("measures a known distance across Paris", () => {
    // Notre-Dame to Sacré-Cœur is about 3.75 km as the crow flies.
    expect(haversine(NOTRE_DAME, SACRE_COEUR)).toBeCloseTo(3750, -2);
  });

  it("is zero for the same point", () => {
    expect(haversine(NOTRE_DAME, NOTRE_DAME)).toBe(0);
  });

  it("is symmetric", () => {
    expect(haversine(NOTRE_DAME, SACRE_COEUR)).toBeCloseTo(
      haversine(SACRE_COEUR, NOTRE_DAME),
      9,
    );
  });

  it("ignores a third element", () => {
    expect(haversine([48.853, 2.3499, 35], [48.8867, 2.3431, 130])).toBeCloseTo(
      haversine(NOTRE_DAME, SACRE_COEUR),
      6,
    );
  });
});

describe("bearing", () => {
  it("is 0 due north", () => {
    expect(bearing([48.85, 2.35], [48.86, 2.35])).toBeCloseTo(0, 1);
  });

  it("is 90 due east", () => {
    expect(bearing([48.85, 2.35], [48.85, 2.36])).toBeCloseTo(90, 1);
  });

  it("is 180 due south", () => {
    expect(bearing([48.85, 2.35], [48.84, 2.35])).toBeCloseTo(180, 1);
  });

  it("is 270 due west", () => {
    expect(bearing([48.85, 2.35], [48.85, 2.34])).toBeCloseTo(270, 1);
  });

  it("always returns 0..360", () => {
    const b = bearing(SACRE_COEUR, NOTRE_DAME);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});

describe("cardinal", () => {
  it("names the eight points of the compass", () => {
    expect(cardinal(0)).toBe("north");
    expect(cardinal(45)).toBe("northeast");
    expect(cardinal(90)).toBe("east");
    expect(cardinal(180)).toBe("south");
    expect(cardinal(270)).toBe("west");
  });

  it("wraps around", () => {
    expect(cardinal(360)).toBe("north");
    expect(cardinal(359)).toBe("north");
    expect(cardinal(-90)).toBe("west");
  });
});

describe("simplify", () => {
  const straight: LatLon[] = Array.from(
    { length: 50 },
    (_, i) => [48.85, 2.35 + i * 0.0001] as LatLon,
  );

  it("reduces a straight line to its endpoints", () => {
    expect(simplify(straight, 5)).toHaveLength(2);
  });

  it("always keeps the first and last point", () => {
    const out = simplify(straight, 5);
    expect(out[0]).toEqual(straight[0]);
    expect(out[out.length - 1]).toEqual(straight[straight.length - 1]);
  });

  it("keeps a corner that matters", () => {
    const corner: LatLon[] = [
      [48.85, 2.35],
      [48.85, 2.36],
      [48.86, 2.36],
    ];
    expect(simplify(corner, 5)).toHaveLength(3);
  });

  it("drops a corner smaller than the tolerance", () => {
    const wobble: LatLon[] = [
      [48.85, 2.35],
      [48.850001, 2.355], // about 10 cm off the straight line
      [48.85, 2.36],
    ];
    expect(simplify(wobble, 5)).toHaveLength(2);
  });

  it("passes through lines too short to simplify", () => {
    expect(simplify([[48.85, 2.35]], 5)).toHaveLength(1);
    expect(simplify([], 5)).toHaveLength(0);
  });

  it("preserves elevation on the points it keeps", () => {
    const pts = [
      [43.1, -4.7, 500],
      [43.11, -4.7, 600],
      [43.12, -4.71, 700],
    ] as const;
    const out = simplify(pts, 1);
    expect(out[0][2]).toBe(500);
    expect(out[out.length - 1][2]).toBe(700);
  });
});

describe("cumulative", () => {
  it("starts at zero and increases", () => {
    const line: LatLon[] = [
      [48.85, 2.35],
      [48.85, 2.36],
      [48.86, 2.36],
    ];
    const cum = cumulative(line);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeGreaterThan(0);
    expect(cum[2]).toBeGreaterThan(cum[1]);
  });

  it("agrees with the sum of its segments", () => {
    const line: LatLon[] = [
      [48.85, 2.35],
      [48.85, 2.36],
      [48.86, 2.36],
    ];
    const cum = cumulative(line);
    expect(cum[2]).toBeCloseTo(haversine(line[0], line[1]) + haversine(line[1], line[2]), 6);
  });
});

describe("distanceToLine", () => {
  const line: LatLon[] = [
    [48.85, 2.35],
    [48.85, 2.36],
  ];

  it("is zero on the line", () => {
    expect(distanceToLine([48.85, 2.355], line)).toBeCloseTo(0, 1);
  });

  it("measures perpendicular distance", () => {
    // 0.001° of latitude is about 110 m.
    expect(distanceToLine([48.851, 2.355], line)).toBeCloseTo(110, -1);
  });

  it("clamps to the ends rather than extending the line", () => {
    // Past the end, the answer is the distance to the endpoint. Compared
    // loosely: this uses a local plane and haversine uses the sphere, which
    // differ by about a metre over this distance.
    const beyond = distanceToLine([48.85, 2.37], line);
    expect(beyond).toBeCloseTo(haversine([48.85, 2.37], line[1]), -1);
  });
});
