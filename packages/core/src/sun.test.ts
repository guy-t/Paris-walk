import { describe, expect, it } from "vitest";
import { sunTimes } from "./sun.js";

describe("sunTimes", () => {
  it("puts sunrise before sunset", () => {
    const t = sunTimes(43.15, -4.75, new Date("2026-07-15T12:00:00Z"))!;
    expect(t.sunrise.getTime()).toBeLessThan(t.sunset.getTime());
  });

  it("matches a known Paris midsummer sunset", () => {
    // 21 June 2026 in Paris: sunset is about 19:57 UTC (21:57 local).
    const t = sunTimes(48.8566, 2.3522, new Date("2026-06-21T12:00:00Z"))!;
    const utcHours = t.sunset.getUTCHours() + t.sunset.getUTCMinutes() / 60;
    expect(utcHours).toBeCloseTo(19.95, 1);
  });

  it("matches a known Paris midwinter sunset", () => {
    // 21 December 2026 in Paris: sunset is about 15:55 UTC.
    const t = sunTimes(48.8566, 2.3522, new Date("2026-12-21T12:00:00Z"))!;
    const utcHours = t.sunset.getUTCHours() + t.sunset.getUTCMinutes() / 60;
    expect(utcHours).toBeCloseTo(15.92, 1);
  });

  it("gives a much shorter day in winter than in summer", () => {
    const summer = sunTimes(43.15, -4.75, new Date("2026-06-21T12:00:00Z"))!;
    const winter = sunTimes(43.15, -4.75, new Date("2026-12-21T12:00:00Z"))!;
    const hours = (t: { sunrise: Date; sunset: Date }) =>
      (t.sunset.getTime() - t.sunrise.getTime()) / 3600000;
    expect(hours(summer)).toBeGreaterThan(14);
    expect(hours(winter)).toBeLessThan(10);
  });

  it("returns null in the polar day, where the sun never sets", () => {
    expect(sunTimes(78.2, 15.6, new Date("2026-06-21T12:00:00Z"))).toBeNull();
  });

  it("returns null in the polar night", () => {
    expect(sunTimes(78.2, 15.6, new Date("2026-12-21T12:00:00Z"))).toBeNull();
  });
});
