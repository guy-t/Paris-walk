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
let last: number | null = null;

/**
 * A fix `metres` along the east line, `offset` metres north of it.
 *
 * The clock advances by the time a walker would take to get there, because
 * the tracker now judges a match against what could have been walked since
 * the last one. A fixture that steps 100 m every five seconds describes a
 * car, and the tracker is right to disbelieve it.
 */
function fixAt(metres: number, offset = 0, extra: Partial<Fix> = {}): Fix {
  clock += last == null ? 5000 : Math.max(5000, (Math.abs(metres - last) / 1.3) * 1000);
  last = metres;
  return {
    lat: LAT + offset * DEG_PER_M_LAT,
    lon: 2.35 + metres * DEG_PER_M_LON,
    accuracy: 10,
    timestamp: clock,
    speed: 1.4,
    ...extra,
  };
}

/**
 * The same, but five seconds later however far away it is — a fix that
 * teleports, which is what a loop's other leg or a reflected signal looks
 * like, and what the jump confirmation exists to disbelieve.
 */
function jumpTo(metres: number, offset = 0, extra: Partial<Fix> = {}): Fix {
  clock += 5000;
  last = metres;
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
  last = null;
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

      // Suddenly 4 km along — well outside the 250 m back / 2 km ahead window,
      // and five seconds after the last fix, so nothing walked it.
      const first = t.update(jumpTo(4000));
      expect(first.resynced).toBe(false);
      expect(first.progress).toBeCloseTo(100, -1); // held where we were
      const second = t.update(jumpTo(4010));
      expect(second.resynced).toBe(false);
      const third = t.update(jumpTo(4020));
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
      // maxOffset from every segment inside it. The clock has moved with it,
      // so the tracker has already admitted it is lost and simply places the
      // fix — no jump to confirm, because nothing claims to have been
      // teleported.
      const s = t.update(fixAt(30000));
      expect(s.progress).toBeCloseTo(30000, -3);
      expect(s.offRoute).toBe(false);
    });

    it("recovers there without a gap to explain it, once three fixes agree", () => {
      const long = eastLine(351);
      const longCum = cumulative(long);
      const t = hikeTracker(long, longCum, HIKE_MATCH);
      t.update(fixAt(0));
      t.update(fixAt(300));

      // Five seconds later, 30 km on. Nothing walked that, so it is a jump and
      // wants confirming — but it must still resolve, because the windowed
      // match is null and holding would mean holding for the rest of the walk.
      expect(t.update(jumpTo(30000)).resynced).toBe(false);
      expect(t.update(jumpTo(30010)).resynced).toBe(false);
      const s = t.update(jumpTo(30020));
      expect(s.progress).toBeCloseTo(30020, -3);
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

  describe("walking pace as a limit", () => {
    it("will not move the route position faster than a walker could", () => {
      const t = hikeTracker(line, cum, HIKE_MATCH);
      t.update(fixAt(0));
      // 200 m five seconds later. The match scores it happily — it is exactly
      // on the line — but nobody walked it, so the route position moves by
      // the allowance and no further.
      const s = t.update(jumpTo(200));
      expect(s.progress).toBeGreaterThan(0);
      expect(s.progress).toBeLessThan(120); // 5 s × 2.5 m/s + 60 m of slack
    });

    it("opens the allowance by exactly the time a gap took", () => {
      const t = hikeTracker(line, cum, HIKE_MATCH);
      t.update(fixAt(0));
      // Twenty minutes in a pocket, then a fix 1.5 km along. That is 1.25 m/s
      // — an ordinary walk — and it is believed in full.
      clock += 20 * 60 * 1000;
      const s = t.update({
        lat: LAT,
        lon: 2.35 + 1500 * DEG_PER_M_LON,
        accuracy: 10,
        timestamp: clock,
      });
      expect(s.progress).toBeCloseTo(1500, -2);
    });

    it("reports how old the route position is while fixes are too vague", () => {
      const t = hikeTracker(line, cum, HIKE_MATCH);
      expect(t.update(fixAt(0)).heldFor).toBe(0);
      clock += 300_000;
      const held = t.update({
        lat: LAT,
        lon: 2.35 + 400 * DEG_PER_M_LON,
        accuracy: 400,
        timestamp: clock,
      });
      expect(held.weak).toBe(true);
      expect(held.heldFor).toBeCloseTo(300, 0);
      // …and back to nothing as soon as a fix places the walker again.
      clock += 5000;
      expect(
        t.update({ lat: LAT, lon: 2.35 + 410 * DEG_PER_M_LON, accuracy: 10, timestamp: clock })
          .heldFor,
      ).toBe(0);
    });

    /**
     * Holding is right for a fix or two. Held for ten minutes it is not a
     * position any more, and a windowed search around it searches somewhere
     * the walker has left — which is how the route notes and the walker part
     * company after a stretch under a cliff.
     */
    it("gives up and searches the whole line after a long stretch of vague fixes", () => {
      const long = eastLine(351); // 35 km
      const longCum = cumulative(long);
      const t = hikeTracker(long, longCum, HIKE_MATCH);
      t.update(fixAt(0));

      // Half an hour of fixes too vague to place, while the walker covers
      // 2.5 km — further than the 1.5 km window reaches.
      for (let i = 1; i <= 36; i++) {
        clock += 50_000;
        t.update({
          lat: LAT,
          lon: 2.35 + i * 70 * DEG_PER_M_LON,
          accuracy: 300,
          timestamp: clock,
        });
      }
      expect(t.progress).toBeCloseTo(0, -1); // held throughout, as it should be

      clock += 5000;
      const back = t.update({
        lat: LAT,
        lon: 2.35 + 2520 * DEG_PER_M_LON,
        accuracy: 10,
        timestamp: clock,
      });
      expect(back.progress).toBeCloseTo(2520, -2);
      expect(back.heldFor).toBe(0);
    });
  });

  describe("anchor and reset", () => {
    /**
     * A circuit begins and ends in the same place, so the first fix of the
     * day is a coin toss unless somebody says which end. Reported from the
     * hill: day 3 loaded and snapped to the finish — its line starts and ends
     * 64 m apart, and a first fix 30–60 m out is ordinary before the GNSS has
     * settled. It then stayed there, because the return leg runs alongside
     * the outward one, so the windowed match kept succeeding and the jump
     * path was never asked.
     *
     * Anchoring at zero is the honest prior: a walker opening a hike has not
     * walked it yet. `openHike` does that for every fresh open now.
     */
    it("anchored at the start, a fix by a loop's end stays at its beginning", () => {
      const loop = outAndBack(); // out 1 km east, back 5 m to the north
      const loopCum = cumulative(loop);
      const t = hikeTracker(loop, loopCum, HIKE_MATCH);
      t.anchor(0);
      // Standing at the trailhead, but the fix lands nearer the return leg,
      // which is where the walk ends 2 km along.
      const s = t.update(fixAt(0, 6));
      expect(s.progress).toBeLessThan(200);
      // …and stays there as the walk sets off.
      t.update(fixAt(60));
      expect(t.update(fixAt(120)).progress).toBeLessThan(300);
    });

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
    it("confirms off-route over several fixes rather than acting on one", () => {
      const t = hikeTracker(line, cum, HIKE_MATCH);
      t.update(fixAt(0));
      // One fix 200 m off is a fix 200 m off, not a detour: confirmOff is 3.
      expect(t.update(fixAt(300, 200)).offRoute).toBe(false);
      expect(t.update(fixAt(320, 200)).offRoute).toBe(false);
      expect(t.update(fixAt(340, 200)).offRoute).toBe(true);
    });

    /**
     * The threshold stays flat and tight, and that is a measured choice.
     *
     * Widening it with the fix's own accuracy looks obviously right — 110 m
     * of accuracy is ordinary under a cliff, and against a flat 50 m it reads
     * as a detour every time. But the threshold is also how a bad match gets
     * escalated: a rejected fix raises `offCount`, which consults the whole
     * line. Measured on the day-1 line through 3 km of 90 m fixes, widening
     * it cut the false off-route flags from 889 in 2565 to 222 and made the
     * worst position error worse, 324 m to 426 m. So the matching stays
     * strict and the *app* declines to raise a banner for a distance the
     * fix's own accuracy explains.
     */
    it("judges a vague fix against the same tight threshold", () => {
      const t = hikeTracker(line, cum, HIKE_MATCH);
      t.update(fixAt(0));
      for (const m of [100, 200, 300, 400]) {
        t.update(fixAt(m, 70, { accuracy: 110 }));
      }
      expect(t.offRoute).toBe(true);
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
