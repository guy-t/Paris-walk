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

/** The Android shell's foreground service, when there is one to talk to. */
interface TrackingBridge {
  available?: () => boolean;
  running?: () => boolean;
  start?: () => boolean;
  stop?: () => void;
  drain?: () => string | null;
}

function trackingBridge(): TrackingBridge | undefined {
  return (globalThis as { SlowNavTracking?: TrackingBridge }).SlowNavTracking;
}

/** True only in a shell that can record with the screen off. */
export function backgroundTrackingAvailable(): boolean {
  try {
    return trackingBridge()?.available?.() === true;
  } catch {
    return false;
  }
}

/** How often the queue is emptied while the app is on screen. */
const DRAIN_EVERY_MS = 2000;

/**
 * Turn what the service handed back into fixes.
 *
 * Exported because this is the seam where a string crossing the Java/JS
 * bridge becomes something the tracker will act on, and a malformed entry
 * there would put the walker somewhere they are not.
 */
export function parseFixes(raw: string | null | undefined): Fix[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Fix[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const f = item as Record<string, unknown>;
    // Typed, not coerced. `Number(null)` is 0, so a fix that arrived without
    // a latitude would land in the Gulf of Guinea and a missing altitude
    // would read as sea level — both of which a walker would be shown as
    // fact. The bridge writes JSON numbers or nothing.
    const num = (k: string): number | null => {
      const v = f[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const lat = num("lat");
    const lon = num("lon");
    if (lat == null || lon == null) continue;
    out.push({
      lat,
      lon,
      accuracy: num("accuracy") ?? 50,
      altitude: num("altitude"),
      speed: num("speed"),
      heading: num("heading"),
      timestamp: num("timestamp") ?? Date.now(),
    });
  }
  // Oldest first, whatever order the queue came back in: the tracker folds
  // them in sequence and a fix out of order would be read as a jump.
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fixes from the Android foreground service, which survive the screen.
 *
 * Drained rather than pushed. While the app is hidden its JavaScript is not
 * running to be called, so the service queues what it collects and this
 * empties the queue — on a timer while visible, and immediately on becoming
 * visible again, which is the moment the backlog matters.
 */
const backgroundWatcher: PositionWatcher = {
  available: () => backgroundTrackingAvailable(),
  keepsRunningInBackground: true,
  async watch(onFix, onError) {
    const bridge = trackingBridge();
    if (!bridge?.start) {
      onError({ message: "Background recording isn't available here.", permissionDenied: false });
      return null;
    }

    // The permission is still the ordinary one, and still has to be granted
    // before the service can do anything with it.
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const status = await Geolocation.checkPermissions();
      if (status.location !== "granted") {
        const asked = await Geolocation.requestPermissions({ permissions: ["location"] });
        if (asked.location !== "granted") {
          onError({ message: "Location permission was not granted.", permissionDenied: true });
          return null;
        }
      }
    } catch {
      // An older shell without the permissions API: let the service say.
    }

    if (bridge.start() !== true) {
      onError({
        message: "Android would not start background recording. Open the app and try again.",
        permissionDenied: false,
      });
      return null;
    }

    const pump = () => {
      try {
        for (const fix of parseFixes(bridge.drain?.())) onFix(fix);
      } catch {
        // A drain that fails is a fix delayed, not a walk lost: the queue
        // keeps it and the next pump collects it.
      }
    };
    const timer = window.setInterval(pump, DRAIN_EVERY_MS);
    const onVisible = () => {
      if (!document.hidden) pump();
    };
    document.addEventListener("visibilitychange", onVisible);
    pump();
    return { timer, onVisible, bridge };
  },
  clear(handle) {
    const h = handle as { timer?: number; onVisible?: () => void; bridge?: TrackingBridge } | null;
    if (!h) return;
    if (h.timer != null) window.clearInterval(h.timer);
    if (h.onVisible) document.removeEventListener("visibilitychange", h.onVisible);
    try {
      h.bridge?.stop?.();
    } catch {
      // Shutting down anyway.
    }
  },
};

/**
 * The right watcher for wherever this is running.
 *
 * Returns the same object for the same answer, so the hook can compare
 * identities and restart the watch only when the choice genuinely changes.
 */
export function positionWatcher(background = false): PositionWatcher {
  if (!isNative()) return browserWatcher;
  return background && backgroundTrackingAvailable() ? backgroundWatcher : capacitorWatcher;
}
