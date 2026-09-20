// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { importGpxFiles, importMessage } from "./importGpx.js";
import { library } from "./model.js";

const GPX = (name: string) => `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${name}</name><trkseg>
    <trkpt lat="43.15" lon="-4.75"><ele>300</ele></trkpt>
    <trkpt lat="43.16" lon="-4.74"><ele>340</ele></trkpt>
    <trkpt lat="43.17" lon="-4.73"><ele>380</ele></trkpt>
  </trkseg></trk>
</gpx>`;

const custom = () => library.list().filter((h) => !h.builtin);

describe("importGpxFiles", () => {
  beforeEach(() => localStorage.clear());

  it("imports a route and takes its name from the track", () => {
    const r = importGpxFiles([{ name: "day-one.gpx", text: GPX("Potes to Cosgaya") }]);
    expect(r.imported).toBe(1);
    expect(r.failures).toEqual([]);
    expect(r.lastName).toBe("Potes to Cosgaya");
    expect(custom().map((h) => h.name)).toEqual(["Potes to Cosgaya"]);
  });

  it("reports what could not be read without throwing", () => {
    const r = importGpxFiles([{ name: "notes.pdf", text: "%PDF-1.7 not xml at all" }]);
    expect(r.imported).toBe(0);
    expect(r.failures[0]).toContain("notes.pdf");
    expect(custom()).toEqual([]);
  });

  it("keeps going past a bad file in a batch", () => {
    const r = importGpxFiles([
      { name: "one.gpx", text: GPX("One") },
      { name: "junk.txt", text: "nope" },
      { name: "two.gpx", text: GPX("Two") },
    ]);
    expect(r.imported).toBe(2);
    expect(r.failures).toHaveLength(1);
    expect(custom()).toHaveLength(2);
  });

  it("replaces rather than duplicates when the same file arrives twice", () => {
    // Opening the same attachment again is ordinary, not a mistake.
    const file = { name: "day-one.gpx", text: GPX("Potes to Cosgaya") };
    importGpxFiles([file]);
    importGpxFiles([file]);
    expect(custom()).toHaveLength(1);
  });

  it("gives an importable route with no track name a name from the file", () => {
    const anon = GPX("").replace("<name></name>", "");
    const r = importGpxFiles([{ name: "Espinama loop.gpx", text: anon }]);
    expect(r.imported).toBe(1);
    expect(r.lastName).toBe("Espinama loop");
  });
});

describe("importMessage", () => {
  it("names the route when there is only one", () => {
    expect(importMessage({ imported: 1, failures: [], lastName: "Potes", lastId: "a" })).toBe(
      "Imported Potes",
    );
  });

  it("counts them when there are several", () => {
    expect(importMessage({ imported: 4, failures: [], lastName: "Potes", lastId: "a" })).toBe(
      "Imported 4 hikes",
    );
  });

  it("says what was skipped, rather than only what worked", () => {
    const msg = importMessage({
      imported: 2,
      failures: ["notes.pdf: Not a valid GPX file"],
      lastName: "Potes",
      lastId: "a",
    });
    expect(msg).toContain("Imported 2");
    expect(msg).toContain("notes.pdf");
  });

  it("leads with the failure when nothing worked", () => {
    expect(
      importMessage({ imported: 0, failures: ["a.gpx: No track in this GPX"], lastName: "", lastId: "" }),
    ).toBe("a.gpx: No track in this GPX");
  });
});
