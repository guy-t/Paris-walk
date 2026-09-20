/**
 * What kind of thing are we running inside?
 *
 * The same build serves three places: a browser tab, an installed PWA, and a
 * Capacitor WebView inside the Android app. Almost nothing needs to care —
 * that is the point of building it this way — but a few things genuinely do,
 * and they are all here rather than scattered through the apps.
 *
 * Everything degrades: each capability is feature-detected at runtime and has
 * a web fallback, so nothing forks and the browser build never breaks because
 * a native plugin is missing.
 */

/** Where the original single-file apps are served from. */
export const WEB_BASE = "https://guy-t.github.io/Paris-walk/";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True inside the Android or iOS shell; false in any browser. */
export function isNative(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

/** "android", "ios", or "web". */
export function platform(): "android" | "ios" | "web" {
  const p = capacitor()?.getPlatform?.();
  return p === "android" || p === "ios" ? p : "web";
}

/**
 * The `accept` for a GPX file picker — or nothing, where filtering breaks it.
 *
 * On Android the WebView turns `accept` into a MIME list for the Storage
 * Access Framework, and there is no MIME type everyone agrees a .gpx has.
 * A document provider may report one as `application/octet-stream`,
 * `application/xml`, `application/gpx+xml` or nothing at all, and the picker
 * greys out every file that does not match — so a GPX sitting in a subfolder
 * of Documents simply cannot be tapped, while the same file reached through
 * Recents sometimes can. iOS maps `accept` to UTIs and fails the same way for
 * an extension it does not know.
 *
 * So on a phone the picker is left unfiltered, and what was picked is checked
 * after the fact by parsing it. That is where the real check belongs anyway:
 * a file arriving from a content:// URI need not have a meaningful name, and
 * a name has never been evidence of contents.
 */
export function gpxAccept(ua: string = navigator.userAgent): string | undefined {
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return undefined;
  return ".gpx,application/gpx+xml,application/xml,text/xml";
}

/**
 * Open a URL outside the app.
 *
 * In the native shell this uses an in-app browser with a close button, so the
 * user is never stranded on a page with no way back. On the web it is an
 * ordinary new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    } catch {
      // Plugin missing or failed: fall through to the web behaviour rather
      // than leaving the tap doing nothing at all.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Whether to register the service worker.
 *
 * Pointless in the native shell — every asset is already on the device, and a
 * second cache layer over local files only adds a way for them to disagree.
 */
export function wantsServiceWorker(): boolean {
  return !isNative();
}
