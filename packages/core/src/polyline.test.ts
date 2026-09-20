import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polyline.js";

describe("decodePolyline", () => {
  it("decodes the example from Google's specification", () => {
    // The canonical test string, at precision 5.
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBeCloseTo(38.5, 5);
    expect(pts[0][1]).toBeCloseTo(-120.2, 5);
    expect(pts[2][0]).toBeCloseTo(43.252, 5);
    expect(pts[2][1]).toBeCloseTo(-126.453, 5);
  });

  it("defaults to precision 6, as Valhalla returns", () => {
    const at5 = decodePolyline("_p~iF~ps|U", 5);
    const at6 = decodePolyline("_p~iF~ps|U");
    expect(at6[0][0]).toBeCloseTo(at5[0][0] / 10, 6);
  });

  it("returns nothing for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});
