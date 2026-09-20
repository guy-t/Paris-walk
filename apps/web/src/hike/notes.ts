/**
 * Route notes, on the phone and nowhere else.
 *
 * These are the walking company's own words — a personal copy of a
 * copyrighted document, with the walker's host's phone number in it. They
 * are imported from a file, kept in this device's storage, and never
 * committed, uploaded or sent anywhere. Nothing in the repository contains a
 * line of them; the parser is tested against notes written for the purpose.
 */

import { parseNotes, placeSteps, store, type RouteNotes, type PlacedStep } from "@slownav/core";
import type { WaypointAt } from "./model.js";

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

/** Put the notes on the line, using the waypoints the app has already placed. */
export function placeNotes(
  notes: StoredNotes | null,
  waypoints: readonly WaypointAt[],
  trackLength: number,
): PlacedStep[] {
  if (!notes) return [];
  return placeSteps(
    notes.steps,
    waypoints.map((w) => ({ name: w.name, prog: w.prog })),
    trackLength,
  );
}
