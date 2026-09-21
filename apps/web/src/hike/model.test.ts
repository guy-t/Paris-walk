// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { dayId, library, lineForVariant, type Hike } from "./model.js";

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
