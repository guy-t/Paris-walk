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
import { fillElevations, simplify, haversine } from "../packages/core/dist/index.js";

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
    // A missing <ele> is null, not 0: the same `|| 0` that hid the self-closing
    // tags above then reported the six elevation-less points at the start of
    // day 4 of the Picos as sea level, and the day as climbing 1469 m when it
    // climbs 371 m. `fillElevations` interpolates them along the line.
    pts: fillElevations(
      readPoints(t[1], "trkpt").map((p) => {
        const ele = text(p.body, "ele");
        return [p.lat, p.lon, ele === "" ? null : +ele];
      }),
    ),
    noEle: readPoints(t[1], "trkpt").filter((p) => text(p.body, "ele") === "").length,
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
 * The spine, leaving it for a connector and crossing onto an option part-way.
 *
 * Day 3's via ferrata is the ridge's last stretch before Pasaia, and the file
 * carries the way round it as two pieces: a 0.43 km path from the ridge at
 * waypoint [7] down to [B], and the easier route, which it meets there and
 * which rejoins the ridge at [8]. Neither piece alone is a line — the path is
 * a spur on the spine and the easier route is an option that leaves it much
 * earlier — so a walker who takes the ridge and drops off before the via
 * ferrata had no line to follow. This is the ridge as far as the connector,
 * the connector, the option from wherever the connector meets it, and the
 * spine again from where the option rejoins.
 */
function crossover(spine, connector, option, where) {
  const c = classify(spine, connector.pts);
  if (c.kind === "option" || c.kind === "detached") {
    throw new Error(`${where}: "${connector.name}" must touch the route at one end only to leave it`);
  }
  const o = classify(spine, option.pts);
  if (o.kind !== "option") throw new Error(`${where}: "${option.name}" does not rejoin the route`);
  // Walked away from the spine, however the file drew it.
  const away = c.a.dist <= JOIN_M ? connector.pts : [...connector.pts].reverse();
  const opt = o.from <= o.to ? option.pts : [...option.pts].reverse();
  const join = nearest(opt, away[away.length - 1]);
  if (join.dist > JOIN_M) {
    throw new Error(`${where}: "${connector.name}" ends ${Math.round(join.dist)} m from "${option.name}"`);
  }
  const leave = c.at;
  const rejoin = Math.max(o.from, o.to);
  if (rejoin <= leave) throw new Error(`${where}: "${option.name}" rejoins before "${connector.name}" leaves`);
  return [...spine.slice(0, leave + 1), ...away, ...opt.slice(join.idx), ...spine.slice(rejoin + 1)];
}

/**
 * A line cut to the stretch between two waypoints, either end optional.
 *
 * A day can be two walks: the ridge to the Pasaia ferry, a crossing nobody
 * walks, and the coast path into San Sebastián — which a walker may do on a
 * bus instead. Walking it as one line counts the boat as distance and puts
 * the second half's ETA on top of the first. So a leg is the day's composed
 * line cut at the waypoint nearest each end, and it is its own day in the
 * library: its own session, its own notes, its own finish.
 */
function clip(pts, wpts, from, to, where) {
  const at = (name) => {
    const w = wpts.find((x) => x.name === name);
    if (!w) throw new Error(`${where}: no waypoint "${name}" to cut the line at`);
    const n = nearest(pts, [w.lat, w.lon]);
    if (n.dist > JOIN_M * 4) throw new Error(`${where}: waypoint "${name}" is ${Math.round(n.dist)} m off the line`);
    return n.idx;
  };
  const a = from == null ? 0 : at(from);
  const b = to == null ? pts.length - 1 : at(to);
  if (b <= a) throw new Error(`${where}: "${to}" comes before "${from}" on the line`);
  return pts.slice(a, b + 1);
}

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

  /**
   * A day that ends early somewhere else.
   *
   * Not a variant of the walk but a truncation of it: the escape route off
   * day 2 leaves the line at waypoint [5] and finishes in Biriatou, two
   * kilometres down and a taxi from there. So the line is the spine as far as
   * the spur, then the spur — and it ends where the walker actually stops,
   * which is what makes the distance, the climb and the ETA mean anything.
   */
  const endings = spec.endings ?? {};
  for (const n of Object.keys(endings)) {
    const r = roles.find((x) => x.track.name === n);
    if (!r) throw new Error(`tracks/${file}: no sub-track named "${n}" to finish on`);
    if (r.kind === "option" || r.kind === "detached") {
      throw new Error(
        `tracks/${file}: "${n}" is ${r.kind === "option" ? "an option that rejoins the route" : "detached"}, ` +
          `not a way off it, so it cannot be an early finish.`,
      );
    }
  }

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
    ...Object.entries(endings).map(([n, v]) => {
      const r = roles.find((x) => x.track.name === n);
      // Oriented by which *end* touches the route, not by what `classify`
      // called it: an early finish leaves the line and keeps going, so the
      // on-route end comes first however the file drew it. `classify` decides
      // before-or-after from where along the spine a spur attaches, which is
      // the right question for a hotel and the wrong one here — the escape
      // route leaves at 8 km of 20, so it read as a spur walked *before* the
      // day and came out reversed, ending back at waypoint [5] with a 1681 m
      // line drawn across country to get there.
      const away = r.a.dist <= JOIN_M ? r.track.pts : [...r.track.pts].reverse();
      // No `after` spur either: the walk does not reach the hotel this day.
      return {
        id: v.id,
        name: v.name,
        variantOf: spec.id,
        pts: [...before, ...spine.pts.slice(0, r.at + 1), ...away],
      };
    }),
  ];

  const drop = new Set(spec.drop ?? []);
  const allWpts = readWaypoints(xml, renames, `tracks/${file}`).filter((w) => w.name);
  const wpts = allWpts.filter((w) => !drop.has(w.name));

  // Legs: the day cut into walks of their own, each with its own options. A
  // leg's main line is the day's main line cut to it; an option that crosses
  // over is composed on the whole day first and cut the same way, so both
  // end at the same pontoon rather than wherever each happened to stop.
  const byName = (n) => {
    const t = others.find((x) => x.name === n);
    if (!t) throw new Error(`tracks/${file}: no sub-track named "${n}"`);
    return t;
  };
  const whole = lines[0].pts;
  for (const leg of spec.legs ?? []) {
    const where = `tracks/${file} leg ${leg.id}`;
    lines.push({ id: leg.id, name: leg.name, pts: clip(whole, allWpts, leg.from, leg.to, where) });
    for (const v of leg.variants ?? []) {
      const crossed = [...before, ...crossover(spine.pts, byName(v.leave), byName(v.join), where), ...after];
      lines.push({ id: v.id, name: v.name, variantOf: leg.id, pts: clip(crossed, allWpts, leg.from, leg.to, where) });
    }
  }

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
    noEle: tracks.reduce((n, t) => n + t.noEle, 0),
    used: new Set([
      ...spurNames,
      ...Object.keys(wanted),
      ...Object.keys(endings),
      ...(spec.legs ?? []).flatMap((l) => (l.variants ?? []).flatMap((v) => [v.leave, v.join])),
    ]),
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

  // Points that stated no elevation. Interpolated, not invented — but worth
  // saying out loud, because a file that is mostly missing them has a profile
  // worth doubting and every climb figure and ETA is read off that profile.
  const noEle = report.filter((r) => r.noEle > 0);
  if (noEle.length) {
    console.log("\npoints with no <ele>, interpolated from the readings either side:");
    for (const r of noEle) console.log(`  ${r.file.padEnd(46)} ${String(r.noEle).padStart(4)}`);
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
