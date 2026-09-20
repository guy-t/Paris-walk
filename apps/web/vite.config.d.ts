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
declare const _default: import("vite").UserConfig;
export default _default;
//# sourceMappingURL=vite.config.d.ts.map