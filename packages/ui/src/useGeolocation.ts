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
  /**
   * True when fixes keep arriving with the app hidden.
   *
   * A watcher that does not — every browser one — is stopped when the page
   * hides, because the screen is off and a fix nobody is looking at costs
   * battery for nothing. One that does is left alone, and is not told to
   * forget its history on resume either: there was no gap to forget across.
   */
  keepsRunningInBackground?: boolean;
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

  /**
   * The live watch, and the watcher that owns it.
   *
   * Both, because a handle only means something to the provider that made
   * it. Clearing with whatever watcher happens to be current is how turning
   * background recording off mid-walk left the foreground service running:
   * the handle was an object the Android watcher understood, handed to the
   * Capacitor one, which takes a string id and quietly ignored it. A
   * notification and the GNSS chip stayed up for the rest of the day.
   */
  const handle = useRef<{ watcher: PositionWatcher; pending: Promise<unknown> } | null>(null);

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
    const live = handle.current;
    handle.current = null;
    // The handle may still be in flight; clear it once it exists, so a stop
    // issued immediately after a start cannot leave a watch running.
    void live?.pending.then((h) => live.watcher.clear(h)).catch(() => {});
  }, []);

  const startWatch = useCallback(() => {
    if (handle.current) return;
    const watcher = watcherRef.current;
    const pending = watcher.watch(
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
    handle.current = { watcher, pending };
    void pending.catch((e: unknown) => {
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
      // A watcher that carries on in the background is left running, and
      // the tracker is not reset: the fixes from the hidden stretch are
      // about to arrive, and a heading derived across them is real.
      if (watcherRef.current.keepsRunningInBackground) return;
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

  // Swap providers without stopping the walk.
  //
  // The background setting changes which watcher this is, and a walker who
  // turns it on at a col expects it to take effect there rather than at the
  // next hotel. Compared by identity: `positionWatcher` returns the same
  // object for the same setting, so this fires only on a real change.
  const previous = useRef(watcher);
  useEffect(() => {
    if (previous.current === watcher) return;
    previous.current = watcher;
    if (!tracking) return;
    stopWatch();
    setStatus("starting");
    startWatch();
  }, [watcher, tracking, startWatch, stopWatch]);

  // Never leave a watch running behind an unmounted component.
  useEffect(() => stopWatch, [stopWatch]);

  return { status, tracking, start, stop, toggle, visible };
}
