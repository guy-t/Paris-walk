/**
 * Keeping the screen awake while tracking — off by default, and deliberately
 * so.
 *
 * The screen is the most expensive thing on the phone, several times the cost
 * of the GPS it is there to display. Holding it on for a six-hour walk is a
 * choice the walker should make knowingly, which is why this lives behind a
 * menu toggle rather than turning itself on with the GPS.
 *
 * The lock is released by the browser whenever the page is hidden and must be
 * re-requested on return, so `enabled` is re-applied on every visibility
 * change rather than assumed to persist.
 */

import { useEffect, useRef } from "react";

export function useWakeLock(enabled: boolean): void {
  const lock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    const acquire = async () => {
      if (!enabled || lock.current || document.hidden) return;
      if (!("wakeLock" in navigator)) return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        lock.current = sentinel;
        sentinel.addEventListener("release", () => {
          lock.current = null;
        });
      } catch {
        // Denied, or the battery is too low for the browser to allow it.
        // Nothing to tell the user: the app works exactly the same.
      }
    };

    const release = () => {
      void lock.current?.release();
      lock.current = null;
    };

    if (enabled) void acquire();
    else release();

    // The browser drops the lock when the page is hidden; take it again.
    const onVisibility = () => {
      if (!document.hidden && enabled) void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled]);
}
