/**
 * The launcher.
 *
 * On the web this is just a page of links and this script does nothing. In
 * the native shell it matters: only the ported apps ship inside the APK, and
 * the two that have not been ported yet still live as the original single-file
 * HTML on GitHub Pages. Following those links inside the WebView would strand
 * the user on a page with no way back — a Capacitor WebView has no address
 * bar and no back button of its own — so they are opened in an in-app browser
 * that has a close button instead.
 */

import { isNative, openExternal, WEB_BASE } from "../shared/platform.js";
import { APP_VERSION } from "../shared/version.js";

/** Apps still served as the original HTML, which the native build links out to. */
const WEB_ONLY = new Set(["canalmap.html", "pariswalk.html"]);

function init(): void {
  // Which build this is, on the first screen the shell opens. An APK that
  // silently failed to update is indistinguishable from one built without
  // the change, unless it can be asked.
  const build = document.getElementById("build");
  if (build) build.textContent = `Build ${APP_VERSION}`;

  if (!isNative()) return;

  for (const link of document.querySelectorAll<HTMLAnchorElement>("a.app[data-web]")) {
    const href = link.getAttribute("href") ?? "";
    if (!WEB_ONLY.has(href)) continue;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      void openExternal(`${WEB_BASE}${href}`);
    });
  }
}

init();
