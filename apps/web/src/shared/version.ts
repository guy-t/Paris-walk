/**
 * Which build is this?
 *
 * The one question that cannot be answered from a phone on a hillside, and
 * the one that matters when a feature "is not there": an APK that failed to
 * update looks exactly like an APK that was never built with the change.
 *
 * The string is stamped in by Vite at build time from SLOWNAV_VERSION, which
 * CI sets from the run number, the channel and the commit — so the short SHA
 * shown in the app can be read straight off against the repository. A local
 * build says "dev", which is the truth.
 */

declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "dev";
