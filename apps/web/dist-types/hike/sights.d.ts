/**
 * What is worth knowing about along a mountain track.
 *
 * Two sources, combined: OpenStreetMap features within a corridor of the
 * route (a spring, a refuge, a col, a bar in the next village) and Wikipedia
 * articles with coordinates nearby (the peak you are looking at, the village
 * you are walking through).
 *
 * Both are fetched once and cached, because they do not change between two
 * walks of the same path and re-asking free services would be rude — and
 * because the walker needs them in the cache *before* losing signal, which is
 * exactly when they become useful.
 */
import { type NearbyArticle, type OverpassElement, type Point3, type ProcessedTrack } from "@slownav/core";
/** How a sight is grouped in the sheet's tabs. */
export type SightGroup = "peak" | "water" | "hut" | "sight" | "food" | "shop" | "service" | "place";
/** Which marker shape it gets on the map. */
export type SightIcon = "peak" | "water" | "hut" | "poi";
export interface Sight {
    id: string;
    name: string;
    /** A short human word: "refuge", "spring", "col". */
    kind: string;
    group: SightGroup;
    icon: SightIcon;
    lat: number;
    lon: number;
    /** Distance along the track of the nearest point to it, metres. */
    prog: number;
    /** How far off the track it is, metres. */
    lateral: number;
    tags: Record<string, string>;
    ele: number | null;
    wiki: {
        lang: string;
        title: string;
        extract: string;
        url: string;
    } | null;
}
/**
 * Ask Overpass for features near the track.
 *
 * The radii differ by how far a walker would realistically detour: 800 m for
 * a named historic thing worth seeing, but only 400 m for a wayside cross.
 * Peaks get a wide radius because the one you can see is rarely the one you
 * walk over.
 */
export declare function fetchSights(pts: readonly Point3[], onStatus?: (m: string) => void): Promise<OverpassElement[]>;
/**
 * Turn OSM tags into a group, a readable kind, and a marker shape.
 *
 * Returns null for anything not worth a line in the sheet — an information
 * board is not news, but a visitor centre is.
 */
export declare function classifySight(t: Record<string, string>): {
    group: SightGroup;
    kind: string;
    icon: SightIcon;
} | null;
/** Articles near the track, English first, Spanish where nothing English exists. */
export declare function fetchWiki(pts: readonly Point3[], signal?: AbortSignal): Promise<NearbyArticle[]>;
/** Combine the OSM features and the Wikipedia articles into one ordered list. */
export declare function buildSights(elements: readonly OverpassElement[], wiki: readonly NearbyArticle[], track: ProcessedTrack): Sight[];
//# sourceMappingURL=sights.d.ts.map