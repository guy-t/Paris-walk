// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, dayId, eta, library, lineForVariant, loadSettings, prepare, type Hike } from "./model.js";
import { newSession, type Session } from "@slownav/core";

const line = (id: string, variantOf?: string): Hike => ({
  id,
  name: id,
  pts: [
    [43.1, -4.6, 100],
    [43.11, -4.61, 110],
  ],
  ...(variantOf ? { variantOf } : {}),
});

describe("dayId", () => {
  it("is a hike's own id when it is the day's main line", () => {
    expect(dayId(line("day1"))).toBe("day1");
  });

  it("is the main line's id when walking an option", () => {
    expect(dayId(line("day1_harder", "day1"))).toBe("day1");
  });

  it("is empty for no hike, so nothing is stored under a stray key", () => {
    expect(dayId(null)).toBe("");
    expect(dayId(undefined)).toBe("");
  });
});

describe("library.family", () => {
  beforeEach(() => localStorage.clear());

  it("answers the same from either side of a swap", () => {
    library.add(line("imported"));
    library.add(line("imported_b", "imported"));
    const ids = (id: string) => library.family(id).map((h) => h.id);
    expect(ids("imported")).toEqual(["imported", "imported_b"]);
    expect(ids("imported_b")).toEqual(["imported", "imported_b"]);
  });

  it("is a day of one for a hike with no options", () => {
    library.add(line("alone"));
    expect(library.family("alone").map((h) => h.id)).toEqual(["alone"]);
  });

  it("is empty for an id that is not in the library", () => {
    expect(library.family("nope")).toEqual([]);
  });

  it("puts each shipped harder option under the day it forks from", () => {
    for (const h of library.list().filter((x) => x.variantOf)) {
      const family = library.family(h.id);
      expect(family[0]!.id).toBe(h.variantOf);
      expect(family.map((x) => x.id)).toContain(h.id);
    }
  });

  it("does not gather two days that merely share a prefix", () => {
    // Day 1's option is `5_Potes_to_Cosgaya_harder`, whose id starts with
    // the main line's — matching on the id text rather than on `variantOf`
    // would drag one day's lines into another's whenever the names nest.
    expect(library.family("5_Potes_to_Cosgaya").map((h) => h.id)).toEqual([
      "5_Potes_to_Cosgaya",
      "5_Potes_to_Cosgaya_harder",
    ]);
    expect(library.family("7a_Fuente_De_High_Picos_circuit").map((h) => h.id)).toEqual([
      "7a_Fuente_De_High_Picos_circuit",
    ]);
  });
});

describe("lineForVariant", () => {
  const family = [line("day1"), line("day1_harder", "day1")];
  const variants = ["main-route", "harder-option"];

  it("matches a variant to the line it is walked on, by position", () => {
    expect(lineForVariant(family, variants, "main-route")).toBe("day1");
    expect(lineForVariant(family, variants, "harder-option")).toBe("day1_harder");
  });

  it("is null when the day ships no line for that variant", () => {
    // Notes with three sections against a day that ships two: those steps
    // stay where they are rather than being drawn onto the wrong line.
    expect(lineForVariant(family, [...variants, "wilder-option"], "wilder-option")).toBeNull();
  });

  it("is null for a variant the notes do not have", () => {
    expect(lineForVariant(family, variants, "nonsense")).toBeNull();
  });

  it("names the only line for a day that does not fork", () => {
    expect(lineForVariant([line("day3")], ["main-route"], "main-route")).toBe("day3");
  });
});

describe("eta", () => {
  /**
   * Twenty kilometres of dead flat, so Tobler's prediction is arithmetic —
   * and long enough that half of it clears both gates the calibration waits
   * for, with room for a sample fast enough to reach the lower clamp.
   */
  const flat = (): Hike => ({
    id: "flat",
    name: "flat",
    pts: Array.from({ length: 2001 }, (_, i) => [43 + i * 0.00009, -4, 100] as [number, number, number]),
  });
  const track = prepare(flat(), 4.2);

  const session = (over: Partial<Session> = {}): Session => ({
    ...newSession(0),
    ...over,
  });

  it("uses the planned pace before there is a sample worth having", () => {
    expect(eta(track, 0, null).basis).toBe("planned pace");
    // Two minutes and fifty metres is not a pace.
    expect(eta(track, 50, session({ moving: 120, dist: 50 })).basis).toBe("planned pace");
  });

  it("calibrates to the walker once there is", () => {
    const half = track.length / 2;
    const planned = eta(track, half, null).seconds;
    // Walking at half Tobler's speed: twice as long predicted for what is left.
    const predicted = track.tobler / 2;
    const slow = eta(track, half, session({ moving: predicted * 2, dist: half }));
    expect(slow.basis).toBe("your walking pace");
    expect(slow.seconds).toBeCloseTo(planned * 2, -1);
  });

  it("does not charge the walker for a lunch they have already eaten", () => {
    // The fault this replaced: wall-clock elapsed against Tobler's moving
    // time. An hour of lunch after an hour of walking made every remaining
    // hour an hour and a half.
    const half = track.length / 2;
    const walked = track.tobler / 2;
    const atToblerPace = session({ moving: walked, dist: half, start: 0 });
    const withLongLunch = { ...atToblerPace };
    // An hour of wall clock has passed that was not walking; `moving` is
    // untouched, and so is the estimate.
    const now = walked * 1000 + 3600_000;
    expect(eta(track, half, withLongLunch, now).seconds).toBeCloseTo(
      eta(track, half, atToblerPace, walked * 1000).seconds,
      5,
    );
  });

  it("is not thrown by a session opened long before the walk began", () => {
    // Opening the app over breakfast used to put an hour of standing still
    // into the factor, clamp it at 3x, and leave it there for the day.
    const half = track.length / 2;
    const walked = track.tobler / 2;
    const openedEarly = session({ moving: walked, dist: half, start: -3600_000 });
    const e = eta(track, half, openedEarly, walked * 1000);
    expect(e.seconds).toBeCloseTo(track.tobler / 2, -1);
  });

  it("refuses to believe a sample beyond 0.5-3x", () => {
    const half = track.length / 2;
    const crawl = eta(track, half, session({ moving: track.tobler * 50, dist: half }));
    expect(crawl.seconds).toBeCloseTo((track.tobler / 2) * 3, -1);
    // Just past the gate, and implausibly quick for the ground covered.
    const sprint = eta(track, half, session({ moving: 1300, dist: half }));
    expect(sprint.seconds).toBeCloseTo((track.tobler / 2) * 0.5, -1);
  });
});

describe("loadSettings", () => {
  beforeEach(() => localStorage.clear());

  it("moves a walker off the old default pace, which measured too fast", () => {
    localStorage.setItem("hike:settings", JSON.stringify({ pace: 5, units: "metric" }));
    expect(loadSettings().pace).toBe(DEFAULT_SETTINGS.pace);
  });

  it("leaves a pace the walker chose alone", () => {
    for (const pace of [3.5, 4.8, 5.5]) {
      localStorage.setItem("hike:settings", JSON.stringify({ pace }));
      expect(loadSettings().pace).toBe(pace);
    }
  });

  it("gives a walker with no stored settings the measured default", () => {
    expect(loadSettings().pace).toBe(4.2);
  });
});
