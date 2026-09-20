import { describe, expect, it } from "vitest";
import {
  fallsAsSnow,
  forecastUrl,
  hourAt,
  HOURLY_FIELDS,
  parseForecast,
  weatherLabel,
  type WeatherHour,
} from "./weather.js";

const POINTS = [
  { lat: 43.1551, lon: -4.7523, ele: 300 },
  { lat: 43.1712, lon: -4.8104, ele: 1900 },
];

/** A response shaped like the service's, with the fields the app reads. */
function response(times: string[], over: Record<string, unknown> = {}) {
  const n = times.length;
  const fill = (v: number) => Array.from({ length: n }, () => v);
  return {
    latitude: 43.15,
    longitude: -4.75,
    elevation: 312,
    hourly: {
      time: times,
      temperature_2m: fill(11),
      apparent_temperature: fill(9),
      precipitation: fill(0),
      precipitation_probability: fill(10),
      weather_code: fill(3),
      wind_speed_10m: fill(12),
      wind_gusts_10m: fill(30),
      wind_direction_10m: fill(270),
      cloud_cover: fill(80),
      freezing_level_height: fill(2600),
      pressure_msl: fill(1013),
      ...over,
    },
  };
}

describe("forecastUrl", () => {
  it("asks for every point in one request, in order, with its own elevation", () => {
    const u = new URL(forecastUrl(POINTS));
    expect(u.searchParams.get("latitude")).toBe("43.1551,43.1712");
    expect(u.searchParams.get("longitude")).toBe("-4.7523,-4.8104");
    expect(u.searchParams.get("elevation")).toBe("300,1900");
  });

  it("asks for UTC, so an hour never silently means something else", () => {
    expect(new URL(forecastUrl(POINTS)).searchParams.get("timezone")).toBe("UTC");
  });

  it("asks for exactly the fields the app reads", () => {
    const hourly = new URL(forecastUrl(POINTS)).searchParams.get("hourly");
    expect(hourly?.split(",")).toEqual([...HOURLY_FIELDS]);
  });

  it("refuses to build a request for nowhere", () => {
    expect(() => forecastUrl([])).toThrow();
  });
});

describe("parseForecast", () => {
  it("reads an array of points back in the order they were asked for", () => {
    const out = parseForecast(
      [response(["2026-09-20T06:00"]), response(["2026-09-20T06:00"])],
      POINTS,
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.ele).toBe(300);
    expect(out[1]?.ele).toBe(1900);
  });

  it("reads a single point returned as an object rather than an array", () => {
    const out = parseForecast(response(["2026-09-20T06:00"]), [POINTS[0]!]);
    expect(out[0]?.hours[0]?.tempC).toBe(11);
  });

  it("treats a bare time as UTC rather than guessing", () => {
    const [p] = parseForecast(response(["2026-09-20T06:00"]), [POINTS[0]!]);
    expect(p?.hours[0]?.time).toBe(Date.parse("2026-09-20T06:00Z"));
  });

  it("keeps the model's own elevation, which is not the one asked for", () => {
    expect(parseForecast(response(["2026-09-20T06:00"]), [POINTS[0]!])[0]?.modelEle).toBe(312);
  });

  it("carries on when the service drops a field, leaving that column empty", () => {
    // A renamed field should cost that one reading, not the whole forecast.
    const r = response(["2026-09-20T06:00"]);
    delete (r.hourly as Record<string, unknown>)["wind_gusts_10m"];
    const [p] = parseForecast(r, [POINTS[0]!]);
    expect(p?.hours[0]?.gustKph).toBeNull();
    expect(p?.hours[0]?.tempC).toBe(11);
  });

  it("nulls a reading that is not a number rather than passing it on", () => {
    const [p] = parseForecast(
      response(["2026-09-20T06:00"], { temperature_2m: [null] }),
      [POINTS[0]!],
    );
    expect(p?.hours[0]?.tempC).toBeNull();
  });

  it("throws when there are no hours, rather than showing an empty forecast", () => {
    expect(() => parseForecast({ hourly: { time: [] } }, [POINTS[0]!])).toThrow(/hourly times/);
    expect(() => parseForecast({}, [POINTS[0]!])).toThrow();
  });
});

describe("hourAt", () => {
  const hours: WeatherHour[] = ["06:00", "07:00", "08:00"].map((t) => ({
    time: Date.parse(`2026-09-20T${t}Z`),
    tempC: 1,
    feelsC: null, precipMm: null, precipChance: null, code: null,
    windKph: null, gustKph: null, windDir: null, cloudPct: null,
    freezingLevelM: null, pressureMslHPa: null,
  }));

  it("picks the hour you are inside, not the nearest boundary", () => {
    expect(hourAt(hours, Date.parse("2026-09-20T06:59Z"))?.time).toBe(
      Date.parse("2026-09-20T06:00Z"),
    );
  });

  it("gives nothing when the time is off the end of the forecast", () => {
    expect(hourAt(hours, Date.parse("2026-09-22T06:00Z"))).toBeNull();
  });
});

describe("weatherLabel", () => {
  it("says what the code means, in words a walker uses", () => {
    expect(weatherLabel(0)).toBe("Clear");
    expect(weatherLabel(71)).toBe("Snow");
    expect(weatherLabel(95)).toBe("Thunderstorm");
  });

  it("does not invent a label for a code it does not know", () => {
    expect(weatherLabel(null)).toBe("—");
    expect(weatherLabel(4242)).toBe("—");
  });
});

describe("fallsAsSnow", () => {
  const hour = (over: Partial<WeatherHour>): WeatherHour => ({
    time: 0, tempC: null, feelsC: null, precipMm: 1, precipChance: null, code: null,
    windKph: null, gustKph: null, windDir: null, cloudPct: null,
    freezingLevelM: 1800, pressureMslHPa: null, ...over,
  });

  it("is snow above the freezing level", () => {
    expect(fallsAsSnow(hour({}), 2100)).toBe(true);
  });

  it("is snow a little below it too — the changeover is not a line", () => {
    expect(fallsAsSnow(hour({}), 1700)).toBe(true);
  });

  it("is not snow well below it", () => {
    expect(fallsAsSnow(hour({}), 900)).toBe(false);
  });

  it("is nothing at all when no precipitation is forecast", () => {
    expect(fallsAsSnow(hour({ precipMm: 0 }), 2100)).toBe(false);
  });
});
