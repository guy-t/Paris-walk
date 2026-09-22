/**
 * The weather side of a hike: the forecast along the route, and the
 * barometer in the walker's pocket.
 *
 * Kept apart from `useHike`, which is about where the walker is. These two
 * meet in one place only, and it is a useful place: the forecast carries the
 * sea-level pressure that turns a bare barometer reading into a height.
 */

import {
  addSample,
  altitudeFromPressure,
  correctForTemperature,
  interp,
  positionAt,
  pressureTrend,
  store,
  STANDARD_MSL,
  type ProcessedTrack,
  type PressureSample,
  type PressureTrend,
} from "@slownav/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { barometerAvailable, readPressure } from "../shared/barometer.js";
import {
  arrivalsFor,
  cachedForecast,
  isStale,
  refreshForecast,
  routeWeather,
  type CachedForecast,
  type SampleWeather,
} from "./weather.js";

export type WeatherStatus = "idle" | "loading" | "ok" | "offline" | "error";

/** How often to look at the barometer. Pressure moves over hours. */
const SAMPLE_EVERY_MS = 60_000;
const HISTORY_KEY = "hike:pressure";

export interface BarometerState {
  available: boolean;
  latest: PressureSample | null;
  trend: PressureTrend | null;
  /** Height from pressure, metres — null until there is a reading. */
  altitudeM: number | null;
  /** True when the forecast's temperature has been used to correct the column. */
  tempCorrected: boolean;
  /** True when the forecast supplied a sea-level pressure to work from. */
  calibrated: boolean;
}

export function useWeather(
  hikeId: string | null,
  track: ProcessedTrack | null,
  progress: number,
  factor = 1,
) {
  const [cached, setCached] = useState<CachedForecast | null>(null);
  const [status, setStatus] = useState<WeatherStatus>("idle");
  const [savedOffline, setSavedOffline] = useState(true);
  const [history, setHistory] = useState<PressureSample[]>(
    () => store.get<PressureSample[]>(HISTORY_KEY) ?? [],
  );
  const [latest, setLatest] = useState<PressureSample | null>(null);
  const loadingFor = useRef<string | null>(null);

  // ---- the forecast ----
  const refresh = useCallback(
    async (id: string, t: ProcessedTrack) => {
      if (!navigator.onLine) {
        setStatus((s) => (s === "ok" ? s : "offline"));
        return;
      }
      loadingFor.current = id;
      setStatus("loading");
      try {
        const { cached: got, saved } = await refreshForecast(id, t);
        if (loadingFor.current !== id) return; // a different hike was opened
        setCached(got);
        setSavedOffline(saved);
        setStatus("ok");
      } catch {
        if (loadingFor.current === id) setStatus("error");
      }
    },
    [],
  );

  useEffect(() => {
    if (!hikeId || !track) {
      setCached(null);
      setStatus("idle");
      return;
    }
    const have = cachedForecast(hikeId);
    setCached(have);
    setStatus(have ? "ok" : "idle");
    // An old forecast is still shown while a new one is fetched: on a
    // mountain, yesterday's forecast beats a spinner.
    if (isStale(have)) void refresh(hikeId, track);
  }, [hikeId, track, refresh]);

  // ---- the barometer ----
  const available = useMemo(() => barometerAvailable(), []);

  /**
   * How high the walker is, from the route's own profile.
   *
   * Held in a ref because the sampler runs on its own interval and must not
   * be torn down and restarted every time the walker moves a few metres.
   */
  const eleRef = useRef<number | null>(null);
  eleRef.current = useMemo(() => {
    if (!track) return null;
    const { idx, t } = positionAt(track.pts, track.cum, progress);
    return interp(track.ele, idx, t);
  }, [track, progress]);

  /**
   * And how warm the air is, for the same reason.
   *
   * Reducing to sea level through the standard column leaves a residual that
   * grows with height: on a cold day a 745 m climb still reads as 3.4 hPa of
   * "falling", which is the whole threshold. With the real temperature the
   * hill cancels exactly.
   */
  const tempRef = useRef<number | null>(null);

  useEffect(() => {
    if (!available) return;
    const take = () => {
      const raw = readPressure();
      if (!raw) return;
      // Stamp the reading with where the walker was when it was taken. Only
      // then can the trend tell a hill from a depression — and the route's
      // own surveyed profile is a far better height for this than the GPS's,
      // which is the phone's worst number.
      const reading = { ...raw, ele: eleRef.current, tempC: tempRef.current };
      setLatest(reading);
      setHistory((h) => {
        const next = addSample(h, reading);
        if (next !== h) store.set(HISTORY_KEY, next);
        return next;
      });
    };
    take();
    const id = setInterval(take, SAMPLE_EVERY_MS);
    return () => clearInterval(id);
  }, [available]);

  // ---- the two together ----
  const rows: SampleWeather[] = useMemo(() => {
    if (!cached || !track) return [];
    const arrivals = arrivalsFor(track, cached.samples, progress, Date.now(), factor);
    return routeWeather(cached.samples, cached.forecasts, arrivals);
  }, [cached, track, progress, factor]);

  const barometer: BarometerState = useMemo(() => {
    // The sea-level pressure where the walker is now, which is what makes a
    // reading a height rather than just a number.
    const msl = rows[0]?.hour?.pressureMslHPa ?? null;
    // And the air temperature there, which decides how much of the column
    // the formula has mis-sized. It is the largest error left once the
    // sea-level pressure is known: +53 m at 1900 m on a −5 °C morning.
    const tempC = rows[0]?.hour?.tempC ?? null;
    tempRef.current = tempC;
    const raw = latest ? altitudeFromPressure(latest.hPa, msl ?? STANDARD_MSL) : null;
    return {
      available,
      latest,
      trend: history.length ? pressureTrend(history) : null,
      altitudeM: raw != null && tempC != null ? correctForTemperature(raw, tempC) : raw,
      calibrated: msl != null,
      tempCorrected: raw != null && tempC != null,
    };
  }, [available, latest, history, rows]);

  return {
    rows,
    status,
    fetchedAt: cached?.fetchedAt ?? null,
    /** False when the forecast could not be kept for when the signal goes. */
    savedOffline,
    barometer,
    refresh: useCallback(() => {
      if (hikeId && track) void refresh(hikeId, track);
    }, [hikeId, track, refresh]),
  };
}
