/**
 * The numbers along the top of every dashboard.
 *
 * A tile is a label and a value and nothing else. The apps decide what goes
 * in them; keeping the component this dumb is what lets the hiking app show
 * "Climb left" where the boat shows "Next lock" without either knowing about
 * the other.
 */

import type { ReactNode } from "react";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Smaller text after the value, e.g. the duration beside an arrival time. */
  detail?: ReactNode;
  /** Draws attention — an ETA after dark, a lock that closes before we reach it. */
  alert?: boolean;
  onClick?: () => void;
}

export function StatTile({ label, value, detail, alert, onClick }: StatTileProps) {
  const body = (
    <>
      <div className="k">{label}</div>
      <div className="v">
        {value}
        {detail != null && <small>{detail}</small>}
      </div>
    </>
  );
  return onClick ? (
    <button className={`tile ${alert ? "alert" : ""}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`tile ${alert ? "alert" : ""}`}>{body}</div>
  );
}

export interface StatStripProps {
  /**
   * Label/value pairs, shown in a horizontally scrolling strip.
   *
   * The optional third string is a line under the value, for a number that
   * cannot be read without knowing where it came from — an altitude, say,
   * which is one thing from the GPS and another from a barometer.
   */
  stats: readonly (readonly [label: string, value: string, detail?: string])[];
}

/**
 * The swipeable strip of secondary numbers.
 *
 * Horizontal scroll rather than a grid: there are a dozen of these and a
 * phone has room for three, but which three matter changes — pace on a climb,
 * sunset late in the day. Scrolling lets the walker choose without a setting.
 */
export function StatStrip({ stats }: StatStripProps) {
  return (
    <div className="strip">
      {stats.map(([k, v, detail]) => (
        <div className="tile" key={k}>
          <div className="k">{k}</div>
          <div className="v">
            {v}
            {detail ? <small>{detail}</small> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
