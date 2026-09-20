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

import {
  aroundList,
  elementCentre,
  haversine,
  overpass,
  project,
  simplify,
  wikiNearLine,
  type NearbyArticle,
  type OverpassElement,
  type Point3,
  type ProcessedTrack,
} from "@slownav/core";

/** How a sight is grouped in the sheet's tabs. */
export type SightGroup =
  | "peak"
  | "water"
  | "hut"
  | "sight"
  | "food"
  | "shop"
  | "service"
  | "place";

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
  wiki: { lang: string; title: string; extract: string; url: string } | null;
}

/** Corridor half-width used to thin the line before querying, metres. */
const CORRIDOR_TOLERANCE = 200;

/**
 * Ask Overpass for features near the track.
 *
 * The radii differ by how far a walker would realistically detour: 800 m for
 * a named historic thing worth seeing, but only 400 m for a wayside cross.
 * Peaks get a wide radius because the one you can see is rarely the one you
 * walk over.
 */
export async function fetchSights(
  pts: readonly Point3[],
  onStatus?: (m: string) => void,
): Promise<OverpassElement[]> {
  const coarse = aroundList(simplify(pts, CORRIDOR_TOLERANCE));
  const near = (r: number) => `(around:${r + CORRIDOR_TOLERANCE},${coarse})`;
  return overpass(
    `[out:json][timeout:90];(
      nwr["natural"~"^(peak|saddle|spring|cave_entrance|waterfall|cliff|arch|hot_spring)$"]${near(600)};
      nwr["waterway"="waterfall"]${near(600)};
      nwr["amenity"~"^(shelter|drinking_water|fountain|restaurant|cafe|bar|pub|pharmacy|place_of_worship|toilets)$"]${near(500)};
      nwr["tourism"~"^(alpine_hut|wilderness_hut|viewpoint|attraction|museum|camp_site|hotel|guest_house|picnic_site|information)$"]${near(600)};
      nwr["historic"]["name"]${near(800)};
      nwr["aerialway"~"^(station|cable_car|gondola)$"]${near(600)};
      nwr["man_made"~"^(cross|tower|lighthouse|water_well)$"]${near(400)};
      nwr["shop"~"^(supermarket|convenience|bakery|general)$"]["name"]${near(500)};
      nwr["place"~"^(village|hamlet|locality)$"]["name"]${near(700)};
    );out center tags;`,
    { onStatus },
  );
}

/**
 * Turn OSM tags into a group, a readable kind, and a marker shape.
 *
 * Returns null for anything not worth a line in the sheet — an information
 * board is not news, but a visitor centre is.
 */
export function classifySight(
  t: Record<string, string>,
): { group: SightGroup; kind: string; icon: SightIcon } | null {
  const of = (group: SightGroup, kind: string, icon: SightIcon) => ({ group, kind, icon });

  if (t.natural === "peak") {
    return of("peak", t.ele ? `peak · ${Math.round(+t.ele)} m` : "peak", "peak");
  }
  if (t.natural === "saddle") return of("peak", "col / pass", "peak");
  if (
    t.natural === "spring" ||
    t.amenity === "drinking_water" ||
    t.amenity === "fountain" ||
    t.man_made === "water_well"
  ) {
    const kind =
      t.amenity === "drinking_water"
        ? "drinking water"
        : t.natural === "spring"
          ? "spring"
          : "fountain";
    return of("water", kind, "water");
  }
  if (t.natural === "cave_entrance") return of("sight", "cave", "poi");
  if (t.natural === "waterfall" || t.waterway === "waterfall") return of("sight", "waterfall", "poi");
  if (t.natural === "cliff" || t.natural === "arch") return of("sight", t.natural, "poi");
  if (t.amenity === "shelter" || t.tourism === "alpine_hut" || t.tourism === "wilderness_hut") {
    const kind =
      t.tourism === "alpine_hut" ? "refuge" : t.tourism === "wilderness_hut" ? "hut" : "shelter";
    return of("hut", kind, "hut");
  }
  if (t.tourism === "viewpoint") return of("sight", "viewpoint", "poi");
  if (t.aerialway) return of("sight", "cable car", "poi");
  if (t.tourism === "camp_site") return of("service", "campsite", "poi");
  if (/^(hotel|guest_house)$/.test(t.tourism || "")) {
    return of("service", t.tourism.replace("_", " "), "poi");
  }
  if (t.tourism === "picnic_site") return of("service", "picnic site", "poi");
  if (t.tourism === "information") {
    // A visitor centre is useful; a trailhead noticeboard is not.
    return t.information === "office" || t.information === "visitor_centre"
      ? of("service", "information", "poi")
      : null;
  }
  if (t.amenity === "toilets") return of("service", "toilets", "poi");
  if (t.amenity === "pharmacy") return of("service", "pharmacy", "poi");
  if (/^(restaurant|cafe|bar|pub)$/.test(t.amenity || "")) return of("food", t.amenity, "poi");
  if (t.shop) return of("shop", t.shop.replace("_", " "), "poi");
  if (t.amenity === "place_of_worship") return of("sight", "church", "poi");
  if (t.historic) return of("sight", t.historic.replace(/_/g, " "), "poi");
  if (t.man_made === "cross") return of("sight", "cross", "poi");
  if (t.man_made) return of("sight", t.man_made, "poi");
  if (t.tourism) return of("sight", t.tourism.replace(/_/g, " "), "poi");
  if (t.place) return of("place", t.place, "poi");
  return null;
}

/** Articles near the track, English first, Spanish where nothing English exists. */
export function fetchWiki(pts: readonly Point3[], signal?: AbortSignal): Promise<NearbyArticle[]> {
  return wikiNearLine(pts, haversine, { langs: ["en", "es"], radius: 3000, every: 4000, signal });
}

/**
 * How far off the track something can be and still be worth listing.
 *
 * Water and shelter are only useful if you would actually detour to them;
 * a peak is worth naming from much further away, because you can see it.
 */
function maxLateral(group: SightGroup): number {
  if (group === "water" || group === "hut") return 350;
  if (group === "peak") return 900;
  return 800;
}

/** Combine the OSM features and the Wikipedia articles into one ordered list. */
export function buildSights(
  elements: readonly OverpassElement[],
  wiki: readonly NearbyArticle[],
  track: ProcessedTrack,
): Sight[] {
  const sights: Sight[] = [];
  const seen = new Set<string>();
  const place = (lat: number, lon: number) => project(track.pts, track.cum, [lat, lon], { global: true });

  for (const e of elements) {
    const centre = elementCentre(e);
    if (!centre) continue;
    const tags = e.tags ?? {};
    const c = classifySight(tags);
    if (!c) continue;
    // An unnamed thing is only worth a line if what it *is* matters: an
    // unnamed spring is still water, an unnamed church is just a building.
    if (!tags.name && c.group !== "water" && c.group !== "hut") continue;

    const p = place(centre[0], centre[1]);
    if (!p || p.dist > maxLateral(c.group)) continue;

    // Two mappers' versions of the same fountain, 3 m apart.
    const key = `${(tags.name || c.kind).toLowerCase()}|${Math.round(centre[0] * 500)}|${Math.round(centre[1] * 500)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sights.push({
      id: `${e.type}/${e.id}`,
      name: tags.name || c.kind.charAt(0).toUpperCase() + c.kind.slice(1),
      kind: c.kind,
      group: c.group,
      icon: c.icon,
      lat: centre[0],
      lon: centre[1],
      prog: p.prog,
      lateral: p.dist,
      tags,
      ele: tags.ele ? Math.round(+tags.ele) : null,
      wiki: null,
    });
  }

  for (const w of wiki) {
    const p = place(w.lat, w.lon);
    if (!p || p.dist > 3000) continue;
    // Attach the article to the feature it describes, rather than listing the
    // same peak twice — once from OSM and once from Wikipedia.
    const near = sights.find(
      (s) =>
        haversine([s.lat, s.lon], [w.lat, w.lon]) < 200 ||
        (s.name && w.title.toLowerCase().includes(s.name.toLowerCase())),
    );
    const article = { lang: w.lang, title: w.title, extract: w.extract, url: w.url };
    if (near) {
      // An English article replaces a non-English one already attached.
      if (!near.wiki || (near.wiki.lang !== "en" && w.lang === "en")) near.wiki = article;
    } else {
      sights.push({
        id: `wiki/${w.lang}${w.pageid}`,
        name: w.title,
        kind: "article",
        group: "sight",
        icon: "poi",
        lat: w.lat,
        lon: w.lon,
        prog: p.prog,
        lateral: p.dist,
        tags: {},
        ele: null,
        wiki: article,
      });
    }
  }

  sights.sort((a, b) => a.prog - b.prog);
  return sights;
}
