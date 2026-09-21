/**
 * Build the embedded hike library from the GPX files in `tracks/`.
 *
 * The files the walking company hands out are not one clean line each. A
 * day's GPX carries the route as several named sub-tracks — a SPINE, an
 * OPTION for the harder alternative, an END per possible hotel — and
 * `parseGPX` concatenates every `<trkpt>` in the document into one polyline,
 * because that is the only thing it can honestly do with a file it has never
 * seen. So day 1 imported as 34.6 km for a 14.5 km walk: the harder option,
 * a 175 m viewpoint detour and three hotel spurs strung end to end, with a
 * straight-line jump between each. Every distance, ETA and "next waypoint"
 * built on that line was wrong.
 *
 * This picks the sub-tracks that make up one walk, in the order they are
 * walked, and splices a harder option into the main line where it branches
 * and rejoins so that variant is a whole day too rather than a middle
 * fragment.
 *
 * Run `node scripts/build-tracks.mjs` to rewrite the JSON, or with `--check`
 * to assert the committed JSON is what this produces. CI runs the check, so
 * the file cannot drift from the tracks it is built from.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simplify, haversine } from "../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "apps/web/src/hike/tracks.json");

/**
 * Which sub-tracks make each hike, and which waypoints belong to it.
 *
 * `without` cannot be worked out from the geometry, which is why it is
 * written down. A waypoint on the harder option sits within 150 m of the
 * main line where the two run close — waypoint `A` on day 1 is metres from
 * the monastery the main route also passes — so keeping it would anchor the
 * harder option's notes onto a line it does not walk. Equally, `Hotel
 * Cosgaya` is 40 m from the end of the line and must stay, although the
 * spur to its door is not included.
 *
 * `ids` are frozen: they key the walker's saved notes (`hike:notes:<id>`)
 * and sessions, so renaming one on the eve of a walk loses both.
 */
const LINES = [
  {
    id: "5_Potes_to_Cosgaya",
    name: "Day 1 Potes to Cosgaya",
    file: "5_Potes_to_Cosgaya.gpx",
    parts: ["5 SPINE Potes to Cosgaya", "5 END Oso"],
    without: [
      "A", "B", "C", "D", "Ermita Catalina", "Baro", // the harder option's
      "Casa Trevino", // a spur off the end, and 430 m off this line
      "Apartment El Nial de Potes", "Plaza Capitan Palacios", // not on the walk
    ],
  },
  {
    id: "5_Potes_to_Cosgaya_harder",
    name: "Day 1 Potes to Cosgaya (harder option)",
    file: "5_Potes_to_Cosgaya.gpx",
    parts: ["5 SPINE Potes to Cosgaya", "5 END Oso"],
    splice: "5 OPTION Harder option",
    without: [
      "2", "3", "4", "Mirador de San Miguel", "Congarna", "Beares", "San Pelayo",
      "Casa Trevino", "Apartment El Nial de Potes", "Plaza Capitan Palacios",
    ],
  },
  {
    id: "6a_Cosgaya_to_Fuente_De",
    name: "Day 2 Cosgaya to Fuente Dé",
    file: "6a_Cosgaya_to_Fuente_De.gpx",
    parts: ["6a SPINE Cosgaya to Fuente"],
    without: ["A", "B", "C", "D", "Casa Trevino"],
  },
  {
    id: "6a_Cosgaya_to_Fuente_De_harder",
    name: "Day 2 Cosgaya to Fuente Dé (harder option)",
    file: "6a_Cosgaya_to_Fuente_De.gpx",
    parts: ["6a SPINE Cosgaya to Fuente"],
    splice: "6a OPTION Cosgaya to Espinama",
    without: ["3", "4", "5", "Casa Trevino"],
  },
  {
    id: "7a_Fuente_De_High_Picos_circuit",
    name: "Day 3 Fuente Dé High Picos Circuit",
    file: "7a_Fuente_De_High_Picos_circuit.gpx",
  },
  {
    id: "8a_Fuente_De_Valley_circuit",
    name: "Day 4 Fuente Dé Valley Circuit",
    file: "8a_Fuente_De_Valley_circuit.gpx",
  },
  {
    // No route notes describe this one; it is the Espinama start of day 3,
    // and it is a single track already.
    id: "7_Espinama_High_Picos_circuit",
    name: "Espinama High Picos circuit",
    file: "7_Espinama_High_Picos_circuit.gpx",
  },
];

/**
 * Waypoint names the route notes use, where the GPX says something else.
 *
 * A bracketed `[Aliva Refuge]` anchors a step only if a waypoint is called
 * that. These files name some points in a Garmin `<label_text>` extension
 * and leave `<name>` off altogether, which no GPX reader is obliged to look
 * at — `readWaypoints` falls back to it, and these three are then still the
 * wrong words.
 */
const RENAME = {
  "[Parador] Parador Fuente De": "Parador de Fuente Dé",
  "Parador Fuente De": "Parador de Fuente Dé",
  "Cable car station": "Fuente Dé cable car",
};

const text = (s, tag) => {
  const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : "";
};

function readWaypoints(xml) {
  return [...xml.matchAll(/<wpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"\s*>([\s\S]*?)<\/wpt>/g)].map(
    (m) => {
      const body = m[3];
      const name = text(body, "name") || text(body, "label_text");
      return { name: RENAME[name] ?? name, desc: text(body, "desc"), lat: +m[1], lon: +m[2] };
    },
  );
}

function readTracks(xml) {
  return [...xml.matchAll(/<trk>([\s\S]*?)<\/trk>/g)].map((t) => ({
    name: text(t[1], "name"),
    pts: [...t[1].matchAll(/<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"\s*>([\s\S]*?)<\/trkpt>/g)].map(
      (p) => [+p[1], +p[2], +(text(p[3], "ele") || 0)],
    ),
  }));
}

/** The index on `line` of the point nearest `p`. */
const nearest = (line, p) =>
  line.reduce((best, q, i) => (haversine(q, p) < haversine(line[best], p) ? i : best), 0);

function build(spec, xml) {
  const tracks = readTracks(xml);
  const part = (name) => {
    const t = tracks.find((x) => x.name === name);
    if (!t) throw new Error(`${spec.file}: no sub-track named "${name}"`);
    return t.pts;
  };

  let pts = spec.parts ? spec.parts.flatMap(part) : tracks.flatMap((t) => t.pts);
  if (spec.splice) {
    // An option leaves the main line and comes back to it. Cut the main line
    // at the two nearest points and sew the option in, so the result is one
    // continuous day rather than the middle of one.
    const main = part(spec.parts[0]);
    const alt = part(spec.splice);
    const rest = spec.parts.slice(1).flatMap(part);
    pts = [
      ...main.slice(0, nearest(main, alt[0])),
      ...alt,
      ...main.slice(nearest(main, alt.at(-1))),
      ...rest,
    ];
  }

  const without = new Set(spec.without ?? []);
  return {
    id: spec.id,
    name: spec.name,
    // Simplified and rounded exactly as `parseGPX` does on import, so a file
    // the walker imports themselves and the copy shipped here are the same
    // line rather than two that disagree by centimetres.
    pts: simplify(pts, 3).map((p) => [+p[0].toFixed(6), +p[1].toFixed(6), Math.round(p[2])]),
    wpts: readWaypoints(xml).filter((w) => w.name && !without.has(w.name)),
  };
}

const known = new Set(LINES.map((l) => l.file));
for (const f of readdirSync(join(root, "tracks"))) {
  if (f.endsWith(".gpx") && !known.has(f) && !f.startsWith("paris_")) {
    throw new Error(`tracks/${f} is not in LINES — add it, or the app will not ship it`);
  }
}

const built = LINES.map((spec) => build(spec, readFileSync(join(root, "tracks", spec.file), "utf8")));
const json = JSON.stringify(built) + "\n";

if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== json) {
    console.error("apps/web/src/hike/tracks.json is not what tracks/*.gpx build to.");
    console.error("Run: node scripts/build-tracks.mjs");
    process.exit(1);
  }
  console.log("tracks.json matches tracks/*.gpx");
} else {
  writeFileSync(OUT, json);
  for (const h of built) {
    let d = 0;
    for (let i = 1; i < h.pts.length; i++) d += haversine(h.pts[i - 1], h.pts[i]);
    console.log(`${(d / 1000).toFixed(2).padStart(6)} km  ${h.pts.length.toString().padStart(4)} pts  ${h.wpts.length.toString().padStart(2)} wpts  ${h.name}`);
  }
}
