/**
 * The elevation profile strip under the dashboard.
 *
 * Canvas rather than SVG: a track can carry several thousand points and this
 * redraws on every GPS fix. It is also the app's scrub control — tapping it
 * in preview mode moves the walker along the route — so it has to stay
 * responsive at 60 px tall on a phone.
 */

import { interp, positionAt, type ProcessedTrack } from "@slownav/core";
import { useEffect, useRef } from "react";

export interface ElevationProfileProps {
  track: ProcessedTrack;
  /** Metres along the track. */
  progress: number;
  /** Waypoints to tick along the bottom, as distances along the track. */
  waypoints?: readonly number[];
  /** Called with a distance along the track when the user taps. */
  onScrub?: (metres: number) => void;
  /** Label the horizontal ticks in miles rather than kilometres. */
  imperial?: boolean;
  /** Formats the two elevation labels. */
  formatAltitude: (m: number) => string;
  className?: string;
}

const PAD_BOTTOM = 14;
const PAD_TOP = 6;

export function ElevationProfile({
  track,
  progress,
  waypoints,
  onScrub,
  imperial = false,
  formatAltitude,
  className,
}: ElevationProfileProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (!W || !H) return;
      cv.width = W * dpr;
      cv.height = H * dpr;
      const c = cv.getContext("2d");
      if (!c) return;
      c.scale(dpr, dpr);

      c.fillStyle = "#f4f5f2";
      c.fillRect(0, 0, W, H);

      // A little headroom above and below so the line never touches the edge.
      const eMin = track.minEle - 20;
      const eMax = track.maxEle + 20;
      const X = (m: number) => (m / track.length) * W;
      const Y = (e: number) => PAD_TOP + (1 - (e - eMin) / (eMax - eMin)) * (H - PAD_TOP - PAD_BOTTOM);

      const n = track.pts.length;
      // At most one point per horizontal pixel — more is invisible and slow.
      const step = Math.max(1, Math.floor(n / W));

      const outline = () => {
        c.beginPath();
        c.moveTo(0, H - PAD_BOTTOM);
        for (let i = 0; i < n; i += step) c.lineTo(X(track.cum[i]), Y(track.ele[i]));
        c.lineTo(X(track.cum[n - 1]), Y(track.ele[n - 1]));
        c.lineTo(W, H - PAD_BOTTOM);
        c.closePath();
      };

      outline();
      c.fillStyle = "#cfd9d2";
      c.fill();

      // The walked part, in a darker green, clipped to the progress line.
      const xp = X(progress);
      c.save();
      c.beginPath();
      c.rect(0, 0, xp, H);
      c.clip();
      outline();
      c.fillStyle = "#8aa396";
      c.fill();
      c.restore();

      c.strokeStyle = "#2f4f3e";
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < n; i += step) {
        const x = X(track.cum[i]);
        const y = Y(track.ele[i]);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();

      c.fillStyle = "#1f2937";
      for (const w of waypoints ?? []) c.fillRect(X(w) - 0.5, H - PAD_BOTTOM - 4, 1, 4);

      // Distance ticks, spaced so they never crowd.
      c.fillStyle = "#67736c";
      c.font = "9px system-ui, sans-serif";
      c.textAlign = "center";
      const unit = imperial ? 1609.344 : 1000;
      const kmStep = track.length > 25000 ? 5 * unit : track.length > 12000 ? 2 * unit : unit;
      for (let k = kmStep; k < track.length; k += kmStep) {
        c.fillRect(X(k), H - PAD_BOTTOM, 1, 3);
        c.fillText((k / unit).toFixed(0), X(k), H - 2);
      }
      c.textAlign = "left";
      c.fillText(formatAltitude(track.maxEle), 3, PAD_TOP + 8);
      c.textAlign = "right";
      c.fillText(formatAltitude(track.minEle), W - 3, H - PAD_BOTTOM - 2);

      // Where we are.
      const { idx, t } = positionAt(track.pts, track.cum, progress);
      const y = Y(interp(track.ele, idx, t));
      c.strokeStyle = "#c2410c";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(xp, PAD_TOP);
      c.lineTo(xp, H - PAD_BOTTOM);
      c.stroke();
      c.fillStyle = "#c2410c";
      c.beginPath();
      c.arc(xp, y, 4, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#fff";
      c.lineWidth = 1.5;
      c.stroke();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [track, progress, waypoints, imperial, formatAltitude]);

  return (
    <canvas
      ref={ref}
      className={className ?? "profile-canvas"}
      onClick={(e) => {
        if (!onScrub) return;
        const r = e.currentTarget.getBoundingClientRect();
        onScrub((track.length * (e.clientX - r.left)) / r.width);
      }}
    />
  );
}
