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
  maxZoom: number;
  /** Highest zoom the server actually has tiles for; Leaflet upscales beyond. */
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
    maxZoom: 17,
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
    maxZoom: 18,
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
    maxZoom: 19,
    maxNativeZoom: 18,
    bounds: FRANCE,
    tileKB: 60,
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

/** Is this point roughly within the provider's coverage? */
export function covers(provider: MapProvider, point: AnyPoint): boolean {
  if (!provider.bounds) return true;
  const [[s, w], [n, e]] = provider.bounds;
  return point[0] >= s && point[0] <= n && point[1] >= w && point[1] <= e;
}

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
export function providersFor(point: AnyPoint): ProviderOption[] {
  return MAP_PROVIDERS.map((provider) => ({
    provider,
    available: covers(provider, point),
  })).sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1));
}

/**
 * Which provider to start with.
 *
 * `preferred` is the app's own ordered opinion — the hiking app knows its
 * routes are in the Picos and asks for the Spanish survey first; the boat and
 * the Paris walk ask for the French map. That is a far more reliable signal
 * than trying to infer a country from a coordinate, and it degrades honestly:
 * an imported GPX from somewhere else simply falls through to a worldwide map.
 *
 * Providers needing an API key are never chosen automatically — a key the
 * traveller has not supplied would mean a blank screen.
 */
export function suggestProvider(point: AnyPoint, preferred: readonly string[] = []): MapProvider {
  const usable = (p: MapProvider) => !p.keyName && covers(p, point);

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
