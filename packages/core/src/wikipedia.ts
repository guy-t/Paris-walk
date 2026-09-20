/**
 * Wikipedia lookups, English first.
 *
 * The OSM data these apps read is tagged in the local language: a Paris church
 * carries `wikipedia=fr:Église Saint-Sulpice`, a Picos peak `es:Peña Vieja`.
 * Following that tag directly would hand an English reader an article they
 * cannot read. So every path here tries to reach the English article first —
 * through an explicit `wikipedia:en` tag, through the local article's language
 * links, or through Wikidata's sitelinks — and only falls back to the original
 * language when no English article exists. The fallback always carries its
 * `lang` so the UI can label it before the reader taps.
 */

import type { AnyPoint } from "./geo.js";

export interface WikiSummary {
  extract: string;
  url: string;
  /** Language the article is actually in — "en" unless nothing English existed. */
  lang: string;
  title?: string;
  thumb?: string;
}

/** Fetch the REST summary for one article. Null for anything but a usable extract. */
async function summary(lang: string, title: string): Promise<WikiSummary | null> {
  try {
    const r = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      extract?: string;
      thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string }; mobile?: { page?: string } };
      title?: string;
    };
    if (!j.extract) return null;
    return {
      extract: j.extract,
      thumb: j.thumbnail?.source,
      url:
        j.content_urls?.desktop?.page ??
        j.content_urls?.mobile?.page ??
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      lang,
      title: j.title ?? title,
    };
  } catch {
    return null;
  }
}

const LANGLINK = "*";

/** The English title linked from an article in another language, if there is one. */
async function englishTitleFor(lang: string, title: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=en&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`,
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      query?: { pages?: Record<string, { langlinks?: Record<string, string>[] }> };
    };
    const pages = Object.values(j.query?.pages ?? {});
    return pages[0]?.langlinks?.[0]?.[LANGLINK] ?? null;
  } catch {
    return null;
  }
}

/** English (and French, as a second-best) article titles for a Wikidata entity. */
async function wikidataTitles(id: string): Promise<{ en?: string; fr?: string }> {
  try {
    const r = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=sitelinks&format=json&origin=*`,
    );
    if (!r.ok) return {};
    const j = (await r.json()) as {
      entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }>;
    };
    const sl = Object.values(j.entities ?? {})[0]?.sitelinks ?? {};
    return { en: sl.enwiki?.title, fr: sl.frwiki?.title };
  } catch {
    return {};
  }
}

/**
 * Best available Wikipedia summary for an OSM feature, given its tags.
 *
 * Tried in order: an explicit English article, the tagged article's English
 * language link, Wikidata's English sitelink, and finally the tagged article
 * in its own language.
 */
export async function wikiSummaryForTags(
  tags: Record<string, string>,
): Promise<WikiSummary | null> {
  // 1. An explicit English article beats everything.
  if (tags["wikipedia:en"]) {
    const s = await summary("en", tags["wikipedia:en"]);
    if (s) return s;
  }

  // 2. The plain wikipedia tag, usually "fr:Title" or "es:Title".
  let lang: string | null = null;
  let title: string | null = null;
  if (tags.wikipedia) {
    const m = tags.wikipedia.match(/^(\w+):(.+)$/);
    if (m) {
      lang = m[1];
      title = m[2];
    } else {
      lang = "en";
      title = tags.wikipedia;
    }
  }
  if (title && lang === "en") {
    const s = await summary("en", title);
    if (s) return s;
  }
  if (title && lang && lang !== "en") {
    const en = await englishTitleFor(lang, title);
    if (en) {
      const s = await summary("en", en);
      if (s) return s;
    }
  }

  // 3. Wikidata often knows about an English article the OSM tags do not.
  if (tags.wikidata) {
    const { en, fr } = await wikidataTitles(tags.wikidata);
    if (en) {
      const s = await summary("en", en);
      if (s) return s;
    }
    if (!title && fr) {
      lang = "fr";
      title = fr;
    }
  }

  // 4. Nothing in English exists. Return the local article, labelled by `lang`.
  if (title && lang) return summary(lang, title);
  return null;
}

export interface NearbyArticle {
  lang: string;
  title: string;
  lat: number;
  lon: number;
  pageid: number;
  extract: string;
  url: string;
}

export interface NearbyOptions {
  /** Languages to search, in order of preference. English first. */
  langs?: string[];
  /** Search radius around each sample point, metres. */
  radius?: number;
  /** Distance between sample points along the line, metres. */
  every?: number;
  /** Two articles closer together than this are treated as the same place. */
  dedupeWithin?: number;
  signal?: AbortSignal;
}

type Distance = (a: AnyPoint, b: AnyPoint) => number;

/**
 * Wikipedia articles with coordinates near a line, with their summaries.
 *
 * Sampled every few kilometres rather than at every point: geosearch covers a
 * radius, so consecutive samples overlap heavily and more of them would only
 * mean more requests for the same articles. Summaries come back in batches of
 * 20 so they are already in the cache before the walker loses signal.
 *
 * `distance` is injected rather than imported so this module stays free of the
 * geometry it does not otherwise need.
 */
export async function wikiNearLine(
  line: readonly AnyPoint[],
  distance: Distance,
  opts: NearbyOptions = {},
): Promise<NearbyArticle[]> {
  const { langs = ["en"], radius = 3000, every = 4000, dedupeWithin = 150, signal } = opts;

  const samples: AnyPoint[] = [];
  let travelled = 0;
  let lastSample = -Infinity;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) travelled += distance(line[i - 1], line[i]);
    if (travelled - lastSample > every) {
      samples.push(line[i]);
      lastSample = travelled;
    }
  }

  const found = new Map<string, Omit<NearbyArticle, "extract" | "url">>();
  for (const lang of langs) {
    for (const p of samples) {
      try {
        const r = await fetch(
          `https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${p[0]}|${p[1]}&gsradius=${radius}&gslimit=30&format=json&origin=*`,
          { signal },
        );
        if (!r.ok) continue;
        const j = (await r.json()) as {
          query?: { geosearch?: { pageid: number; title: string; lat: number; lon: number }[] };
        };
        for (const g of j.query?.geosearch ?? []) {
          const key = `${lang}:${g.pageid}`;
          if (!found.has(key)) {
            found.set(key, { lang, title: g.title, lat: g.lat, lon: g.lon, pageid: g.pageid });
          }
        }
      } catch {
        if (signal?.aborted) throw new Error("Cancelled");
      }
    }
  }

  const out: NearbyArticle[] = [];
  for (const lang of langs) {
    const items = [...found.values()].filter((x) => x.lang === lang);
    for (let i = 0; i < items.length; i += 20) {
      const batch = items.slice(i, i + 20);
      try {
        const r = await fetch(
          `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=500&pageids=${batch.map((b) => b.pageid).join("|")}&format=json&origin=*`,
          { signal },
        );
        const pages = r.ok
          ? ((
              (await r.json()) as {
                query?: { pages?: Record<string, { extract?: string; fullurl?: string }> };
              }
            ).query?.pages ?? {})
          : {};
        for (const b of batch) {
          const pg = pages[String(b.pageid)];
          out.push({
            ...b,
            extract: pg?.extract ?? "",
            url: pg?.fullurl ?? `https://${lang}.wikipedia.org/?curid=${b.pageid}`,
          });
        }
      } catch {
        // Keep the article even with no summary — the link still works online.
        for (const b of batch) {
          out.push({ ...b, extract: "", url: `https://${lang}.wikipedia.org/?curid=${b.pageid}` });
        }
      }
    }
  }

  // The same place in two languages: keep the first language listed, which is English.
  const kept: NearbyArticle[] = [];
  for (const lang of langs) {
    for (const x of out.filter((o) => o.lang === lang)) {
      if (!kept.some((k) => distance([k.lat, k.lon], [x.lat, x.lon]) < dedupeWithin)) kept.push(x);
    }
  }
  return kept;
}
