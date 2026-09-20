import { describe, expect, it } from "vitest";
import { sunTimes } from "./sun.js";

/** Hour of day in UTC, as a decimal — the timezone-independent way to assert. */
const utcHours = (d: Date) => d.getUTCHours() + d.getUTCMinutes() / 60;

const PARIS = { lat: 48.8566, lon: 2.3522 };
const POTES = { lat: 43.1531, lon: -4.6283 }; // the Picos trailhead
const SVALBARD = { lat: 78.2, lon: 15.6 };

describe("sunTimes", () => {
  it("puts sunrise before sunset", () => {
    const t = sunTimes(POTES.lat, POTES.lon, new Date(2026, 6, 15, 12))!;
    expect(t.sunrise.getTime()).toBeLessThan(t.sunset.getTime());
  });

  /**
   * The bug that made this file worth writing: `n` must be a whole number of
   * days. Without the rounding the answer slid with the time of day, so the
   * same hike reported sunset at 06:53 in the morning and 00:22 at night.
   */
  describe("does not depend on what time of day you ask", () => {
    // Built from local components, because the function answers for the
    // viewer's calendar day — so these are all unambiguously "20 September"
    // whatever timezone the test machine is in.
    const answers = [0.5, 6, 10.25, 12, 15.75, 18, 23.5].map(
      (h) =>
        sunTimes(
          POTES.lat,
          POTES.lon,
          new Date(2026, 8, 20, Math.floor(h), (h % 1) * 60),
        )!,
    );

    it("gives the same sunset from every hour of the day", () => {
      const first = answers[0].sunset.getTime();
      for (const a of answers) {
        // Within a minute: the algorithm still solves for the same instant.
        expect(Math.abs(a.sunset.getTime() - first)).toBeLessThan(60_000);
      }
    });

    it("gives the same sunrise from every hour of the day", () => {
      const first = answers[0].sunrise.getTime();
      for (const a of answers) {
        expect(Math.abs(a.sunrise.getTime() - first)).toBeLessThan(60_000);
      }
    });
  });

  describe("matches published times", () => {
    // Checked against published almanac times; the algorithm claims about a
    // minute of accuracy and these assertions allow three.
    const cases: [string, { lat: number; lon: number }, [number, number], number, number][] = [
      ["Paris, midsummer", PARIS, [5, 21], 3.8, 19.97],
      ["Paris, midwinter", PARIS, [11, 21], 7.7, 15.93],
      ["Paris, equinox", PARIS, [8, 20], 5.57, 17.92],
      // Potes is on Spain's Atlantic side but keeps central European time, so
      // 18:22Z is a 20:22 sunset on the clock — the late Spanish evening.
      ["Potes, September", POTES, [8, 20], 6.07, 18.37],
    ];

    for (const [name, place, [month, day], sunriseUtc, sunsetUtc] of cases) {
      it(name, () => {
        const t = sunTimes(place.lat, place.lon, new Date(2026, month, day, 9))!;
        expect(utcHours(t.sunrise)).toBeCloseTo(sunriseUtc, 1);
        expect(utcHours(t.sunset)).toBeCloseTo(sunsetUtc, 1);
      });
    }
  });

  it("returns a sunset on the day that was asked about", () => {
    const t = sunTimes(POTES.lat, POTES.lon, new Date(2026, 8, 20, 9))!;
    expect(t.sunset.getFullYear()).toBe(2026);
    expect(t.sunset.getMonth()).toBe(8);
    expect(t.sunset.getDate()).toBe(20);
  });

  it("gives a much shorter day in winter than in summer", () => {
    const hours = (t: { sunrise: Date; sunset: Date }) =>
      (t.sunset.getTime() - t.sunrise.getTime()) / 3600000;
    const summer = sunTimes(POTES.lat, POTES.lon, new Date(2026, 5, 21, 9))!;
    const winter = sunTimes(POTES.lat, POTES.lon, new Date(2026, 11, 21, 9))!;
    expect(hours(summer)).toBeGreaterThan(15);
    expect(hours(winter)).toBeLessThan(9.5);
  });

  it("gives close to twelve hours of daylight at the equinox, anywhere", () => {
    const hours = (lat: number) => {
      const t = sunTimes(lat, 0, new Date(2026, 8, 22, 9))!;
      return (t.sunset.getTime() - t.sunrise.getTime()) / 3600000;
    };
    for (const lat of [-40, -10, 0, 30, 55]) {
      expect(hours(lat)).toBeGreaterThan(11.8);
      expect(hours(lat)).toBeLessThan(12.5);
    }
  });

  it("returns null in the polar day, where the sun never sets", () => {
    expect(sunTimes(SVALBARD.lat, SVALBARD.lon, new Date(2026, 5, 21, 9))).toBeNull();
  });

  it("returns null in the polar night", () => {
    expect(sunTimes(SVALBARD.lat, SVALBARD.lon, new Date(2026, 11, 21, 9))).toBeNull();
  });
});
