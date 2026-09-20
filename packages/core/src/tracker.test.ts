import { beforeEach, describe, expect, it } from "vitest";
import { cumulative, type LatLon } from "./geo.js";
import { HIKE_MATCH, WALK_MATCH } from "./match.js";
import { RouteTracker, WALK_TRACKING, hikeTracker, walkTracker, type Fix } from "./tracker.js";

const LAT = 48.85;
const DEG_PER_M_LON = 1 / (Math.cos((LAT * Math.PI) / 180) * 111320);
const DEG_PER_M_LAT = 1 / 110540;

/** A straight line due east, `n` points 100 m apart. */
function eastLine(n: number, lat = LAT): LatLon[] {
  return Array.from({ length: n }, (_, i) => [lat, 2.35 + i * 100 * DEG_PER_M_LON] as LatLon);
}

/** Out 1 km east and back 5 m to the north — the loop case. */
function outAndBack(): LatLon[] {
  return [...eastLine(11), ...eastLine(11, LAT + 5 * DEG_PER_M_LAT).reverse()];
}

let clock = 1_700_000_000_000;

/** A fix `metres` along the east line, `offset` metres north of it. */
function fixAt(metres: number, offset = 0, extra: Partial<Fix> = {}): Fix {
  clock += 5000;
  return {
    lat: LAT + offset * DEG_PER_M_LAT,
    lon: 2.35 + metres * DEG_PER_M_LON,
    accuracy: 10,
    timestamp: clock,
    speed: 1.4,
    ...extra,
  };
}

beforeEach(() => {
  clock = 1_700_000_000_000;
});

describe("RouteTracker", () => {
  const line = eastLine(21); // 2 km
  const cum = cumulative(line);

  it("follows a walker along the line", () => {
    const t = walkTracker(line, cum, WALK_MATCH);
    t.update(fixAt(0));
    t.update(fixAt(100));
    const s = t.update(fixAt(200));
    expect(s.progress).toBeCloseTo(200, -1);
    expect(s.offRoute).toBe(false);
    expect(s.weak).toBe(false);
  });

  describe("weak fixes", () => {
    it("holds progress when the fix is too vague to place", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(100));
      const before = t.progress;

      const s = t.update(fixAt(900, 0, { accuracy: 150 }));
      expect(s.weak).toBe(true);
      expect(s.progress).toBe(before);
      expect(t.progress).toBe(before);
    });

    it("still reports the position, so the map can show where we roughly are", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      const s = t.update(fixAt(500, 0, { accuracy: 150 }));
      expect(s.pos[1]).toBeCloseTo(2.35 + 500 * DEG_PER_M_LON, 6);
      expect(s.accuracy).toBe(150);
    });

    it("uses each app's own threshold", () => {
      // 100 m accuracy: too vague for streets, fine on a mountain.
      const walk = walkTracker(line, cum, WALK_MATCH);
      const hike = hikeTracker(line, cum, HIKE_MATCH);
      expect(walk.update(fixAt(300, 0, { accuracy: 100 })).weak).toBe(true);
      expect(hike.update(fixAt(300, 0, { accuracy: 100 })).weak).toBe(false);
    });
  });

  describe("off-route confirmation", () => {
    it("does not declare off-route on a single wild fix", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(100));
      t.update(fixAt(200));
      const s = t.update(fixAt(200, 120)); // one fix 120 m north
      expect(s.offRoute).toBe(false);
    });

    it("declares off-route once three fixes agree", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(100));
      t.update(fixAt(200, 120));
      t.update(fixAt(210, 130));
      const s = t.update(fixAt(220, 140));
      expect(s.offRoute).toBe(true);
      expect(s.offDistance).toBeGreaterThan(100);
      expect(s.offBearing).not.toBeNull();
    });

    it("points back towards the route when off it", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(200, 120));
      t.update(fixAt(210, 130));
      const s = t.update(fixAt(220, 140));
      // The route is to the south, so the bearing home is roughly 180°.
      expect(s.offBearing!).toBeGreaterThan(120);
      expect(s.offBearing!).toBeLessThan(240);
    });

    it("recovers once back on the route", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(200, 120));
      t.update(fixAt(210, 130));
      expect(t.update(fixAt(220, 140)).offRoute).toBe(true);
      t.update(fixAt(300));
      const s = t.update(fixAt(400));
      expect(s.offRoute).toBe(false);
      expect(s.progress).toBeCloseTo(400, -1);
    });

    it("keeps counting progress during a small wander off the pavement", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(100));
      t.update(fixAt(200, 50));
      t.update(fixAt(300, 50));
      const s = t.update(fixAt(400, 50));
      expect(s.offRoute).toBe(true);
      expect(s.progress).toBeCloseTo(400, -1); // still advancing along the line
    });
  });

  describe("jump re-sync", () => {
    it("needs three agreeing fixes before jumping to another part of the route", () => {
      const long = eastLine(61); // 6 km
      const longCum = cumulative(long);
      const t = walkTracker(long, longCum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(100));
      expect(t.progress).toBeCloseTo(100, -1);

      // Suddenly 4 km along — well outside the 250 m back / 2 km ahead window.
      const first = t.update(fixAt(4000));
      expect(first.resynced).toBe(false);
      expect(first.progress).toBeCloseTo(100, -1); // held where we were
      const second = t.update(fixAt(4010));
      expect(second.resynced).toBe(false);
      const third = t.update(fixAt(4020));
      expect(third.resynced).toBe(true);
      expect(third.progress).toBeCloseTo(4020, -2);
    });

    /**
     * The window only searches segments near `lastProgress`, and `project`
     * also skips any segment more than `maxOffset` (3 km) away. On a long
     * route both can miss entirely — reopening the app at the far end of a
     * 35 km track, say — and the windowed match comes back null. If that is
     * treated as "no information", progress never moves again for the rest of
     * the walk. It has to fall back to searching the whole line.
     */
    it("recovers when the walker is beyond the window's reach entirely", () => {
      const long = eastLine(351); // 35 km, like the Potes–Cosgaya track
      const longCum = cumulative(long);
      const t = hikeTracker(long, longCum, HIKE_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(300));
      expect(t.progress).toBeCloseTo(300, -1);

      // Now 30 km along: far outside the 1.5 km window, and further than
      // maxOffset from every segment inside it.
      const s = t.update(fixAt(30000));
      expect(s.progress).toBeCloseTo(30000, -3);
      expect(s.resynced).toBe(true);
    });

    it("keeps following normally after such a recovery", () => {
      const long = eastLine(351);
      const longCum = cumulative(long);
      const t = hikeTracker(long, longCum, HIKE_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(30000));
      const s = t.update(fixAt(30100));
      expect(s.progress).toBeCloseTo(30100, -2);
      expect(s.offRoute).toBe(false);
    });

    it("holds position for a fix nowhere near the route at all", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(200));
      const before = t.progress;
      // A fix in another country.
      const s = t.update({ lat: -33.87, lon: 151.21, accuracy: 10, timestamp: clock += 5000 });
      expect(s.progress).toBe(before);
      expect(t.progress).toBe(before);
    });

    it("does not re-sync for a jump smaller than jumpMin", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(100));
      const s = t.update(fixAt(300));
      expect(s.resynced).toBe(false);
      expect(s.progress).toBeCloseTo(300, -1); // ordinary forward movement
    });
  });

  describe("heading", () => {
    it("uses the provider's heading while moving", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0, 0, { heading: 90, speed: 1.4 }));
      expect(t.heading).toBe(90);
    });

    it("ignores the provider's heading while stationary and derives one instead", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0, 0, { heading: 270, speed: 0 }));
      t.update(fixAt(100, 0, { heading: 270, speed: 0 }));
      // Derived from movement: due east.
      expect(t.heading).toBeCloseTo(90, 0);
    });

    it("resolves which leg of a loop we are on", () => {
      const loop = outAndBack();
      const loopCum = cumulative(loop);
      const t = new RouteTracker(loop, loopCum, { ...WALK_TRACKING, match: WALK_MATCH });
      // Walk out to 500 m, then turn round and come back past the same spot.
      t.update(fixAt(0, 0, { heading: 90 }));
      t.update(fixAt(300, 0, { heading: 90 }));
      t.update(fixAt(500, 0, { heading: 90 }));
      expect(t.progress).toBeLessThan(1000);

      t.update(fixAt(900, 5, { heading: 90 }));
      const back = t.update(fixAt(700, 5, { heading: 270 }));
      expect(back.progress).toBeGreaterThan(1000); // now on the return leg
    });
  });

  describe("anchor and reset", () => {
    it("anchor places the walker without waiting for confirmation", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.anchor(1200);
      expect(t.progress).toBe(1200);
      const s = t.update(fixAt(1300));
      expect(s.progress).toBeCloseTo(1300, -1);
    });

    it("reset clears the derived heading", () => {
      const t = walkTracker(line, cum, WALK_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(100));
      expect(t.heading).not.toBeNull();
      t.reset();
      expect(t.heading).toBeNull();
    });
  });

  describe("hike configuration", () => {
    it("acts on every fix, as the original app did", () => {
      const t = hikeTracker(line, cum, HIKE_MATCH);
      t.update(fixAt(0));
      // A single fix 200 m off is enough: confirmOff is 1.
      const s = t.update(fixAt(300, 200));
      expect(s.offRoute).toBe(true);
    });

    it("does not move progress for a match beyond maxSnap", () => {
      const t = hikeTracker(line, cum, HIKE_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(100));
      const before = t.progress;
      const s = t.update(fixAt(300, 300)); // 300 m off the line, past maxSnap of 250
      expect(s.progress).toBe(before);
    });
  });
});
