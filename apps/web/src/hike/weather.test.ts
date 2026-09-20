// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { processTrack, type PointForecast, type WeatherHour } from "@slownav/core";
import { arrivalsFor, routeWeather, sampleRoute, summarise } from "./weather.js";

/** A route that climbs to a top a third of the way along, then descends. */
function track() {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 120; i++) {
    const up = i <= 40;
    const ele = up ? 300 + i * 40 : 1900 - (i - 40) * 15;
    pts.push([43.15 + i * 0.001, -4.75 - i * 0.001, ele]);
  }
  return processTrack(pts, 5);
}

describe("sampleRoute", () => {
  it("always asks about the start, the top and the end", () => {
    const labels = sampleRoute(track()).map((s) => s.label);
    expect(labels).toContain("Start");
    expect(labels).toContain("Highest point");
    expect(labels).toContain("End");
  });

  it("puts the highest point where the route is actually highest", () => {
    const top = sampleRoute(track()).find((s) => s.label === "Highest point")!;
    const highest = Math.max(...track().ele);
    expect(top.ele).toBeCloseTo(Math.round(highest), 0);
  });

  it("returns them in route order, so the list reads as the walk", () => {
    const progs = sampleRoute(track()).map((s) => s.prog);
    expect([...progs].sort((a, b) => a - b)).toEqual(progs);
  });

  it("does not crowd the route with evenly spaced fills", () => {
    const samples = sampleRoute(track(), 8);
    const fills = samples.filter((s) => s.label.startsWith("km")).map((s) => s.prog);
    for (const f of fills) {
      const others = samples.filter((s) => s.prog !== f);
      expect(Math.min(...others.map((o) => Math.abs(o.prog - f)))).toBeGreaterThanOrEqual(1500);
    }
  });

  it("keeps the highest point even when it is close to the start", () => {
    // A route that climbs hard and then descends all day: the top is near
    // the start, and it is still the row worth reading.
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 100; i++) {
      pts.push([43.15 + i * 0.001, -4.75, i <= 4 ? 300 + i * 300 : 1500 - (i - 4) * 12]);
    }
    const labels = sampleRoute(processTrack(pts, 5)).map((s) => s.label);
    expect(labels.some((l) => l.includes("Highest point"))).toBe(true);
  });

  it("names one row twice rather than listing the same point twice", () => {
    // A route whose highest point is its start.
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 100; i++) pts.push([43.15 + i * 0.001, -4.75, 2000 - i * 12]);
    const samples = sampleRoute(processTrack(pts, 5));
    expect(samples.filter((s) => s.prog === 0)).toHaveLength(1);
    expect(samples[0]!.label).toContain("Start");
    expect(samples[0]!.label).toContain("highest point");
  });

  it("has nothing to say about an empty route", () => {
    expect(sampleRoute(processTrack([], 5))).toEqual([]);
  });
});

describe("arrivalsFor", () => {
  const t = track();

  it("puts each sample later than the one before", () => {
    const s = sampleRoute(t);
    const a = arrivalsFor(t, s, 0, 1_000_000);
    for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThan(a[i - 1]!);
  });

  it("reports a sample already behind as happening now", () => {
    const s = sampleRoute(t);
    const now = 1_000_000;
    // Standing at the end: everything is in the past.
    expect(arrivalsFor(t, s, t.length, now)[0]).toBe(now);
  });

  it("slides everything later when the walker is slower than planned", () => {
    const s = sampleRoute(t);
    const planned = arrivalsFor(t, s, 0, 0, 1);
    const slow = arrivalsFor(t, s, 0, 0, 1.5);
    expect(slow.at(-1)!).toBeGreaterThan(planned.at(-1)!);
  });
});

const hour = (over: Partial<WeatherHour> = {}): WeatherHour => ({
  time: 0, tempC: 4, feelsC: 1, precipMm: 0, precipChance: 5, code: 3,
  windKph: 10, gustKph: 15, windDir: 270, cloudPct: 60,
  freezingLevelM: 2500, pressureMslHPa: 1012, ...over,
});

describe("summarise", () => {
  it("leads with the temperature and what the sky is doing", () => {
    expect(summarise(hour(), false)).toBe("4°C · overcast");
  });

  it("says snow instead of rain when that is what will fall", () => {
    expect(summarise(hour({ code: 61, precipMm: 2, precipChance: 80 }), true)).toContain("snow");
  });

  it("mentions rain only when it is likely enough to matter", () => {
    expect(summarise(hour({ precipChance: 10 }), false)).not.toContain("rain");
    expect(summarise(hour({ precipChance: 70 }), false)).toContain("70% rain");
  });

  it("mentions gusts only when they are worth knowing about", () => {
    expect(summarise(hour({ gustKph: 20 }), false)).not.toContain("gusts");
    expect(summarise(hour({ gustKph: 75 }), false)).toContain("gusts 75 km/h");
  });

  it("says so plainly when the walk runs past the forecast", () => {
    expect(summarise(null, false)).toBe("No forecast for that hour");
  });
});

describe("routeWeather", () => {
  it("reads each sample at the hour it will be reached", () => {
    const samples = sampleRoute(track()).slice(0, 2);
    const base = Date.parse("2026-09-20T06:00Z");
    const forecasts: PointForecast[] = samples.map((s) => ({
      lat: s.lat, lon: s.lon, ele: s.ele, modelEle: s.ele,
      hours: [0, 1, 2, 3, 4, 5].map((h) => hour({ time: base + h * 3600_000, tempC: h })),
    }));
    const out = routeWeather(samples, forecasts, [base, base + 3 * 3600_000]);
    expect(out[0]?.hour?.tempC).toBe(0);
    expect(out[1]?.hour?.tempC).toBe(3);
  });

  it("says there is no forecast rather than showing the wrong hour", () => {
    const samples = sampleRoute(track()).slice(0, 1);
    const forecasts: PointForecast[] = [
      { ...samples[0]!, modelEle: 0, hours: [hour({ time: 0 })] },
    ];
    const out = routeWeather(samples, forecasts, [Date.parse("2026-09-20T06:00Z")]);
    expect(out[0]?.hour).toBeNull();
    expect(out[0]?.summary).toContain("No forecast");
  });
});
