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
 * The cost is gaps in the recorded trail while the screen is off. What
 * survives the gap is the *route* position: the first fix after resuming is
 * matched against the planned line, so distance done, distance to go, climb
 * left and ETA are all correct again immediately. Only the breadcrumb has
 * holes. A native build with a foreground service can close that gap, and
 * does so by supplying a different `watcher` — nothing else changes.
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

export interface WatchError {
  message: string;
  /** The user said no. Nothing will work until they change their mind. */
  permissionDenied: boolean;
}

export interface WatchOptions {
  enableHighAccuracy: boolean;
  maximumAge: number;
  timeout: number;
}

/**
 * Where fixes come from.
 *
 * Abstracted so the native shell can supply the platform's own provider —
 * which can be given a foreground service, and on iOS behaves better than the
 * WebView's implementation — without the hook or the apps knowing.
 */
export interface PositionWatcher {
  /** True if this provider can work here at all. */
  available(): boolean;
  /** Start watching. The returned handle is passed back to `clear`. */
  watch(
    onFix: (fix: Fix) => void,
    onError: (err: WatchError) => void,
    opts: WatchOptions,
  ): Promise<unknown>;
  clear(handle: unknown): void;
}

/** The browser's own Geolocation API. */
export const browserWatcher: PositionWatcher = {
  available: () => typeof navigator !== "undefined" && !!navigator.geolocation,
  watch(onFix, onError, opts) {
    const id = navigator.geolocation.watchPosition(
      (p) =>
        onFix({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy || 50,
          altitude: p.coords.altitude,
          speed: p.coords.speed,
          heading: p.coords.heading,
          timestamp: p.timestamp || Date.now(),
        }),
      (err) =>
        onError({
          message: err.message,
          permissionDenied: err.code === err.PERMISSION_DENIED,
        }),
      opts,
    );
    return Promise.resolve(id);
  },
  clear(handle) {
    if (typeof handle === "number") navigator.geolocation.clearWatch(handle);
  },
};

export interface UseGeolocationOptions {
  /** Called for every fix while tracking. */
  onFix: (fix: Fix) => void;
  /** Called when a fix cannot be had; the message is worth showing. */
  onError?: (message: string, permanent: boolean) => void;
  /** Called when tracking resumes after the app was hidden. */
  onResume?: () => void;
  /** Defaults to the browser's Geolocation API. */
  watcher?: PositionWatcher;
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
  watcher = browserWatcher,
  enableHighAccuracy = true,
  maximumAge = 2000,
  timeout = 30000,
}: UseGeolocationOptions): UseGeolocationResult {
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState<GeolocationStatus>("off");
  const [visible, setVisible] = useState(() => !document.hidden);

  /** The live watch handle, or a promise for one that has not resolved yet. */
  const handle = useRef<Promise<unknown> | null>(null);

  // Held in refs so starting and stopping the watch never depends on a
  // callback identity, which would restart the GPS on every render.
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;
  const watcherRef = useRef(watcher);
  watcherRef.current = watcher;

  const stopWatch = useCallback(() => {
    const pending = handle.current;
    handle.current = null;
    // The handle may still be in flight; clear it once it exists, so a stop
    // issued immediately after a start cannot leave a watch running.
    void pending?.then((h) => watcherRef.current.clear(h)).catch(() => {});
  }, []);

  const startWatch = useCallback(() => {
    if (handle.current) return;
    handle.current = watcherRef.current.watch(
      (fix) => {
        setStatus("live");
        onFixRef.current(fix);
      },
      (err) => {
        if (err.permissionDenied) {
          setStatus("denied");
          onErrorRef.current?.(
            "Location permission was denied. Allow location for this app, then try again.",
            true,
          );
        } else {
          onErrorRef.current?.(`No GPS fix yet: ${err.message}`, false);
        }
      },
      { enableHighAccuracy, maximumAge, timeout },
    );
    void handle.current.catch((e: unknown) => {
      handle.current = null;
      setStatus("denied");
      onErrorRef.current?.(
        e instanceof Error ? e.message : "Location is not available.",
        true,
      );
    });
  }, [enableHighAccuracy, maximumAge, timeout]);

  const start = useCallback(() => {
    if (!watcherRef.current.available()) {
      setStatus("unavailable");
      onErrorRef.current?.("Location isn't available on this device.", true);
      return;
    }
    // A browser will not hand out location over plain http. The native shell
    // serves itself over https, so this check passes there too.
    if (watcherRef.current === browserWatcher && !window.isSecureContext) {
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
