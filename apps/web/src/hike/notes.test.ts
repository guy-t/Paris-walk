// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importNotes, loadNotes, clearNotes, placeNotes } from "./notes.js";
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
