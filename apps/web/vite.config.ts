import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * One Vite app, several HTML entries — the launcher, then hike.html and
 * eventually canalmap.html and pariswalk.html — rather than separate builds.
 *
 * That keeps every original URL working exactly as it did, while the shared
 * core, Leaflet and React end up in chunks all the entries reference. A
 * walker who has opened one app has already downloaded most of the next.
 *
 * Two targets, one source:
 *
 *   default      the GitHub Pages site, served from /Paris-walk/next/
 *   --mode native  the Capacitor shell, where the app is loaded from the
 *                  device and so needs relative URLs, no service worker and
 *                  no sourcemaps
 *
 * The mode is used rather than an environment variable because npm scripts
 * run through cmd.exe on Windows, where `FOO=1 vite build` is a syntax error.
 */
export default defineConfig(({ mode }) => {
  const native = mode === "native";

  // Stamped into the app so a walker can read back exactly which build is on
  // the phone. CI sets it; a local build honestly says "dev".
  const version = process.env.SLOWNAV_VERSION?.trim() || "dev";

  return {
    define: { __APP_VERSION__: JSON.stringify(version) },

    // Relative in the shell so assets resolve from the device. Shipping the
    // Pages base inside the APK would point every asset at a URL the phone
    // may have no signal to reach.
    base: native ? "./" : (process.env.SLOWNAV_BASE ?? "/Paris-walk/next/"),

    plugins: [
      react(),

      // The shell has every asset on the device already, so it neither
      // registers a worker nor needs one shipped inside the APK.
      ...(native
        ? []
        : [
            VitePWA({
              filename: "sw.js",
              registerType: "prompt", // the app shows "a new version is ready"
              injectRegister: null, // registered by useServiceWorker, not the plugin
              // Serve a real worker in dev too, so the offline behaviour and
              // the update prompt can be exercised without a production build.
              devOptions: { enabled: true, type: "module" },
              workbox: {
                globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
                // Map tiles are cached by the app's own corridor download,
                // which is bounded to one route. Nothing here should try to
                // cache the whole map.
                runtimeCaching: [
                  {
                    urlPattern: /^https:\/\/[abc]?\.?tile\.opentopomap\.org\/.*/i,
                    handler: "CacheFirst",
                    options: {
                      // Shared with precacheTiles in @slownav/core, so a
                      // downloaded hike survives an app update.
                      cacheName: "slownav-tiles",
                      expiration: {
                        maxEntries: 20000,
                        maxAgeSeconds: 60 * 60 * 24 * 180,
                      },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                ],
              },
              manifest: {
                name: "Slow Navigator",
                short_name: "Slow Nav",
                description:
                  "Walking, hiking and boating companions that keep working offline.",
                start_url: "./index.html",
                scope: "./",
                display: "standalone",
                background_color: "#f4f5f2",
                theme_color: "#2f4f3e",
                orientation: "portrait",
              },
            }),
          ]),
    ],

    build: {
      outDir: native ? "dist-native" : "dist",
      rollupOptions: {
        input: {
          // The launcher, which is also what the native shell opens into.
          index: resolve(import.meta.dirname, "index.html"),
          hike: resolve(import.meta.dirname, "hike.html"),
        },
      },
      assetsDir: "assets",
      target: "es2022",
      // Useful on the web, two megabytes of dead weight in an APK that
      // nothing on the device will ever read.
      sourcemap: !native,
    },
  };
});
