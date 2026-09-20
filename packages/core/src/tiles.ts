/**
 * Downloading map tiles for a corridor around a route, so the map still works
 * with no signal.
 *
 * OpenTopoMap and the OSM tile servers are volunteer-funded, and their usage
 * policy forbids bulk downloading. What makes this acceptable is that it is
 * strictly bounded: a corridor of a few hundred metres either side of one
 * route the user is actually about to walk, over five zoom levels. A typical
 * day hike comes to a few thousand tiles, not a region.
 *
 * The politeness rules are enforced here rather than left to callers:
 * three concurrent requests, a 60 ms gap after each, and nothing is
 * re-fetched if it is already in the cache.
 */

import { simplify, type AnyPoint } from "./geo.js";

/** Cache name, shared across app versions so downloaded maps survive an update. */
export const TILE_CACHE = "slownav-tiles";

export interface TileSource {
  /** URL template with {z}/{x}/{y}. */
  url: string;
  /** Zoom levels to download. */
  zooms: number[];
  /** Half-width of the downloaded corridor, metres. */
  corridorM: number;
}

export const OPENTOPO: TileSource = {
  url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  zooms: [12, 13, 14, 15, 16],
  corridorM: 900,
};

/** Slippy-map tile containing a coordinate at a zoom level. */
export function tileXY(lat: number, lon: number, z: number): [x: number, y: number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
      n,
  );
  return [x, y];
}

/**
 * Every tile URL needed to cover a corridor around a line.
 *
 * The line is thinned to 80 m first: at these zooms neighbouring track points
 * land in the same tile, so the full track would mean hundreds of thousands of
 * redundant Set insertions for the same few thousand tiles.
 */
export function corridorTiles(
  pts: readonly AnyPoint[],
  source: TileSource = OPENTOPO,
): string[] {
  const set = new Set<string>();
  const line = simplify(pts, 80);
  for (const z of source.zooms) {
    const metresPerTile = (40075016 * Math.cos((pts[0][0] * Math.PI) / 180)) / 2 ** z;
    const r = Math.max(1, Math.ceil(source.corridorM / metresPerTile));
    for (const p of line) {
      const [x, y] = tileXY(p[0], p[1], z);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) set.add(`${z}/${x + dx}/${y + dy}`);
      }
    }
  }
  return [...set].map((k) => {
    const [z, x, y] = k.split("/");
    return source.url.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  });
}

/** Rough size of a tile download, for telling the user before they start it. */
export function estimateMB(tileCount: number): number {
  return Math.round((tileCount * 22) / 1024); // ~22 kB per OpenTopoMap tile
}

/** How many of these tiles are already downloaded. */
export async function cachedCount(urls: readonly string[]): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const cache = await caches.open(TILE_CACHE);
    let n = 0;
    for (const u of urls) if (await cache.match(u)) n++;
    return n;
  } catch {
    return 0;
  }
}

export interface PrecacheProgress {
  done: number;
  total: number;
  failed: number;
}

export interface PrecacheResult {
  done: number;
  failed: number;
}

/** Concurrent fetches. Three is the limit the OSM tile usage policy names. */
const CONCURRENCY = 3;
/** Pause after each tile, per worker. Keeps the sustained rate civil. */
const GAP_MS = 60;

/**
 * Download tiles into the cache, politely.
 *
 * Failures are counted rather than thrown: a handful of missing tiles leaves a
 * usable map with a few blank squares, and aborting the whole download over
 * one 500 would leave the walker with nothing.
 */
export async function precacheTiles(
  urls: readonly string[],
  onProgress: (p: PrecacheProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<PrecacheResult> {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  let failed = 0;
  let next = 0;

  const worker = async () => {
    while (next < urls.length) {
      if (signal?.aborted) return;
      const u = urls[next++];
      try {
        if (!(await cache.match(u))) {
          let res: Response;
          try {
            res = await fetch(u, { mode: "cors", signal });
          } catch {
            // Some tile hosts do not send CORS headers; an opaque response
            // cannot be read but can still be cached and displayed.
            res = await fetch(u, { mode: "no-cors" });
          }
          if (res.ok || res.type === "opaque") await cache.put(u, res);
          else failed++;
        }
      } catch {
        failed++;
      }
      done++;
      onProgress({ done, total: urls.length, failed });
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { done, failed };
}

/** Bytes this origin is using, when the browser will say. */
export async function storageUsedMB(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.usage != null ? Math.round(e.usage / 1048576) : null;
  } catch {
    return null;
  }
}
