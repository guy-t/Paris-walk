/**
 * Map providers.
 *
 * No single base map is best everywhere. A national survey is the better map
 * where it exists — properly classified paths, and rock and scree drawn by
 * people who went and looked, which matters in limestone country where
 * DEM-derived contours smooth away the cliff you are standing on. But a
 * national survey stops at the border and is revised on a cycle of years,
 * while an OpenStreetMap-derived map covers everywhere and is current to
 * within days.
 *
 * So the app carries several and lets the traveller choose, defaulting to the
 * best one that actually covers where they are.
 *
 * Every provider here permits caching tiles for offline use. That is a
 * deliberate entry requirement, not an accident: the "prepare for offline"
 * feature is the reason these apps exist, and several otherwise excellent
 * commercial sources — Google's among them — explicitly forbid it.
 */

import type { AnyPoint } from "./geo.js";

export interface MapProvider {
  id: string;
  /** Shown in the picker. */
  name: string;
  /** One line explaining when to choose this one. */
  note: string;
  /** Tile URL template with {z}/{x}/{y}. */
  url: string;
  attribution: string;
  /**
   * Furthest the map may be zoomed. Set well past `maxNativeZoom` on purpose:
   * beyond the native level Leaflet upscales, which is soft but still worth
   * having — at 1:25,000 the contours run out long before the usefulness of
   * seeing exactly where you are standing relative to them does.
   */
  maxZoom: number;
  /** Highest zoom with genuinely new detail. Past this, tiles are upscaled. */
  maxNativeZoom: number;
  /**
   * Roughly where it has coverage. Omitted means worldwide.
   *
   * Deliberately approximate, and deliberately overlapping near borders — a
   * national mapping agency does serve tiles some way across its own frontier,
   * and an axis-aligned box cannot follow the Pyrenees anyway. This is only
   * used to grey out a provider that is obviously nowhere near, never to
   * decide which of two plausible maps is the right one. That decision
   * belongs to the app, which knows where its routes are.
   */
  bounds?: BBox;
  /**
   * Needs an API key the user supplies. Keys live in localStorage only and
   * are never committed, the same rule the walk planner's Places key follows.
   */
  keyName?: string;
  /** Roughly how big one tile is, for estimating a download. */
  tileKB: number;
}

/** [[south, west], [north, east]] */
export type BBox = [[number, number], [number, number]];

/** Peninsular Spain, generously. */
const SPAIN: BBox = [
  [35.8, -9.6],
  [44.0, 4.4],
];

/** Metropolitan France, generously. */
const FRANCE: BBox = [
  [41.2, -5.3],
  [51.2, 9.7],
];

export const MAP_PROVIDERS: MapProvider[] = [
  {
    id: "opentopo",
    name: "OpenTopoMap",
    note: "Worldwide, with contours. Volunteer-run, so be gentle with it.",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Map: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · data © OpenStreetMap',
    maxZoom: 19,
    maxNativeZoom: 16,
    tileKB: 22,
  },
  {
    id: "ign-es",
    name: "Spain IGN 1:25,000",
    note: "The Spanish national survey. The best map for the Picos.",
    // The WMTS raster service, in Web Mercator so it drops straight into a
    // normal tile layer. Open under Spain's CC-BY licence (FOM/2807/2015),
    // which permits reuse and caching with attribution.
    url:
      "https://www.ign.es/wmts/mapa-raster?layer=MTN&style=default" +
      "&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0" +
      "&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}",
    attribution:
      'Map: <a href="https://www.ign.es">IGN España</a> (CC BY 4.0) · Mapa Topográfico Nacional',
    // Detail runs out around 16-17 — beyond that the server upscales the
    // scanned 1:25,000 sheet, so tiles keep arriving but stop saying more.
    maxZoom: 20,
    maxNativeZoom: 17,
    bounds: SPAIN,
    tileKB: 26,
  },
  {
    id: "ign-fr",
    name: "Plan IGN (France)",
    note: "The French national map. Best for the canal and for Paris.",
    // Géoplateforme's open layer. SCAN 25 is the closer analogue of Spain's
    // MTN25 but is no longer served without authentication, so Plan IGN v2 —
    // which is open — is used instead.
    url:
      "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
      "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM" +
      "&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/png",
    attribution: 'Map: <a href="https://www.ign.fr">IGN France</a> · Géoplateforme',
    maxZoom: 20,
    maxNativeZoom: 18,
    bounds: FRANCE,
    tileKB: 60,
  },
  {
    id: "pnoa-es",
    name: "Spain aerial (PNOA)",
    note: "Real detail when you zoom right in — useful for finding the path on the ground.",
    // Orthophotography at 0.25-0.5 m/pixel, so unlike the scanned topo sheet
    // this keeps resolving detail at the highest zooms. Same open licence.
    url:
      "https://www.ign.es/wmts/pnoa-ma?layer=OI.OrthoimageCoverage&style=default" +
      "&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0" +
      "&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}",
    attribution: 'Imagery: <a href="https://www.ign.es">IGN España</a> · PNOA (CC BY 4.0)',
    maxZoom: 20,
    maxNativeZoom: 20,
    bounds: SPAIN,
    tileKB: 30,
  },
  {
    id: "ortho-fr",
    name: "France aerial (IGN)",
    note: "French orthophotography, for when the map is not enough.",
    url:
      "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
      "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM" +
      "&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg",
    attribution: 'Imagery: <a href="https://www.ign.fr">IGN France</a> · Géoplateforme',
    maxZoom: 20,
    maxNativeZoom: 19,
    bounds: FRANCE,
    tileKB: 35,
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    note: "Worldwide street map. No contours, but always available.",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    maxNativeZoom: 19,
    tileKB: 18,
  },
  {
    id: "maptiler-outdoor",
    name: "MapTiler Outdoor",
    note: "Worldwide topographic, updated continuously. Needs your own API key.",
    // Raster tiles of the vector style, so this needs no change to the map
    // component. The key is appended at read time and never stored in the repo.
    url: "https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key={key}",
    attribution:
      '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 20,
    maxNativeZoom: 18,
    keyName: "maptiler",
    tileKB: 30,
  },
];

export const DEFAULT_PROVIDER_ID = "opentopo";

export function getProvider(id: string | null | undefined): MapProvider {
  return (
    MAP_PROVIDERS.find((p) => p.id === id) ??
    MAP_PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID)!
  );
}

/**
 * Is this point, or every point of this route, roughly within coverage?
 *
 * A route rather than a point because a day can cross a border: day 6 of the
 * Basque trip starts in Spain, spends its afternoon in France and comes back
 * over the water. Asked about its first point alone, the Spanish survey says
 * yes and then serves nothing for half the walk.
 */
export function covers(provider: MapProvider, where: AnyPoint | readonly AnyPoint[]): boolean {
  if (!provider.bounds) return true;
  const [[s, w], [n, e]] = provider.bounds;
  const inside = (p: AnyPoint) => p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;
  return isRoute(where) ? where.every(inside) : inside(where);
}

const isRoute = (x: AnyPoint | readonly AnyPoint[]): x is readonly AnyPoint[] =>
  Array.isArray(x) && typeof x[0] !== "number";

export interface ProviderOption {
  provider: MapProvider;
  /** False when the provider has no tiles anywhere near this point. */
  available: boolean;
}

/**
 * Every provider, with whether it reaches this point, available ones first.
 *
 * Providers that do not reach are still returned rather than filtered out, so
 * the picker can show them greyed with a reason instead of silently omitting
 * an option the traveller went looking for.
 */
export function providersFor(where: AnyPoint | readonly AnyPoint[]): ProviderOption[] {
  return MAP_PROVIDERS.map((provider) => ({
    provider,
    available: covers(provider, where),
  })).sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1));
}

/**
 * Which provider to start with.
 *
 * `preferred` is the app's own ordered opinion — the hiking app asks for the
 * Spanish survey first, the boat and the Paris walk for the French map. That
 * is a more reliable signal than inferring a country from a coordinate, and
 * it degrades honestly: a route somewhere else falls through to a worldwide
 * map rather than to a survey that stops at a border.
 *
 * Hand it the whole route where there is one. A preference only counts if it
 * covers all of it, so a walk that crosses into France is given a map that
 * has France on it instead of one that runs out at lunchtime.
 *
 * Providers needing an API key are never chosen automatically — a key the
 * traveller has not supplied would mean a blank screen.
 */
export function suggestProvider(
  where: AnyPoint | readonly AnyPoint[],
  preferred: readonly string[] = [],
): MapProvider {
  const usable = (p: MapProvider) => !p.keyName && covers(p, where);

  for (const id of preferred) {
    const p = MAP_PROVIDERS.find((x) => x.id === id);
    if (p && usable(p)) return p;
  }
  // Then any regional survey that reaches, then anything worldwide.
  const regional = MAP_PROVIDERS.find((p) => p.bounds && usable(p));
  if (regional) return regional;
  return MAP_PROVIDERS.find((p) => !p.bounds && usable(p)) ?? getProvider(DEFAULT_PROVIDER_ID);
}

/**
 * The usable tile URL, with any API key filled in.
 *
 * Returns null when the provider needs a key that has not been supplied, so
 * callers show the picker rather than a grid of broken tiles.
 */
export function tileUrl(provider: MapProvider, key?: string | null): string | null {
  if (!provider.keyName) return provider.url;
  if (!key) return null;
  return provider.url.replace("{key}", encodeURIComponent(key));
}
