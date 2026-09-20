/**
 * The contract with Open-Meteo, checked against the live service.
 *
 * Everything else about the forecast is tested against a fixture, which
 * proves the parser and proves nothing about whether the service still sends
 * what the fixture claims. A renamed field would pass every one of those
 * tests and leave a walker looking at an empty column on a mountain.
 *
 * So this one really calls the API. It is skipped unless WEATHER_CONTRACT is
 * set, because a walk must never be blocked by someone else's outage, and it
 * runs on a schedule and on pull requests in its own workflow — where a
 * failure is a warning that the contract moved, not a broken deploy.
 */
import { describe, expect, it } from "vitest";
import { fetchForecast, HOURLY_FIELDS, forecastUrl } from "./weather.js";

const live = process.env["WEATHER_CONTRACT"] === "1";

describe.skipIf(!live)("Open-Meteo, live", () => {
  // Fuente Dé: valley station and the top of the cable car, which is the
  // whole point — two heights a few kilometres apart.
  const POINTS = [
    { lat: 43.1449, lon: -4.8147, ele: 1070 },
    { lat: 43.1637, lon: -4.8274, ele: 1823 },
  ];

  it("answers with an entry per point", async () => {
    const out = await fetchForecast(POINTS, { days: 2 });
    expect(out).toHaveLength(2);
    for (const p of out) expect(p.hours.length).toBeGreaterThan(20);
  }, 30_000);

  it("still sends every field the app reads", async () => {
    const res = await fetch(forecastUrl(POINTS, { days: 1 }));
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Array<{ hourly: Record<string, unknown> }>;
    const hourly = body[0]!.hourly;
    // Named individually so a failure says which field went, not just that
    // one did.
    for (const field of HOURLY_FIELDS) {
      expect(Array.isArray(hourly[field]), `hourly.${field} is missing`).toBe(true);
    }
  }, 30_000);

  it("honours the elevation asked for, rather than its own terrain", async () => {
    const [valley, top] = await fetchForecast(POINTS, { days: 1 });
    // Not an assertion about the weather: 750 m apart, the model's own
    // elevations must differ, or the elevation parameter is being ignored.
    expect(valley!.modelEle).not.toBe(top!.modelEle);
  }, 30_000);

  it("reports times that parse as UTC", async () => {
    const [p] = await fetchForecast(POINTS.slice(0, 1), { days: 1 });
    const first = p!.hours[0]!.time;
    expect(Number.isFinite(first)).toBe(true);
    expect(Math.abs(first - Date.now())).toBeLessThan(36 * 3600_000);
  }, 30_000);
});
