// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseFixes } from "./geolocation.js";

/** What the Android service actually puts on the wire. */
const fix = (over: Record<string, unknown> = {}) =>
  JSON.stringify([
    { lat: 43.1534, lon: -4.6235, accuracy: 8, altitude: 291, speed: 1.2, heading: 270, timestamp: 1000, ...over },
  ]);

describe("parseFixes", () => {
  it("reads a fix the service queued", () => {
    expect(parseFixes(fix())[0]).toEqual({
      lat: 43.1534,
      lon: -4.6235,
      accuracy: 8,
      altitude: 291,
      speed: 1.2,
      heading: 270,
      timestamp: 1000,
    });
  });

  it("puts them in time order, whatever order they arrive in", () => {
    // The tracker folds fixes in sequence; one out of order reads as a jump
    // back down the route and then a jump forward again.
    const raw = JSON.stringify([
      { lat: 1, lon: 1, timestamp: 3000 },
      { lat: 1, lon: 1, timestamp: 1000 },
      { lat: 1, lon: 1, timestamp: 2000 },
    ]);
    expect(parseFixes(raw).map((f) => f.timestamp)).toEqual([1000, 2000, 3000]);
  });

  it("drops an entry with no position rather than inventing one", () => {
    // Number(null) is 0, so coercing here would put a fix with no latitude
    // in the Gulf of Guinea and show it to the walker as their position.
    expect(parseFixes(fix({ lat: null }))).toEqual([]);
    expect(parseFixes(fix({ lon: "somewhere" }))).toEqual([]);
    expect(parseFixes(JSON.stringify([null, 7, "no"]))).toEqual([]);
  });

  it("does not turn a missing altitude into sea level", () => {
    expect(parseFixes(fix({ altitude: null }))[0]!.altitude).toBeNull();
    expect(parseFixes(fix({ speed: null }))[0]!.speed).toBeNull();
    expect(parseFixes(fix({ accuracy: null }))[0]!.accuracy).toBe(50);
  });

  it("fills in what a fix may legitimately lack", () => {
    // A phone without a barometric altitude, or standing still, reports
    // neither altitude nor bearing; that is not a broken fix.
    const bare = parseFixes(JSON.stringify([{ lat: 43, lon: -4 }]))[0]!;
    expect(bare.accuracy).toBe(50);
    expect(bare.altitude).toBeNull();
    expect(bare.speed).toBeNull();
    expect(bare.heading).toBeNull();
    expect(bare.timestamp).toBeGreaterThan(0);
  });

  it("survives anything that is not a queue of fixes", () => {
    for (const raw of [null, undefined, "", "not json", "{}", "[", '"a string"', "123"]) {
      expect(parseFixes(raw)).toEqual([]);
    }
  });
});
