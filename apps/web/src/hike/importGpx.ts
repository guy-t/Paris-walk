/**
 * Importing GPX, however it arrived.
 *
 * There are two doors into the library now — the file picker, and a route
 * opened or shared from elsewhere on the phone — and they must not drift
 * apart: the same parsing, the same naming, the same thing said afterwards.
 * So both hand text to this, and neither knows how the other got it.
 */

import { parseGPX, repairElevation } from "@slownav/core";
import { library } from "./model.js";

/** A file to import: its name, and what was in it. */
export interface IncomingFile {
  name: string;
  text: string;
}

export interface ImportResult {
  imported: number;
  /** One line per file that could not be imported, ready to show. */
  failures: string[];
  /** The name of the last hike imported, for the single-file case. */
  lastName: string;
  /** Library id of the last hike imported, so the caller can open it. */
  lastId: string;
}

/** Parse and store every file, never throwing: a bad file is a result. */
export function importGpxFiles(files: readonly IncomingFile[]): ImportResult {
  const result: ImportResult = { imported: 0, failures: [], lastName: "", lastId: "" };

  for (const file of files) {
    try {
      const parsed = parseGPX(file.text, file.name.replace(/\.gpx$/i, ""));
      const id = library.idFor(file.name, parsed.pts.length);
      library.add({
        id,
        name: parsed.name,
        pts: repairElevation(parsed.pts),
        wpts: parsed.wpts,
      });
      result.imported++;
      result.lastName = parsed.name;
      result.lastId = id;
    } catch (err) {
      result.failures.push(
        `${file.name}: ${err instanceof Error ? err.message : "could not be read"}`,
      );
    }
  }
  return result;
}

/**
 * One line describing a whole batch.
 *
 * A toast per file means only the last is ever read, and importing five
 * routes to be told about one of them says nothing about the other four.
 */
export function importMessage(r: ImportResult): string {
  if (r.imported && !r.failures.length) {
    return r.imported === 1 ? `Imported ${r.lastName}` : `Imported ${r.imported} hikes`;
  }
  if (r.imported) {
    return `Imported ${r.imported}, skipped ${r.failures.length} — ${r.failures[0]}`;
  }
  return r.failures[0] ?? "Nothing to import";
}
