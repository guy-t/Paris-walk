/**
 * Mountain weather, at the height you will actually be standing.
 *
 * A forecast for "Potes" is a forecast for 300 m in a valley. The walk goes
 * to 1,900 m, where it is roughly 10°C colder, the wind is doing something
 * else entirely, and the rain may be snow. A forecast that does not know
 * about height is not wrong so much as answering a different question.
 *
 * Open-Meteo is used because it takes an elevation per point, serves several
 * points in one request, needs no API key, and permits caching — the same
 * entry requirement the map providers have to meet, and for the same reason:
 * the forecast has to be on the phone before the signal goes.
 *
 * Everything here is pure except `fetchForecast`. The URL and the parsing are
 * separated deliberately: the URL is the contract with a service nobody here
 * controls, and it is checked against the live API in CI rather than trusted.
 */

/** The hourly fields asked for. The contract, in one place. */
export const HOURLY_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation",
  "precipitation_probability",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "cloud_cover",
  "freezing_level_height",
  "pressure_msl",
] as const;

export type HourlyField = (typeof HOURLY_FIELDS)[number];

/** Somewhere on the route to ask about. */
export interface ForecastPoint {
  lat: number;
  lon: number;
  /** Metres. The whole point: the model is downscaled to this. */
  ele: number;
}

/** One hour of weather at one place. */
export interface WeatherHour {
  /** Start of the hour, ms since epoch (UTC). */
  time: number;
  tempC: number | null;
  feelsC: number | null;
  precipMm: number | null;
  precipChance: number | null;
  code: number | null;
  windKph: number | null;
  gustKph: number | null;
  windDir: number | null;
  cloudPct: number | null;
  /** Height of the 0°C isotherm, metres. Below you, the rain is snow. */
  freezingLevelM: number | null;
  /** Sea-level pressure, hPa — the reference a barometer needs. */
  pressureMslHPa: number | null;
}

export interface PointForecast {
  lat: number;
  lon: number;
  /** The elevation asked for. */
  ele: number;
  /** The elevation the model actually used, which is not always the same. */
  modelEle: number | null;
  hours: WeatherHour[];
}

export interface ForecastOptions {
  /** How many days ahead. Three is plenty for a walk and keeps it small. */
  days?: number;
  signal?: AbortSignal;
  /** Overridable so a test never has to reach the network by accident. */
  endpoint?: string;
}

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/**
 * The request for a set of points.
 *
 * Open-Meteo takes comma-separated coordinates and returns an array in the
 * same order, so a whole route costs one request rather than one per point.
 * Times are asked for in UTC: the walker's phone knows its own offset, and a
 * forecast that silently changes timezone halfway through a border-straddling
 * range is a bug waiting to happen.
 */
export function forecastUrl(
  points: readonly ForecastPoint[],
  opts: ForecastOptions = {},
): string {
  if (!points.length) throw new Error("A forecast needs at least one point");
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    elevation: points.map((p) => Math.round(p.ele)).join(","),
    hourly: HOURLY_FIELDS.join(","),
    timezone: "UTC",
    forecast_days: String(opts.days ?? 3),
  });
  return `${opts.endpoint ?? ENDPOINT}?${q.toString()}`;
}

function numbers(series: unknown, length: number): (number | null)[] {
  if (!Array.isArray(series)) return new Array<number | null>(length).fill(null);
  return Array.from({ length }, (_, i) => {
    const v = series[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  });
}

/**
 * Parse a response into forecasts, in the order the points were asked for.
 *
 * Deliberately forgiving about fields and strict about shape. A field the
 * service stops sending leaves nulls in that column, and the rest of the
 * forecast still reaches the walker; a response with no usable hours at all
 * is an error, because silently showing an empty forecast on a mountain is
 * worse than saying the forecast could not be had.
 */
export function parseForecast(json: unknown, points: readonly ForecastPoint[]): PointForecast[] {
  const list = Array.isArray(json) ? json : [json];
  if (!list.length) throw new Error("The forecast service returned nothing");

  return points.map((point, i) => {
    // One point asked for returns an object, several return an array; a
    // short array means the service dropped some, so fall back to the first.
    const raw = (list[i] ?? list[0]) as Record<string, unknown> | undefined;
    const hourly = raw?.["hourly"] as Record<string, unknown> | undefined;
    const times = hourly?.["time"];
    if (!Array.isArray(times) || !times.length) {
      throw new Error("The forecast has no hourly times — the service may have changed");
    }

    const at = (field: HourlyField) => numbers(hourly?.[field], times.length);
    const temp = at("temperature_2m");
    const feels = at("apparent_temperature");
    const precip = at("precipitation");
    const chance = at("precipitation_probability");
    const code = at("weather_code");
    const wind = at("wind_speed_10m");
    const gust = at("wind_gusts_10m");
    const dir = at("wind_direction_10m");
    const cloud = at("cloud_cover");
    const freezing = at("freezing_level_height");
    const msl = at("pressure_msl");

    const hours: WeatherHour[] = [];
    for (let h = 0; h < times.length; h++) {
      const t = times[h];
      // Open-Meteo sends "2026-09-20T14:00" with no zone, and it is UTC
      // because that is what was asked for. Date.parse of a bare local-time
      // string is implementation-defined, so the Z is added rather than
      // hoped for.
      const ms =
        typeof t === "number"
          ? t * 1000
          : typeof t === "string"
            ? Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`)
            : NaN;
      if (!Number.isFinite(ms)) continue;
      hours.push({
        time: ms,
        tempC: temp[h] ?? null,
        feelsC: feels[h] ?? null,
        precipMm: precip[h] ?? null,
        precipChance: chance[h] ?? null,
        code: code[h] ?? null,
        windKph: wind[h] ?? null,
        gustKph: gust[h] ?? null,
        windDir: dir[h] ?? null,
        cloudPct: cloud[h] ?? null,
        freezingLevelM: freezing[h] ?? null,
        pressureMslHPa: msl[h] ?? null,
      });
    }
    if (!hours.length) throw new Error("The forecast had no readable hours");

    const modelEle = raw?.["elevation"];
    return {
      lat: point.lat,
      lon: point.lon,
      ele: point.ele,
      modelEle: typeof modelEle === "number" ? modelEle : null,
      hours,
    };
  });
}

/** Fetch a forecast for these points. Throws with something sayable out loud. */
export async function fetchForecast(
  points: readonly ForecastPoint[],
  opts: ForecastOptions = {},
): Promise<PointForecast[]> {
  const res = await fetch(forecastUrl(points, opts), {
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) throw new Error(`The forecast service answered ${res.status}`);
  return parseForecast(await res.json(), points);
}

/** The hour covering this moment, or the nearest one within an hour of it. */
export function hourAt(hours: readonly WeatherHour[], when: number): WeatherHour | null {
  let best: WeatherHour | null = null;
  let bestGap = Infinity;
  for (const h of hours) {
    // An hour's forecast covers the hour it starts, so being inside it is a
    // gap of zero rather than up to an hour.
    const gap = when >= h.time && when < h.time + 3600_000 ? 0 : Math.abs(when - h.time);
    if (gap < bestGap) {
      bestGap = gap;
      best = h;
    }
  }
  return bestGap <= 3600_000 ? best : null;
}

/** WMO weather code as a few words. */
export function weatherLabel(code: number | null): string {
  if (code == null) return "—";
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code >= 71 && code <= 75) return "Snow";
  if (code === 77) return "Snow grains";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm, hail";
  return "—";
}

/**
 * Is it going to be falling as snow at this height?
 *
 * The freezing level is where 0°C is; below it precipitation is usually rain,
 * above it snow, and the changeover is a few hundred metres deep rather than
 * a line. Worth knowing before a col at 1,900 m in October.
 */
export function fallsAsSnow(hour: WeatherHour, ele: number): boolean {
  if (hour.freezingLevelM == null || (hour.precipMm ?? 0) <= 0) return false;
  return ele > hour.freezingLevelM - 200;
}
