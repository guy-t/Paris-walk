/**
 * Overpass client.
 *
 * Overpass is a free service run on donated hardware, and these apps ask it
 * for a corridor of features around a whole route — not a small query. Being
 * a good citizen is the point of this module:
 *
 *  - rotate across the public mirrors so no single one carries all of it;
 *  - treat 429/502/503/504 as "busy", not "broken", and back off increasingly;
 *  - give up on anything else immediately rather than hammering a server that
 *    is telling us the query itself is wrong;
 *  - report progress upwards so the UI can say *why* it is waiting.
 *
 * Results are cached by the callers in localStorage — a route's sights do not
 * change between two walks of it, and re-asking would be rude.
 */

/** Public mirrors, tried in turn. Order is deliberate: the main instance first. */
export const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
] as const;

/** Status codes that mean "try again elsewhere" rather than "this query is wrong". */
const BUSY = new Set([429, 502, 503, 504]);

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export interface OverpassOptions {
  /** Called when a server is busy, with something worth showing the user. */
  onStatus?: (message: string) => void;
  /** How many times to try before giving up. Two full rotations by default. */
  attempts?: number;
  servers?: readonly string[];
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run an Overpass QL query and return its elements.
 *
 * @throws the last error if every attempt failed.
 */
export async function overpass(
  query: string,
  opts: OverpassOptions = {},
): Promise<OverpassElement[]> {
  const {
    onStatus = () => {},
    attempts = 8,
    servers = OVERPASS_SERVERS,
    signal,
  } = opts;
  let lastErr: Error = new Error("Overpass: no attempt was made");

  for (let attempt = 0; attempt < attempts; attempt++) {
    const url = servers[attempt % servers.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal,
      });
      if (res.ok) {
        const json = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
        // Overpass reports a timeout as a 200 with a remark, not as an error status.
        if (json.remark && /timed out|runtime error/i.test(json.remark)) {
          throw new Error(json.remark);
        }
        return json.elements ?? [];
      }
      lastErr = new Error(`OpenStreetMap (Overpass) answered ${res.status}`);
      if (!BUSY.has(res.status)) throw lastErr;
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    if (attempt === attempts - 1) break;
    const wait = 4000 + attempt * 4000;
    onStatus(
      `OpenStreetMap server busy (${lastErr.message}). Trying another server in ${Math.round(wait / 1000)} s… (attempt ${attempt + 2} of ${attempts})`,
    );
    await sleep(wait);
  }
  throw lastErr;
}

/**
 * A comma-separated list of "lat,lon" for an Overpass `around:` filter.
 *
 * The line must be thinned first — an `around:` over ten thousand points is a
 * query no public server should be asked to run.
 */
export function aroundList(line: readonly (readonly [number, number, ...number[]])[]): string {
  return line.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(",");
}

/** Centre of an element, whether it is a node or a way/relation with a centre. */
export function elementCentre(e: OverpassElement): [number, number] | null {
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  return lat == null || lon == null ? null : [lat, lon];
}
