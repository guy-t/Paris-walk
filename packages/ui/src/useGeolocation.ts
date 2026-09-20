/**
 * GPS, but only while the app is on screen.
 *
 * This is the single biggest thing these apps do for battery life. A
 * continuous high-accuracy watch costs roughly 150–300 mW, and a walk is
 * measured in hours; the phone spends most of that in a pocket with the
 * screen off, where a fix is worth nothing because nobody is looking. So the
 * watch is cleared on `visibilitychange` and restarted when the app comes
 * back.
 *
 * The cost is gaps in the recorded trail while the screen is off — the web
 * has no background location, and on Android only a native foreground service
 * can change that. What survives the gap is the *route* position: the first
 * fix after resuming is matched against the planned line, so distance done,
 * distance to go, climb left and ETA are all correct again immediately. Only
 * the breadcrumb has holes.
 *
 * The fix history is cleared on resume, because the walker may be a long way
 * from where they were and a heading derived across the gap would be a lie.
 */

import type { Fix } from "@slownav/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type GeolocationStatus =
  | "off"
  | "starting"
  | "live"
  /** Tracking, but the page is hidden, so the watch is stopped to save power. */
  | "paused"
  | "denied"
  | "unavailable";

export interface UseGeolocationOptions {
  /** Called for every fix while tracking. */
  onFix: (fix: Fix) => void;
  /** Called when a fix cannot be had; the message is worth showing. */
  onError?: (message: string, permanent: boolean) => void;
  /** Called when tracking resumes after the app was hidden. */
  onResume?: () => void;
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
}

export interface UseGeolocationResult {
  status: GeolocationStatus;
  tracking: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /** False when the page is hidden — the dashboard says "Paused (screen off)". */
  visible: boolean;
}

export function useGeolocation({
  onFix,
  onError,
  onResume,
  enableHighAccuracy = true,
  maximumAge = 2000,
  timeout = 30000,
}: UseGeolocationOptions): UseGeolocationResult {
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState<GeolocationStatus>("off");
  const [visible, setVisible] = useState(() => !document.hidden);
  const watchId = useRef<number | null>(null);

  // Held in refs so starting and stopping the watch never depends on a
  // callback identity, which would restart the GPS on every render.
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  const startWatch = useCallback(() => {
    if (watchId.current != null || !navigator.geolocation) return;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setStatus("live");
        onFixRef.current({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy || 50,
          altitude: p.coords.altitude,
          speed: p.coords.speed,
          heading: p.coords.heading,
          timestamp: p.timestamp || Date.now(),
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
          onErrorRef.current?.(
            "Location permission was denied. Allow location for this site (the padlock icon in the address bar), then try again.",
            true,
          );
        } else {
          onErrorRef.current?.(`No GPS fix yet: ${err.message}`, false);
        }
      },
      { enableHighAccuracy, maximumAge, timeout },
    );
  }, [enableHighAccuracy, maximumAge, timeout]);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  }, []);

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus("unavailable");
      onErrorRef.current?.("Geolocation isn't available in this browser.", true);
      return;
    }
    if (!window.isSecureContext) {
      setStatus("unavailable");
      onErrorRef.current?.(
        "Location needs an https address. Open this from your GitHub Pages link rather than a local file.",
        true,
      );
      return;
    }
    setTracking(true);
    setStatus("starting");
    startWatch();
  }, [startWatch]);

  const stop = useCallback(() => {
    setTracking(false);
    setStatus("off");
    stopWatch();
  }, [stopWatch]);

  const toggle = useCallback(() => {
    if (tracking) stop();
    else start();
  }, [tracking, start, stop]);

  useEffect(() => {
    const onVisibility = () => {
      const nowVisible = !document.hidden;
      setVisible(nowVisible);
      if (!tracking) return;
      if (nowVisible) {
        onResumeRef.current?.();
        setStatus("starting");
        startWatch();
      } else {
        setStatus("paused");
        stopWatch();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [tracking, startWatch, stopWatch]);

  // Never leave a watch running behind an unmounted component.
  useEffect(() => stopWatch, [stopWatch]);

  return { status, tracking, start, stop, toggle, visible };
}
