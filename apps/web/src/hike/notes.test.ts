// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotes,
  importNotes,
  loadNotes,
  loadVariant,
  placeNotes,
  saveVariant,
} from "./notes.js";
import { processTrack, type Point3, type Waypoint } from "@slownav/core";

const NOTES = `# Vale to Hilltop
> 12 km

0:00 0km  Cross the bridge and turn L.

0:08 675m  [1] Bear L uphill on a gravel path.

0:27 2.1km  Turn R to the chapel.
`;

describe("importNotes", () => {
  beforeEach(() => localStorage.clear());

  it("imports and says how many instructions it found", () => {
    const r = importNotes("h1", NOTES);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("3 instructions");
    expect(loadNotes("h1")?.steps).toHaveLength(3);
  });

  it("keeps notes per hike, not for all of them", () => {
    importNotes("h1", NOTES);
    expect(loadNotes("h2")).toBeNull();
  });

  it("refuses a file that is not route notes, and says what is wanted", () => {
    const r = importNotes("h1", "Dear guest, welcome to the Picos.");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("time and a distance");
    expect(loadNotes("h1")).toBeNull();
  });

  it("does not claim to have imported what it could not save", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      const r = importNotes("h1", NOTES);
      expect(r.ok).toBe(false);
      expect(r.message).toContain("could not be saved");
    } finally {
      setItem.mockRestore();
    }
  });

  it("forgets them when asked — they are somebody else's copyright", () => {
    importNotes("h1", NOTES);
    clearNotes("h1");
    expect(loadNotes("h1")).toBeNull();
  });
});

describe("placeNotes", () => {
  beforeEach(() => localStorage.clear());

  /** A straight kilometre east, with one waypoint 700 m along it. */
  const track = () => {
    const pts: Point3[] = [];
    for (let i = 0; i <= 120; i++) pts.push([43.15, -4.75 + i * 0.000123, 300]);
    return processTrack(pts, 5);
  };
  const at = (t: ReturnType<typeof track>, metres: number): Waypoint => {
    let i = 0;
    while (i < t.cum.length - 1 && t.cum[i + 1]! < metres) i++;
    return { name: "1", desc: "", lat: t.pts[i]![0], lon: t.pts[i]![1] };
  };

  it("places a step exactly on the waypoint it names", () => {
    importNotes("h1", NOTES);
    const t = track();
    const placed = placeNotes(loadNotes("h1"), t, [at(t, 700)]);
    const one = placed.find((s) => s.ref === "1")!;
    expect(one.exact).toBe(true);
    expect(one.prog).toBeGreaterThan(650);
    expect(one.prog).toBeLessThan(760);
  });

  it("has nothing to place when no notes are imported", () => {
    expect(placeNotes(null, track(), [])).toEqual([]);
  });

  it("has nothing to place before a track is processed", () => {
    importNotes("h1", NOTES);
    expect(placeNotes(loadNotes("h1"), null, [])).toEqual([]);
  });

  it("ignores a waypoint nowhere near the line", () => {
    importNotes("h1", NOTES);
    const t = track();
    const far: Waypoint = { name: "1", desc: "", lat: 44.9, lon: -3.0 };
    expect(placeNotes(loadNotes("h1"), t, [far]).find((s) => s.ref === "1")?.exact).toBe(false);
  });
});

describe("the chosen variant", () => {
  beforeEach(() => localStorage.clear());

  const TWO = `# Day
## Main route

0:00 0km  Follow the track.

## Harder option

0:10 1km  Climb the narrow path.
`;

  it("starts on the first variant the notes describe", () => {
    importNotes("h1", TWO);
    expect(loadVariant("h1", loadNotes("h1"))).toBe("main-route");
  });

  it("remembers the choice for that hike", () => {
    importNotes("h1", TWO);
    saveVariant("h1", "harder-option");
    expect(loadVariant("h1", loadNotes("h1"))).toBe("harder-option");
  });

  it("falls back when the stored choice is not in these notes", () => {
    // Re-importing a different day must not leave the walker on a variant
    // that no longer exists, with no instructions at all.
    importNotes("h1", TWO);
    saveVariant("h1", "harder-option");
    importNotes("h1", "# Other\n\n0:00 0km  Just the one way.\n");
    expect(loadVariant("h1", loadNotes("h1"))).toBe("main");
  });

  it("is forgotten along with the notes", () => {
    importNotes("h1", TWO);
    saveVariant("h1", "harder-option");
    clearNotes("h1");
    expect(localStorage.getItem("hike:variant:h1")).toBeNull();
  });
});
