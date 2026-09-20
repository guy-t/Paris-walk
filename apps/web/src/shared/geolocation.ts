/**
 * Where position fixes come from on each platform.
 *
 * In a browser this is just the Geolocation API. In the native shell it is
 * Capacitor's Geolocation plugin instead, for two reasons worth stating:
 *
 *  - It asks for the OS permission properly, with the strings declared in the
 *    manifest and Info.plist. The WebView's own geolocation prompt depends on
 *    the host app having already been granted location, which produces a
 *    silent denial rather than a prompt if it has not.
 *  - It is the seam a foreground service plugs into later. Swapping the
 *    watcher is the whole change needed for background recording; no app code
 *    or GPS logic moves.
 */

import type { Fix } from "@slownav/core";
import { browserWatcher, type PositionWatcher } from "@slownav/ui";
import { isNative } from "./platform.js";

/** Capacitor's plugin, loaded only when there is a native shell to talk to. */
const capacitorWatcher: PositionWatcher = {
  available: () => true,
  async watch(onFix, onError, opts) {
    const { Geolocation } = await import("@capacitor/geolocation");

    // Ask first, and say so plainly if refused: a watch started without
    // permission fails with an error that reads like a hardware fault.
    try {
      const status = await Geolocation.checkPermissions();
      if (status.location !== "granted") {
        const asked = await Geolocation.requestPermissions({ permissions: ["location"] });
        if (asked.location !== "granted") {
          onError({ message: "Location permission was not granted.", permissionDenied: true });
          return null;
        }
      }
    } catch {
      // Older shells without the permissions API: fall through and let the
      // watch itself surface any problem.
    }

    return Geolocation.watchPosition(
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        maximumAge: opts.maximumAge,
        timeout: opts.timeout,
      },
      (position, err) => {
        if (err || !position) {
          const message = err?.message ?? "No position available.";
          onError({
            message,
            permissionDenied: /denied|permission/i.test(message),
          });
          return;
        }
        const fix: Fix = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy || 50,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          heading: position.coords.heading,
          timestamp: position.timestamp || Date.now(),
        };
        onFix(fix);
      },
    );
  },
  clear(handle) {
    if (typeof handle !== "string") return;
    void import("@capacitor/geolocation")
      .then(({ Geolocation }) => Geolocation.clearWatch({ id: handle }))
      .catch(() => {
        // Already gone, or the shell is shutting down. Nothing to do.
      });
  },
};

/** The right watcher for wherever this is running. */
export function positionWatcher(): PositionWatcher {
  return isNative() ? capacitorWatcher : browserWatcher;
}
