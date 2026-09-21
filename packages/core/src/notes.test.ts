import { describe, expect, it } from "vitest";
import { parseDistance, parseNotes, placeSteps, stepAt, type NoteAnchor } from "./notes.js";

/** Shaped exactly like a transcribed page, asides and all. */
const SAMPLE = `# Vale to Hilltop
> 12 km · 500 m climb · allow 4h

## Main route

0:00 0km  Cross the stone bridge and turn L.

  If you need lunch, the shop is 100m up the road on the right.

0:08 675m  [1] Bear L uphill on a gravel footpath for 1.2km.

0:27 2.1km  Turn R and follow the walkway uphill to the Chapel. (12mins & 800m)

  ! There are large dogs at the farm here.

0:46 3.4km  [2] Take the first R down a concrete track,
passing the white house on the left.

## Harder option

0:40 2.9km  [A] Turn R to ascend the stony path.

1:13 4.4km  [B] Turn L steeply uphill on a narrow muddy path.
`;

describe("parseDistance", () => {
  it("reads metres and kilometres", () => {
    expect(parseDistance("675m")).toBe(675);
    expect(parseDistance("2.1km")).toBe(2100);
    expect(parseDistance("0km")).toBe(0);
  });

  it("refuses a distance no day's walk has", () => {
    // Scans of these notes read "400m" as "400km" often enough to matter.
    expect(parseDistance("400km")).toBeNull();
    expect(parseDistance("banana")).toBeNull();
  });
});

describe("parseNotes", () => {
  const notes = parseNotes(SAMPLE);

  it("takes the name and summary from the top", () => {
    expect(notes.name).toBe("Vale to Hilltop");
    expect(notes.summary).toContain("12 km");
  });

  it("finds both variants", () => {
    expect(notes.variants.map((v) => v.name)).toEqual(["Main route", "Harder option"]);
  });

  it("reads cumulative time and distance for each step", () => {
    expect(notes.steps[0]?.time).toBe(0);
    expect(notes.steps[1]?.time).toBe(8 * 60);
    expect(notes.steps[1]?.noteM).toBe(675);
    expect(notes.steps[3]?.noteM).toBe(3400);
  });

  it("lifts the bracketed waypoint out of the text", () => {
    expect(notes.steps[1]?.ref).toBe("1");
    expect(notes.steps[1]?.text.startsWith("Bear L uphill")).toBe(true);
    expect(notes.steps[0]?.ref).toBeNull();
  });

  it("keeps an indented aside as an aside, not as an instruction", () => {
    expect(notes.steps[0]?.notes[0]?.text).toContain("shop is 100m");
    expect(notes.steps[0]?.text).not.toContain("shop is 100m");
  });

  it("marks a warning so the app can shout about it", () => {
    const dogs = notes.steps[2]?.notes[0];
    expect(dogs?.warning).toBe(true);
    expect(dogs?.text).toBe("There are large dogs at the farm here.");
  });

  it("joins a wrapped instruction back into one", () => {
    expect(notes.steps[3]?.text).toContain("passing the white house");
  });

  it("tags steps with the variant they were written under", () => {
    expect(notes.steps.filter((s) => s.variant === "harder-option")).toHaveLength(2);
  });

  it("takes a waypoint named mid-sentence, and unwraps it", () => {
    // These notes bracket the accommodation the same way they bracket a
    // numbered turn: "For the [Hotel del Oso], turn R over the footbridge."
    const one = parseNotes("# X\n\n4:05 14.6km  For the [Hotel del Oso], turn R.\n");
    expect(one.steps[0]?.ref).toBe("Hotel del Oso");
    expect(one.steps[0]?.text).toBe("For the Hotel del Oso, turn R.");
  });

  it("anchors on nothing when a step names two places", () => {
    const two = parseNotes("# X\n\n1:00 2km  Between [A] and [B] keep left.\n");
    expect(two.steps[0]?.ref).toBeNull();
  });

  it("has nothing to say about an empty file", () => {
    expect(parseNotes("").steps).toEqual([]);
  });
});

describe("placeSteps", () => {
  const notes = parseNotes(SAMPLE);
  // The GPX's own metres, a few percent off the printed ones.
  const anchors: NoteAnchor[] = [
    { name: "1", prog: 700 },
    { name: "2", prog: 3600 },
    { name: "A", prog: 3000 },
    { name: "B", prog: 4600 },
  ];
  // No variant named: the notes' own first one is the track.
  const placed = placeSteps(notes.steps, anchors, 12000);

  it("puts a step that names a waypoint exactly on it", () => {
    const one = placed.find((s) => s.ref === "1")!;
    expect(one.prog).toBe(700);
    expect(one.exact).toBe(true);
  });

  it("interpolates the steps between anchors onto the measured track", () => {
    const between = placed.find((s) => s.text.startsWith("Turn R and follow"))!;
    // 2.1 km of 675→3400 printed maps onto 700→3600 measured.
    expect(between.prog).toBeGreaterThan(700);
    expect(between.prog).toBeLessThan(3600);
    expect(between.exact).toBe(false);
  });

  it("never places a step backwards", () => {
    const main = placed.filter((s) => s.variant === "main-route" && s.prog != null);
    const progs = main.map((s) => s.prog!);
    expect([...progs].sort((a, b) => a - b)).toEqual(progs);
  });

  it("uses the notes' own first variant as the track when none is named", () => {
    // The id comes from the heading text, so "main" would match nothing.
    expect(placed.find((s) => s.text.startsWith("Cross the stone bridge"))?.prog).toBe(0);
  });

  it("places a step on another variant only where it names a waypoint", () => {
    const harder = placed.filter((s) => s.variant === "harder-option");
    expect(harder.find((s) => s.ref === "A")?.prog).toBe(3000);
    expect(harder.find((s) => s.ref === "B")?.prog).toBe(4600);
  });

  it("leaves an unplaceable step in the list rather than dropping it", () => {
    const odd = parseNotes("# X\n\n0:10 1km  [nowhere] Turn L.\n");
    const [step] = placeSteps(odd.steps, [], 5000);
    expect(step?.prog).not.toBeUndefined();
    expect(step?.text).toBe("Turn L.");
  });

  it("ignores a reference that would send the walk backwards", () => {
    // A mistyped bracket must cost one step, not the rest of the day.
    const bad: NoteAnchor[] = [
      { name: "1", prog: 700 },
      { name: "2", prog: 200 },
    ];
    const out = placeSteps(notes.steps, bad, 12000);
    const main = out.filter((s) => s.variant === "main-route" && s.prog != null && !s.exact);
    const progs = main.map((s) => s.prog!);
    expect([...progs].sort((a, b) => a - b)).toEqual(progs);
  });
});

describe("placeSteps, anchoring on places named in prose", () => {
  // These notes bracket the turns and write the places into the sentence.
  const NOTES = `# Day
0:00 0km  Leave the square and cross the bridge, keeping the gallery of Casa Cayo in view across the river. Follow the lane for 400m to reach the hamlet of Congarna.

0:10 900m  At the crossroads take the third right and descend for 350m to reach Camaleño.

0:20 1.6km  Continue between the walls to the shrine.
`;

  it("anchors the next step on a place the step ends at", () => {
    const placed = placeSteps(parseNotes(NOTES).steps, [{ name: "Congarna", prog: 1000 }], 5000);
    expect(placed[1]?.prog).toBe(1000);
  });

  it("ignores a place merely seen along the way", () => {
    // "keeping the gallery of Casa Cayo in view" is not an instruction to
    // arrive there, and it is not in the step's last sentence.
    const placed = placeSteps(
      parseNotes(NOTES).steps,
      [{ name: "Casa Cayo", prog: 4000 }],
      5000,
    );
    expect(placed[1]?.prog).not.toBe(4000);
  });

  it("matches across accents and the little words of a sentence", () => {
    // Notes write "Camaleño"; the GPX says "Camaleno".
    const placed = placeSteps(parseNotes(NOTES).steps, [{ name: "Camaleno", prog: 2000 }], 5000);
    expect(placed[2]?.prog).toBe(2000);
  });

  it("does not anchor on a bare number or letter found in prose", () => {
    const placed = placeSteps(parseNotes(NOTES).steps, [{ name: "A", prog: 4500 }], 5000);
    expect(placed[1]?.prog).not.toBe(4500);
  });

  it("keeps the many consistent anchors and drops the odd one out", () => {
    // The real case: one waypoint named for a village the route passes on
    // both variants, matching a point kilometres from where the walk is.
    const placed = placeSteps(
      parseNotes(NOTES).steps,
      [
        { name: "Congarna", prog: 1000 },
        { name: "Camaleno", prog: 90 }, // the other variant's pass
      ],
      5000,
    );
    expect(placed[1]?.prog).toBe(1000);
    expect(placed[2]?.prog).toBeGreaterThan(1000);
  });

  it("is not thrown by a wrong anchor arriving first", () => {
    // Greedy acceptance would take the early wrong one and drop both good
    // ones after it; keeping the longest consistent run does the opposite.
    const notes = parseNotes(
      "# D\n\n0:00 0km  Walk to Alpha.\n\n0:10 1km  Walk to Beta.\n\n0:20 2km  Walk to Gamma.\n\n0:30 3km  Stop.\n",
    );
    const placed = placeSteps(
      notes.steps,
      [
        { name: "Alpha", prog: 4000 }, // wrong: would go backwards
        { name: "Beta", prog: 1000 },
        { name: "Gamma", prog: 2000 },
      ],
      5000,
    );
    expect(placed[2]?.prog).toBe(1000);
    expect(placed[3]?.prog).toBe(2000);
  });
});

describe("placeSteps, when a name has several positions on the track", () => {
  // A track that doubles back gives a waypoint more than one plausible
  // place. The caller lists them nearest first.
  const NOTES = `# Day
0:00 0km  [start] Leave the square.

0:10 1km  Walk on to the chapel.

0:20 2km  [end] Arrive.
`;

  it("believes the nearest position when it fits", () => {
    const placed = placeSteps(
      parseNotes(NOTES).steps,
      [
        { name: "start", prog: 100 }, // nearest
        { name: "start", prog: 8000 }, // the other pass
        { name: "end", prog: 2100 },
      ],
      9000,
    );
    expect(placed[0]?.prog).toBe(100);
  });

  it("uses a further position when the nearest cannot fit", () => {
    // The real case: the monastery's nearest pass is on the other variant,
    // eleven kilometres from where this route reaches it.
    const placed = placeSteps(
      parseNotes(NOTES).steps,
      [
        { name: "start", prog: 100 },
        { name: "end", prog: 2100 },
        { name: "chapel", prog: 8000 }, // nearest, but out of the way
        { name: "chapel", prog: 1050 }, // the pass this walk uses
      ],
      9000,
    );
    // The chapel is named in the middle step's last sentence, so it anchors
    // the step after it — which must still be the arrival at 2100.
    expect(placed[2]?.prog).toBe(2100);
    expect(placed[1]?.prog).toBeGreaterThan(100);
    expect(placed[1]?.prog).toBeLessThan(2100);
  });

  it("never lets an alternative displace an anchor already agreed", () => {
    const placed = placeSteps(
      parseNotes(NOTES).steps,
      [
        { name: "start", prog: 100 },
        { name: "end", prog: 2100 },
        { name: "end", prog: 150 }, // an alternative that would reorder
      ],
      9000,
    );
    expect(placed[0]?.prog).toBe(100);
    expect(placed[2]?.prog).toBe(2100);
  });
});

describe("stepAt", () => {
  const notes = parseNotes(SAMPLE);
  const placed = placeSteps(notes.steps, [{ name: "1", prog: 700 }, { name: "2", prog: 3600 }], 12000);

  it("gives the step you are in and the one coming", () => {
    const { current, next } = stepAt(placed, 800);
    expect(current?.ref).toBe("1");
    expect(next?.prog).toBeGreaterThan(800);
  });

  it("has no current step before the first one", () => {
    expect(stepAt(placed, -50).current).toBeNull();
  });

  it("has no next step at the end", () => {
    expect(stepAt(placed, 99999).next).toBeNull();
  });
});
