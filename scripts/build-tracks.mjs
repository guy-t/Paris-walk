/**
 * Build the embedded hike library from the GPX files in `tracks/`.
 *
 * The files a walking company hands out are not one clean line each. A day's
 * GPX carries the route as several named sub-tracks — a spine, an option or
 * two, a spur per possible hotel — and `parseGPX` concatenates every
 * `<trkpt>` in the document into one polyline, because that is the only thing
 * it can honestly do with a file it has never seen. Day 1 imported as 34.6 km
 * for a 14.5 km walk: the harder option, a 175 m viewpoint detour and three
 * hotel spurs strung end to end, with a straight-line jump between each.
 * Every distance, ETA and "next waypoint" built on that line was wrong.
 *
 * This used to be fixed by a hand-written manifest naming, per line, which
 * sub-tracks to concatenate, which one to splice in, and which waypoints to
 * leave out. That worked for four days in the Picos and does not generalise:
 * the next trip's files carry nine and twenty sub-tracks, name their roles
 * differently, and would need the whole thing writing again by eye.
 *
 * So the structure is *derived* from the geometry now. A sub-track whose two
 * ends both sit on the spine is an option and is spliced; one whose single
 * end sits on the spine is a spur onto or off it; one with neither is
 * detached and is reported rather than guessed at. Measured against the four
 * Picos days, that reproduces the hand-written manifest exactly, and it reads
 * the Basque files — which nobody wrote a manifest for — without changes.
 *
 * `tracks/trips.json` keeps only what geometry cannot say: the day number in
 * the itinerary, which hotel spur was actually walked, which options are
 * worth a line of their own, and the few waypoints that sit beside a route
 * without being on it.
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
const TRIPS = join(root, "tracks", "trips.json");

/**
 * An endpoint this close to the spine is *on* it.
 *
 * These files are surveyed on foot, so a sub-track that starts where another
 * ends starts within a few metres of it, not on the same coordinate. Measured
 * across both trips, every genuine join is inside 5 m and the nearest thing
 * that is not a join — a taxi drop at the Ibardin Pass — is 625 m away, so
 * there is nothing near the threshold to get wrong.
 */
const JOIN_M = 25;

/**
 * How much nearer a waypoint must be to one sibling line than another before
 * it is taken to belong to that one rather than both.
 *
 * This replaces a hand-written exclusion list. Two lines of the same day share
 * most of their length, and a waypoint on the shared part is a few metres from
 * each — Monastery Santo Toribio is 51 m from the main line and 38 m from the
 * harder option, and belongs to both. Below 30 m of difference the file is not
 * saying anything; above it, it is.
 */
const SAME_M = 30;

/**
 * A step between two points worth looking at.
 *
 * Track points on these files land 50-100 m apart at their sparsest, so
 * anything past this is either something nobody walked — day 3 takes the
 * Fuente Dé cable car — or a seam that did not meet.
 */
const GAP_M = 200;

/**
 * Beyond this a waypoint is not on this line at all.
 *
 * Generous on purpose. Everything in a day's file belongs to that day, so
 * this is not deciding whether a point is relevant — the comparative rule
 * above decides which *variant* it is on, which is the question that
 * actually has a wrong answer. A tight radius here only loses things a
 * walker wants: Bar Máximo sits 297 m off the day-4 circuit and is a bar.
 */
const NEAR_M = 1000;

const text = (s, tag) => {
  const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : "";
};

/**
 * Every `<trkpt>` or `<wpt>` in a chunk of GPX, in document order.
 *
 * Written tolerantly on purpose. The first version required
 * `lat="…" lon="…">` in that order with a body and a closing tag, which is
 * what the Picos files happen to contain — and it silently dropped 53 points
 * from one of the next trip's files and 122 from the other, because a point
 * with no elevation is written `<trkpt lat="…" lon="…"/>`. Silently, and a
 * dropped point is a straight line across whatever was between: the very
 * fault this whole script exists to prevent, reintroduced by its own parser.
 *
 * So: either form of tag, attributes in any order, and `readPoints` is
 * checked against a plain count of the opening tags before anything is built.
 */
function readPoints(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");
  for (const m of xml.matchAll(re)) {
    const attrs = m[1];
    const lat = /\blat\s*=\s*"([-\d.eE+]+)"/.exec(attrs);
    const lon = /\blon\s*=\s*"([-\d.eE+]+)"/.exec(attrs);
    if (!lat || !lon) continue;
    out.push({ lat: +lat[1], lon: +lon[1], body: m[2] ?? "" });
  }
  return out;
}

/** How many of a tag the document opens, however each one is closed. */
const count = (xml, tag) => (xml.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length;

function checked(xml, tag, where) {
  const found = readPoints(xml, tag);
  const opened = count(xml, tag);
  if (found.length !== opened) {
    throw new Error(
      `${where}: read ${found.length} of ${opened} <${tag}> elements. A point that ` +
        `cannot be read is a straight line across whatever it was, so this refuses ` +
        `to build rather than ship a route with holes in it.`,
    );
  }
  return found;
}

function readWaypoints(xml, renames, where) {
  return checked(xml, "wpt", where).map((p) => {
    // Garmin writes some points with no <name> at all and the label in an
    // extension, which no reader is obliged to look at.
    const name = text(p.body, "name") || text(p.body, "label_text");
    return { name: renames[name] ?? name, desc: text(p.body, "desc"), lat: p.lat, lon: p.lon };
  });
}

function readTracks(xml, where) {
  const blocks = [...xml.matchAll(/<trk>([\s\S]*?)<\/trk>/g)];
  const tracks = blocks.map((t) => ({
    name: text(t[1], "name"),
    pts: readPoints(t[1], "trkpt").map((p) => [p.lat, p.lon, +(text(p.body, "ele") || 0)]),
  }));
  const read = tracks.reduce((n, t) => n + t.pts.length, 0);
  const opened = count(xml, "trkpt");
  if (read !== opened) {
    throw new Error(`${where}: read ${read} of ${opened} <trkpt> elements.`);
  }
  return tracks;
}

/** The index on `line` of the point nearest `p`, and how far away it is. */
function nearest(line, p) {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = haversine(line[i], p);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return { idx: best, dist };
}

const metres = (pts) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
};

/**
 * What a sub-track is, from where its ends sit relative to the spine.
 *
 * Both ends on it and it is an option: the walk leaves the line and comes
 * back, so it can be spliced. One end on it and it is a spur — a hotel walked
 * out to, a taxi drop walked in from — which lengthens a particular
 * traveller's day but is not a variant of it. Neither end and the file is
 * saying something this does not understand, which is reported rather than
 * guessed at.
 *
 * A spur is walked *before* the route when it meets it nearer the start and
 * *after* when it meets it nearer the end, and that is worked out from where
 * it attaches rather than from which way it happens to be drawn. The files
 * are not consistent about that and their names are no help: `6d END Parador`
 * runs from the hotel back to the route and `SANSEbay Hotel start` runs from
 * the route out to the hotel, each the opposite of what it is called. Taking
 * the drawing at face value would have walked day 6 from the Parador to Bera
 * and then to Hondarribia.
 */
function classify(spine, pts) {
  const a = nearest(spine, pts[0]);
  const b = nearest(spine, pts[pts.length - 1]);
  const onA = a.dist <= JOIN_M;
  const onB = b.dist <= JOIN_M;
  if (onA && onB) return { kind: "option", from: a.idx, to: b.idx, a, b };
  if (!onA && !onB) return { kind: "detached", a, b };

  const touch = onA ? a : b;
  const before = touch.idx < spine.length - 1 - touch.idx;
  return {
    kind: before ? "onto" : "off",
    at: touch.idx,
    // Orient it as it is walked: onto the route, its last point is the join;
    // off the route, its first point is.
    pts: onA === before ? [...pts].reverse() : pts,
    a,
    b,
  };
}

/** The spine with an option sewn in where it branches and rejoins. */
const splice = (spine, opt, at) => [
  ...spine.slice(0, at.from),
  ...opt,
  ...spine.slice(at.to),
];

/**
 * Which of a day's lines each waypoint belongs to.
 *
 * Nearest wins, and "about as near to both" means both — which is what a
 * waypoint on the shared stretch of two variants actually is. This replaces a
 * list written by eye, and it has to be comparative rather than a plain
 * radius: waypoint `A` on day 1 is 43 m from the main line, because the two
 * variants run close there, and 0 m from the harder option it belongs to.
 */
function assign(lines, wpts) {
  const out = lines.map(() => []);
  for (const w of wpts) {
    const ds = lines.map((l) => nearest(l.pts, [w.lat, w.lon]).dist);
    const min = Math.min(...ds);
    if (min > NEAR_M) continue;
    ds.forEach((d, i) => {
      if (d - min <= SAME_M) out[i].push(w);
    });
  }
  return out;
}

const trips = JSON.parse(readFileSync(TRIPS, "utf8"));
const renames = trips._renames ?? {};

const files = readdirSync(join(root, "tracks"))
  .filter((f) => f.endsWith(".gpx") && !f.startsWith("paris_"))
  .sort();

const missing = files.filter((f) => !trips[f]);
if (missing.length) {
  throw new Error(
    `tracks/trips.json has no entry for ${missing.join(", ")} — add one, ` +
      `or the app would ship a day with no name.`,
  );
}

const built = [];
const report = [];

for (const file of files) {
  const spec = trips[file];
  const xml = readFileSync(join(root, "tracks", file), "utf8");
  const tracks = readTracks(xml, `tracks/${file}`).filter((t) => t.pts.length > 1);
  if (!tracks.length) throw new Error(`tracks/${file}: no track points`);

  // The spine is the longest thing in the file. In every file either trip has
  // handed over, the day's own route is several times the length of anything
  // else in it, so there is nothing to be ambiguous about.
  const spine = tracks.reduce((a, b) => (metres(b.pts) > metres(a.pts) ? b : a));
  const others = tracks.filter((t) => t !== spine);
  const roles = others.map((t) => ({ track: t, ...classify(spine.pts, t.pts) }));

  // Spurs the traveller actually walks — the hotel they are booked into.
  // Named rather than derived because the file offers several and only one of
  // them is this traveller's day.
  const spurNames = spec.spurs ?? [];
  const spurs = spurNames.map((n) => {
    const r = roles.find((x) => x.track.name === n);
    if (!r) throw new Error(`tracks/${file}: no sub-track named "${n}" to walk as a spur`);
    if (r.kind === "detached") throw new Error(`tracks/${file}: spur "${n}" does not touch the route`);
    return r;
  });
  // Oriented by `classify`, so each one abuts the route it is joined to
  // rather than doubling back from wherever the file happened to start it.
  const before = spurs.filter((s) => s.kind === "onto").flatMap((s) => s.pts);
  const after = spurs.filter((s) => s.kind === "off").flatMap((s) => s.pts);

  const wanted = spec.variants ?? {};
  for (const n of Object.keys(wanted)) {
    const r = roles.find((x) => x.track.name === n);
    if (!r) throw new Error(`tracks/${file}: no sub-track named "${n}" to offer as a variant`);
    if (r.kind !== "option") {
      throw new Error(
        `tracks/${file}: "${n}" is a ${r.kind === "detached" ? "detached track" : "spur"}, not an ` +
          `option — it does not leave the route and rejoin it, so it cannot be a line of its own.`,
      );
    }
  }

  const lines = [
    { id: spec.id, name: spec.name, pts: [...before, ...spine.pts, ...after] },
    ...Object.entries(wanted).map(([n, v]) => {
      const r = roles.find((x) => x.track.name === n);
      return {
        id: v.id,
        name: v.name,
        variantOf: spec.id,
        pts: [...before, ...splice(spine.pts, r.track.pts, r), ...after],
      };
    }),
  ];

  const drop = new Set(spec.drop ?? []);
  const wpts = readWaypoints(xml, renames, `tracks/${file}`).filter((w) => w.name && !drop.has(w.name));
  const mine = assign(lines, wpts);

  lines.forEach((l, i) => {
    built.push({
      id: l.id,
      name: l.name,
      ...(l.variantOf ? { variantOf: l.variantOf } : {}),
      // Simplified and rounded exactly as `parseGPX` does on import, so a file
      // the walker imports themselves and the copy shipped here are the same
      // line rather than two that disagree by centimetres.
      pts: simplify(l.pts, 3).map((p) => [+p[0].toFixed(6), +p[1].toFixed(6), Math.round(p[2])]),
      wpts: mine[i],
    });
  });

  // The largest step between two raw points of the composed line, before
  // simplify thins the straight stretches. A spur joined at the wrong end, or
  // an option spliced at the wrong point, shows up here as a line drawn
  // across country — the fault this whole script exists to prevent, and a
  // silent one on a map. A real gap is not always a fault: day 3 rides the
  // Fuente Dé cable car and jumps 1187 m because nobody walked that.
  const gaps = lines.map((l) => {
    let max = 0;
    let at = 0;
    let run = 0;
    for (let i = 1; i < l.pts.length; i++) {
      const d = haversine(l.pts[i - 1], l.pts[i]);
      run += d;
      if (d > max) {
        max = d;
        at = run;
      }
    }
    return { name: l.name, max, at };
  });

  report.push({
    file,
    spine: spine.name,
    roles,
    gaps,
    used: new Set([...spurNames, ...Object.keys(wanted)]),
  });
}

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
    console.log(
      `${(metres(h.pts) / 1000).toFixed(2).padStart(6)} km  ${String(h.pts.length).padStart(4)} pts  ` +
        `${String(h.wpts.length).padStart(2)} wpts  ${h.name}`,
    );
  }
  const jumps = report.flatMap((r) => r.gaps).filter((g) => g.max > GAP_M);
  if (jumps.length) {
    console.log(`\nsteps over ${GAP_M} m between two points — drawn on the map as a straight line:`);
    for (const g of jumps) {
      console.log(
        `  ${g.name.padEnd(54)} ${String(Math.round(g.max)).padStart(5)} m at ${(g.at / 1000).toFixed(2)} km`,
      );
    }
  }

  // Everything in the files that is not shipped, so a route nobody offered is
  // visible rather than silently missing.
  for (const r of report) {
    const spare = r.roles.filter((x) => !r.used.has(x.track.name));
    if (!spare.length) continue;
    console.log(`\n${r.file} — in the file, not offered:`);
    for (const s of spare) {
      const where =
        s.kind === "option"
          ? `option, rejoins after ${(metres(s.track.pts) / 1000).toFixed(2)} km`
          : s.kind === "detached"
            ? `detached (${Math.round(Math.min(s.a.dist, s.b.dist))} m from the route at its nearest)`
            : `${(metres(s.track.pts) / 1000).toFixed(2)} km spur, walked ${s.kind === "onto" ? "before the route" : "after the route"}`;
      console.log(`  ${s.track.name.padEnd(36)} ${where}`);
    }
  }
}
