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
import type { WaypointAt } from "./model.js";

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

  const waypoints = [{ name: "1", prog: 700, desc: "", lat: 0, lon: 0 }] as WaypointAt[];

  it("places a step exactly on the waypoint it names", () => {
    importNotes("h1", NOTES);
    const placed = placeNotes(loadNotes("h1"), waypoints, 12000);
    const one = placed.find((s) => s.ref === "1")!;
    expect(one.prog).toBe(700);
    expect(one.exact).toBe(true);
  });

  it("has nothing to place when no notes are imported", () => {
    expect(placeNotes(null, waypoints, 12000)).toEqual([]);
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
