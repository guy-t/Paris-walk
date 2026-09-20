/**
 * The forecast, tied to the route.
 *
 * Two things make a mountain forecast useful rather than decorative: the
 * height you will be at, and the time you will be there. A walk that starts
 * at 300 m in sunshine and reaches a 1,900 m col seven hours later is asking
 * about two different pieces of weather, and the second one is the one that
 * matters.
 *
 * So the route is sampled — start, top, end and a few in between — each
 * sample is forecast at its own elevation, and each is read at the hour the
 * walker is expected to reach it, using the same Tobler curve the ETA is
 * built on. Walk slower and the whole thing slides later.
 */

import {
  fallsAsSnow,
  fetchForecast,
  hourAt,
  interp,
  positionAt,
  store,
  weatherLabel,
  type PointForecast,
  type ProcessedTrack,
  type WeatherHour,
} from "@slownav/core";

/** A place on the route worth a forecast of its own. */
export interface RouteSample {
  /** "Start", "Highest point", "km 12", "End". */
  label: string;
  /** Distance along the route, metres. */
  prog: number;
  lat: number;
  lon: number;
  ele: number;
}

/** A sample, the hour it will be reached, and the weather then. */
export interface SampleWeather extends RouteSample {
  /** When the walker is expected here, ms since epoch. */
  arrival: number;
  hour: WeatherHour | null;
  /** True when precipitation at this height would be falling as snow. */
  snow: boolean;
  summary: string;
}

/** How far apart two samples must be to be worth asking about separately. */
const MIN_GAP_M = 1500;

/**
 * Points along the route to forecast.
 *
 * Always the start, the highest point and the end — the three a walker
 * actually asks about — then evenly spaced fills, dropping any that land on
 * top of one already taken. The top matters most and is never a round
 * number, which is why it is chosen by elevation rather than by distance.
 */
export function sampleRoute(track: ProcessedTrack, count = 5): RouteSample[] {
  const { pts, cum, ele, length } = track;
  if (!pts.length) return [];

  let topIdx = 0;
  for (let i = 1; i < ele.length; i++) if ((ele[i] ?? 0) > (ele[topIdx] ?? 0)) topIdx = i;

  const at = (index: number, label: string): RouteSample => ({
    label,
    prog: cum[index] ?? 0,
    lat: pts[index]![0],
    lon: pts[index]![1],
    ele: Math.round(ele[index] ?? pts[index]![2] ?? 0),
  });

  // The three named points are the skeleton and always survive: a top a
  // kilometre from the start is still the row a walker came to read. They
  // go in first so the evenly spaced fills can be placed around them —
  // done the other way round, a fill lands somewhere and a named point
  // then crowds it.
  const out: RouteSample[] = [];
  for (const s of [at(0, "Start"), at(topIdx, "Highest point"), at(pts.length - 1, "End")]) {
    // Literally the same point — a route that starts at its own high point
    // — is one row with both names rather than two identical ones.
    const same = out.find((o) => Math.abs(o.prog - s.prog) < 50);
    if (same) same.label = `${same.label} · ${s.label.toLowerCase()}`;
    else out.push(s);
  }

  const fills = Math.max(0, count - out.length);
  for (let f = 1; f <= fills; f++) {
    const target = (length * f) / (fills + 1);
    let idx = 0;
    while (idx < cum.length - 1 && (cum[idx + 1] ?? 0) < target) idx++;
    const s = at(idx, `km ${Math.round(target / 1000)}`);
    if (!out.some((o) => Math.abs(o.prog - s.prog) < MIN_GAP_M)) out.push(s);
  }

  return out.sort((a, b) => a.prog - b.prog);
}

/**
 * When the walker reaches each sample.
 *
 * Tobler seconds from where they are now, scaled by how they are actually
 * walking — the factor the ETA has already worked out, so the forecast and
 * the arrival time on the dashboard never disagree. Samples already behind
 * are reported at now: their weather is happening.
 */
export function arrivalsFor(
  track: ProcessedTrack,
  samples: readonly RouteSample[],
  from = 0,
  now = Date.now(),
  factor = 1,
): number[] {
  const here = positionAt(track.pts, track.cum, from);
  const doneSeconds = interp(track.tobCum, here.idx, here.t);
  return samples.map((s) => {
    const there = positionAt(track.pts, track.cum, s.prog);
    const seconds = interp(track.tobCum, there.idx, there.t) - doneSeconds;
    return seconds <= 0 ? now : now + seconds * 1000 * factor;
  });
}

/** One line a walker can read at a glance. */
export function summarise(hour: WeatherHour | null, snow: boolean): string {
  if (!hour) return "No forecast for that hour";
  const bits: string[] = [];
  if (hour.tempC != null) bits.push(`${Math.round(hour.tempC)}°C`);
  bits.push(snow ? "snow" : weatherLabel(hour.code).toLowerCase());
  if ((hour.precipChance ?? 0) >= 30) bits.push(`${Math.round(hour.precipChance!)}% rain`);
  if (hour.gustKph != null && hour.gustKph >= 40) {
    bits.push(`gusts ${Math.round(hour.gustKph)} km/h`);
  }
  return bits.join(" · ");
}

/** Line up samples, arrival times and the forecast into what the sheet shows. */
export function routeWeather(
  samples: readonly RouteSample[],
  forecasts: readonly PointForecast[],
  arrivals: readonly number[],
): SampleWeather[] {
  return samples.map((s, i) => {
    const arrival = arrivals[i] ?? Date.now();
    const hour = forecasts[i] ? hourAt(forecasts[i]!.hours, arrival) : null;
    const snow = hour ? fallsAsSnow(hour, s.ele) : false;
    return { ...s, arrival, hour, snow, summary: summarise(hour, snow) };
  });
}

/** A forecast kept on the phone, and when it was fetched. */
export interface CachedForecast {
  fetchedAt: number;
  samples: RouteSample[];
  forecasts: PointForecast[];
}

/** Past this, a forecast is old enough to be worth replacing if there is signal. */
export const STALE_AFTER_MS = 3 * 3600_000;

const key = (hikeId: string) => `hike:weather:${hikeId}`;

export function cachedForecast(hikeId: string): CachedForecast | null {
  const c = store.get<CachedForecast>(key(hikeId));
  if (!c || !Array.isArray(c.forecasts) || !Array.isArray(c.samples)) return null;
  return c;
}

export function isStale(c: CachedForecast | null, now = Date.now()): boolean {
  return !c || now - c.fetchedAt > STALE_AFTER_MS;
}

/**
 * Fetch and keep a forecast for this route.
 *
 * The save is checked: a forecast that did not persist is one that will not
 * be there on the mountain, which is the only place it is needed.
 */
export async function refreshForecast(
  hikeId: string,
  track: ProcessedTrack,
  opts: { signal?: AbortSignal; count?: number; now?: number } = {},
): Promise<{ cached: CachedForecast; saved: boolean }> {
  const samples = sampleRoute(track, opts.count ?? 5);
  const forecasts = await fetchForecast(
    samples.map((s) => ({ lat: s.lat, lon: s.lon, ele: s.ele })),
    opts.signal ? { signal: opts.signal } : {},
  );
  const cached: CachedForecast = { fetchedAt: opts.now ?? Date.now(), samples, forecasts };
  return { cached, saved: store.set(key(hikeId), cached) };
}
