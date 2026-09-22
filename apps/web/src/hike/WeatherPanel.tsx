/**
 * The weather tab: what the sky will be doing, where and when you get there.
 *
 * Read in order, it is the walk: each row is a place on the route, at its
 * own height, at the hour the walker is expected to reach it. The barometer
 * sits above it because it is the only part that knows something the
 * forecast does not — what the air is doing here, now.
 */

import type { Formatter } from "@slownav/core";
import type { BarometerState, WeatherStatus } from "./useWeather.js";
import type { SampleWeather } from "./weather.js";

export interface WeatherPanelProps {
  rows: SampleWeather[];
  status: WeatherStatus;
  fetchedAt: number | null;
  savedOffline: boolean;
  barometer: BarometerState;
  fmt: Formatter;
  onRefresh: () => void;
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function age(fetchedAt: number): string {
  const hours = (Date.now() - fetchedAt) / 3600_000;
  if (hours < 1) return "updated less than an hour ago";
  if (hours < 2) return "updated an hour ago";
  if (hours < 24) return `updated ${Math.round(hours)} hours ago`;
  return `updated ${Math.round(hours / 24)} days ago`;
}

export function WeatherPanel({
  rows,
  status,
  fetchedAt,
  savedOffline,
  barometer,
  fmt,
  onRefresh,
}: WeatherPanelProps) {
  return (
    <div className="weather">
      {barometer.available && (
        <div className="wx-baro">
          <div className="wx-baro-head">
            <strong>
              {barometer.latest ? `${barometer.latest.hPa.toFixed(1)} hPa` : "Barometer"}
            </strong>
            {barometer.altitudeM != null && (
              <span className="wx-alt">
                {fmt.alt(Math.round(barometer.altitudeM))}
                {/* Said plainly: without a sea-level reference this number
                    can be a couple of hundred metres out, and a walker
                    deserves to know which one they are looking at. */}
                <small>
                  {barometer.calibrated
                    ? barometer.tempCorrected
                      ? " ±15 m · forecast pressure and temperature"
                      : " ±25 m · from forecast pressure"
                    : " uncalibrated — could be 200 m out"}
                </small>
              </span>
            )}
          </div>
          {/* Said once, where the number is: this instrument is excellent at
              change and only fair at absolute height, and a walker reading
              1,904 m off a screen deserves to know which of those they have. */}
          <div className="wx-baro-note">
            Steady to about a metre on the climb; the absolute height depends on the
            forecast being right about the air.
          </div>
          <div className="wx-trend">
            {barometer.trend
              ? barometer.trend.direction === "unknown"
                ? barometer.trend.note
                : `${barometer.trend.deltaHPa > 0 ? "+" : ""}${barometer.trend.deltaHPa.toFixed(1)} hPa in ${barometer.trend.overHours.toFixed(1)} h — ${barometer.trend.note}`
              : "Waiting for a reading…"}
          </div>
        </div>
      )}

      {!rows.length ? (
        <div className="sheet-empty">
          {status === "loading"
            ? "Getting the forecast…"
            : status === "offline"
              ? "No forecast yet, and no connection. Prepare the hike for offline while you have signal."
              : status === "error"
                ? "Couldn't get the forecast. It will try again when you open this."
                : "No forecast for this route yet."}
        </div>
      ) : (
        <>
          {rows.map((r) => (
            <div className="wx-row" key={`${r.label}-${r.prog}`}>
              <div className="wx-when">
                <strong>{clock(r.arrival)}</strong>
                <small>{fmt.alt(r.ele)}</small>
              </div>
              <div className="wx-what">
                <div className="wx-where">
                  {r.label}
                  {r.prog > 0 && <small> · {fmt.dist(r.prog)} in</small>}
                </div>
                <div className={`wx-summary${r.snow ? " snow" : ""}`}>{r.summary}</div>
                {r.hour?.freezingLevelM != null && (
                  <div className="wx-extra">
                    Freezing level {fmt.alt(Math.round(r.hour.freezingLevelM))}
                    {r.hour.windKph != null ? ` · wind ${Math.round(r.hour.windKph)} km/h` : ""}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="wx-foot">
            <span>
              {fetchedAt ? age(fetchedAt) : ""}
              {savedOffline ? "" : " · not saved for offline"}
            </span>
            <button onClick={onRefresh} disabled={status === "loading"}>
              {status === "loading" ? "Updating…" : "Update"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
