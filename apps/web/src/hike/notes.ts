/**
 * Route notes, on the phone and nowhere else.
 *
 * These are the walking company's own words — a personal copy of a
 * copyrighted document, with the walker's host's phone number in it. They
 * are imported from a file, kept in this device's storage, and never
 * committed, uploaded or sent anywhere. Nothing in the repository contains a
 * line of them; the parser is tested against notes written for the purpose.
 */

import {
  parseNotes,
  placeSteps,
  projectAll,
  store,
  type NoteAnchor,
  type PlacedStep,
  type ProcessedTrack,
  type RouteNotes,
  type Waypoint,
} from "@slownav/core";

export interface StoredNotes extends RouteNotes {
  importedAt: number;
}

const key = (hikeId: string) => `hike:notes:${hikeId}`;

export function loadNotes(hikeId: string): StoredNotes | null {
  const n = store.get<StoredNotes>(key(hikeId));
  return n && Array.isArray(n.steps) && n.steps.length ? n : null;
}

/** Returns false when the notes could not be saved, which is never silent. */
export function saveNotes(hikeId: string, notes: RouteNotes): boolean {
  return store.set(key(hikeId), { ...notes, importedAt: Date.now() } satisfies StoredNotes);
}

export function clearNotes(hikeId: string): void {
  store.del(key(hikeId));
  store.del(variantKey(hikeId));
}

const variantKey = (hikeId: string) => `hike:variant:${hikeId}`;

/**
 * Which line of the walk the walker took.
 *
 * A day's notes can offer a choice — a track-based main route and a harder
 * one on narrow paths, separate for several kilometres before rejoining.
 * Both are placed, but only the walker knows which they are on, and until
 * they say, the app reads instructions from the wrong line.
 */
export function loadVariant(hikeId: string, notes: StoredNotes | null): string {
  const stored = store.get<string>(variantKey(hikeId));
  const known = notes?.variants.map((v) => v.id) ?? [];
  if (stored && known.includes(stored)) return stored;
  return known[0] ?? "main";
}

export function saveVariant(hikeId: string, variant: string): void {
  store.set(variantKey(hikeId), variant);
}

export interface ImportResult {
  ok: boolean;
  /** Something to show the walker either way. */
  message: string;
  notes: StoredNotes | null;
}

/**
 * Import notes for a hike from a file's text.
 *
 * Deliberately says how many steps it found: notes that parsed into two
 * steps have been typed in a format this does not read, and the walker needs
 * to know that now rather than at a junction.
 */
export function importNotes(hikeId: string, text: string): ImportResult {
  let parsed: RouteNotes;
  try {
    parsed = parseNotes(text);
  } catch {
    return { ok: false, message: "That file could not be read as route notes.", notes: null };
  }
  if (!parsed.steps.length) {
    return {
      ok: false,
      message: "No instructions found. Each one starts with a time and a distance, like “0:27 2.1km”.",
      notes: null,
    };
  }
  if (!saveNotes(hikeId, parsed)) {
    return { ok: false, message: "Parsed, but could not be saved — storage is full.", notes: null };
  }
  const n = parsed.steps.length;
  return {
    ok: true,
    message: `Imported ${n} instruction${n === 1 ? "" : "s"}${parsed.name ? ` for ${parsed.name}` : ""}`,
    notes: loadNotes(hikeId),
  };
}

/**
 * Put the notes on the line.
 *
 * Each waypoint offers *every* place it could be, not just the nearest one.
 * On a track that doubles back — and the file for day 1 holds both variants
 * end to end — the nearest is a coin toss decided by a few metres, and it
 * picked the wrong pass for the monastery by eleven kilometres. Handing the
 * alternatives to `placeSteps` lets the anchor that agrees with the rest of
 * the day win, instead of the one that happened to be closest.
 */
export function placeNotes(
  notes: StoredNotes | null,
  track: ProcessedTrack | null,
  wpts: readonly Waypoint[],
): PlacedStep[] {
  if (!notes || !track) return [];
  const anchors: NoteAnchor[] = [];
  for (const w of wpts) {
    if (!w.name) continue;
    for (const hit of projectAll(track.pts, track.cum, [w.lat, w.lon], { maxDist: 150 })) {
      anchors.push({ name: w.name, prog: hit.prog });
    }
  }
  return placeSteps(notes.steps, anchors, track.length);
}
