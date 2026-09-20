/**
 * Number formatting, metric or imperial.
 *
 * A factory rather than loose functions because the unit choice is a user
 * setting: each app builds one formatter when settings load and passes it
 * down, so no component reads global state to know what "5 km" should say.
 */

export type Units = "metric" | "imperial";

export interface Formatter {
  /** A distance you are about to walk: rounded hard, because precision is false comfort. */
  dist(m: number): string;
  /** A longer distance, always in km/miles to one decimal. */
  km(m: number): string;
  /** An altitude or a climb. */
  alt(m: number): string;
  /** A speed from metres per second. */
  speed(mps: number | null | undefined): string;
  /** Minutes per km/mile. */
  pace(mps: number | null | undefined): string;
  /** A duration in seconds, as "45 min" or "2 h 05". */
  dur(s: number): string;
  /** A wall-clock time, in the viewer's locale. */
  clock(d: Date): string;
}

export function createFormatter(units: Units): Formatter {
  const imperial = units === "imperial";
  return {
    dist(m) {
      if (imperial) {
        const mi = m / 1609.344;
        return mi < 0.19
          ? `${Math.round((m * 3.28084) / 10) * 10} ft`
          : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
      }
      return m < 1000
        ? `${Math.round(m / 10) * 10} m`
        : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
    },
    km(m) {
      return imperial ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
    },
    alt(m) {
      return imperial ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;
    },
    speed(mps) {
      if (mps == null || !isFinite(mps)) return "—";
      return imperial ? `${(mps * 2.23694).toFixed(1)} mph` : `${(mps * 3.6).toFixed(1)} km/h`;
    },
    pace(mps) {
      if (!mps || mps < 0.05) return "—";
      const secPer = imperial ? 1609.344 / mps : 1000 / mps;
      return `${Math.floor(secPer / 60)}:${String(Math.round(secPer % 60)).padStart(2, "0")} /${imperial ? "mi" : "km"}`;
    },
    dur(s) {
      if (!isFinite(s) || s < 0) return "—";
      const m = Math.round(s / 60);
      return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
    },
    clock(d) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    },
  };
}

/**
 * Distance phrased for a walking instruction — "in 40 m", "in 250 m".
 *
 * Rounded to 5 m under 100 m and 10 m above, because a pedestrian cannot act
 * on more precision than that and exact numbers read as false confidence.
 */
export function walkingDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  const step = m < 100 ? 5 : 10;
  return `${Math.round(m / step) * step} m`;
}
