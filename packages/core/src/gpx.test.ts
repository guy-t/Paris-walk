// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseGPX, toGPX } from "./gpx.js";

const TRACK_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Metadata name</name></metadata>
  <wpt lat="43.1210" lon="-4.7280"><name>Potes</name><desc>Start of the walk</desc></wpt>
  <wpt lat="43.1500" lon="-4.6540"><name>2</name></wpt>
  <trk>
    <name>Potes to Cosgaya</name>
    <trkseg>
      <trkpt lat="43.1210" lon="-4.7280"><ele>696</ele></trkpt>
      <trkpt lat="43.1250" lon="-4.7200"><ele>702.4</ele></trkpt>
      <trkpt lat="43.1300" lon="-4.7100"><ele>715</ele></trkpt>
      <trkpt lat="43.1500" lon="-4.6540"><ele>547</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const ROUTE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>A route, not a track</name>
    <rtept lat="48.8530" lon="2.3499"><ele>35</ele></rtept>
    <rtept lat="48.8600" lon="2.3400"><ele>40</ele></rtept>
    <rtept lat="48.8867" lon="2.3431"><ele>130</ele></rtept>
  </rte>
</gpx>`;

describe("parseGPX", () => {
  it("reads the track name in preference to the metadata name", () => {
    expect(parseGPX(TRACK_GPX).name).toBe("Potes to Cosgaya");
  });

  it("reads the points with their elevations", () => {
    const { pts } = parseGPX(TRACK_GPX);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(pts[0][0]).toBeCloseTo(43.121, 4);
    expect(pts[0][1]).toBeCloseTo(-4.728, 4);
    expect(pts[0][2]).toBe(696);
  });

  it("rounds elevation to whole metres", () => {
    const { pts } = parseGPX(TRACK_GPX);
    for (const p of pts) expect(Number.isInteger(p[2])).toBe(true);
  });

  it("reads waypoints with their descriptions", () => {
    const { wpts } = parseGPX(TRACK_GPX);
    expect(wpts).toHaveLength(2);
    expect(wpts[0].name).toBe("Potes");
    expect(wpts[0].desc).toBe("Start of the walk");
    expect(wpts[1].desc).toBe("");
  });

  it("falls back to a route when there is no track", () => {
    const { name, pts } = parseGPX(ROUTE_GPX);
    expect(name).toBe("A route, not a track");
    expect(pts.length).toBeGreaterThanOrEqual(2);
  });

  it("uses the fallback name when the file names nothing", () => {
    const anonymous = TRACK_GPX.replace(/<name>[^<]*<\/name>/g, "");
    expect(parseGPX(anonymous, "From my phone").name).toBe("From my phone");
  });

  it("rejects a file that is not XML", () => {
    expect(() => parseGPX("this is not a GPX file")).toThrow();
  });

  it("rejects XML with no track in it", () => {
    expect(() => parseGPX('<?xml version="1.0"?><gpx></gpx>')).toThrow(/No track/);
  });

  it("simplifies a dense track", () => {
    // 200 points a metre apart along a straight line: nothing is lost by
    // dropping the ones in between.
    const dense = Array.from(
      { length: 200 },
      (_, i) =>
        `<trkpt lat="${(43.12 + i * 0.00001).toFixed(6)}" lon="-4.728"><ele>700</ele></trkpt>`,
    ).join("");
    const gpx = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Dense</name><trkseg>${dense}</trkseg></trk></gpx>`;
    const { pts } = parseGPX(gpx);
    expect(pts.length).toBeLessThan(200);
    expect(pts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("toGPX", () => {
  it("writes a track that parses back to the same points", () => {
    const pts = [
      [43.121, -4.728, 696],
      [43.13, -4.71, 715],
      [43.15, -4.654, 547],
    ] as const;
    const round = parseGPX(toGPX("Round trip", pts));
    expect(round.name).toBe("Round trip");
    expect(round.pts[0][0]).toBeCloseTo(43.121, 5);
    expect(round.pts[0][2]).toBe(696);
  });

  it("omits times unless asked for them", () => {
    const pts = [
      [43.121, -4.728, 696, 1_700_000_000_000],
      [43.13, -4.71, 715, 1_700_000_060_000],
    ] as const;
    expect(toGPX("No times", pts)).not.toContain("<time>");
    expect(toGPX("With times", pts, true)).toContain("<time>2023-11-14T");
  });

  it("escapes a name that would otherwise break the XML", () => {
    const gpx = toGPX('Bob & "friends" <hello>', [
      [43.1, -4.7, 100],
      [43.11, -4.71, 120],
    ]);
    expect(gpx).toContain("&amp;");
    expect(gpx).not.toContain("<hello>");
    expect(() => parseGPX(gpx)).not.toThrow();
  });

  it("writes a point with no elevation", () => {
    const gpx = toGPX("No elevation", [[43.1, -4.7, null]]);
    expect(gpx).not.toContain("<ele>");
  });

  /**
   * A point with no elevation is written `<trkpt lat="…" lon="…"/>`, and the
   * build script's regex reader quietly skipped every one — 53 points from
   * one of the Basque files, 122 from the other, and 10 from a Picos day that
   * had already shipped 160 m short. A dropped point is a straight line
   * across whatever was there. `parseGPX` goes through the DOM and always
   * handled it; this is here so it keeps doing so.
   */
  it("reads a point written as a self-closing tag", () => {
    // A zigzag, so nothing here is collinear enough for `simplify` to drop:
    // this is testing what is read, not what survives thinning.
    const xml = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="43.100" lon="-4.600"><ele>300</ele></trkpt>
      <trkpt lat="43.101" lon="-4.601"/>
      <trkpt lat="43.100" lon="-4.602"></trkpt>
      <trkpt lon="-4.603" lat="43.101"/>
    </trkseg></trk></gpx>`;
    const { pts } = parseGPX(xml);
    expect(pts).toHaveLength(4);
    expect(pts[1]![0]).toBeCloseTo(43.101, 5);
    expect(pts[3]![1]).toBeCloseTo(-4.603, 5);
    expect(pts[3]![0]).toBeCloseTo(43.101, 5); // attributes in the other order
  });
});
