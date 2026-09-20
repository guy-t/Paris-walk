import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * One Vite app, three HTML entries — hike.html, canalmap.html and
 * pariswalk.html — rather than three separate builds.
 *
 * That keeps every original URL working exactly as it did, while the shared
 * core, Leaflet and React end up in chunks all three entries reference. A
 * walker who has opened one app has already downloaded most of the next.
 *
 * `base` matches the GitHub Pages project path. The site is served from
 * /Paris-walk/, not from the domain root.
 */
export default defineConfig({
  // The ported apps are published under /next/ while the original single-file
  // versions keep serving the real URLs. Once a port has been walked with and
  // trusted, SLOWNAV_BASE becomes "/Paris-walk/" and it takes over the old
  // path; nothing else about the build changes.
  base: process.env.SLOWNAV_BASE ?? "/Paris-walk/next/",
  plugins: [
    react(),
    VitePWA({
      // The same filename the original service worker used, so existing
      // installs update their registration in place instead of leaving a
      // stale worker serving a cached app forever.
      filename: "sw.js",
      registerType: "prompt", // the app shows "a new version is ready"
      injectRegister: null, // registered by useServiceWorker, not by the plugin
      // Serve a real worker in dev too, so the offline behaviour and the
      // update prompt can be exercised without a production build.
      devOptions: { enabled: true, type: "module" },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Map tiles are cached by the app's own corridor download, which is
        // bounded to a route. Nothing here should try to cache the whole map.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[abc]?\.?tile\.opentopomap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              // Shared with precacheTiles in @slownav/core: a downloaded hike
              // survives an app update.
              cacheName: "slownav-tiles",
              expiration: { maxEntries: 20000, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "Slow Navigator",
        short_name: "Slow Nav",
        description: "Walking, hiking and boating companions that keep working offline.",
        start_url: "./hike.html",
        scope: "./",
        display: "standalone",
        background_color: "#f4f5f2",
        theme_color: "#2f4f3e",
        orientation: "portrait",
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        // The launcher, which is also what the native shell opens into.
        index: resolve(import.meta.dirname, "index.html"),
        hike: resolve(import.meta.dirname, "hike.html"),
      },
    },
    // Named per entry so three apps can share one output directory without
    // overwriting one another's assets.
    assetsDir: "assets",
    target: "es2022",
    sourcemap: true,
  },
});
