import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native shell.
 *
 * It wraps exactly the same web build the browser gets — no forked UI, no
 * second implementation of the GPS logic. What the shell adds is the things
 * a browser cannot reach: sensors, and (later) location that keeps running
 * with the screen off.
 *
 * Both platforms are declared. Android is what gets built in CI; iOS is kept
 * configured and buildable so the project never quietly acquires an
 * Android-only assumption, even though shipping an iOS build needs a Mac and
 * an Apple developer account.
 */
const config: CapacitorConfig = {
  appId: "io.github.guyt.slownavigator",
  appName: "Slow Navigator",
  webDir: "www",

  // Everything is bundled; the shell must never need the network to start.
  server: {
    androidScheme: "https",
    iosScheme: "https",
  },

  plugins: {
    Geolocation: {
      // The permission strings the OS shows. Said plainly, because a vague
      // location prompt is a prompt people decline.
      permissions: ["location"],
    },
  },

  android: {
    // Mixed content stays off: everything the app loads is either local or
    // https, and allowing otherwise would be a downgrade for no benefit.
    allowMixedContent: false,
    captureInput: true,
  },

  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
