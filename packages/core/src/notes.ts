/**
 * Turn-by-turn route notes, placed on the line.
 *
 * Walking companies write route notes as numbered paragraphs down the left
 * margin: a cumulative time, a cumulative distance, and an instruction that
 * sometimes carries a bracketed waypoint — "[1] Cross the road again, then
 * bear L uphill". The same waypoint names appear in the GPX they hand out,
 * which is the whole trick: the notes and the track already share a key, so
 * linking them is a join rather than a guess.
 *
 * Two anchors, therefore, and they cover each other:
 *
 *   - A step that names a waypoint is placed exactly where that waypoint
 *     projects onto the track.
 *   - Every other step is interpolated between its neighbouring anchors,
 *     which rescales the guidebook's distances onto the measured ones. A
 *     printed "5.0km" and the GPX's own metres differ by a few percent, and
 *     the difference is not constant along the walk.
 *
 * Nothing here fetches, stores or renders. The notes are somebody's personal
 * copy of a copyrighted document: they belong on the walker's phone and
 * nowhere else, so this file only ever sees text it is handed.
 */

/** Which line of the walk a step belongs to. */
export interface NoteVariant {
  id: string;
  name: string;
}

export interface NoteStep {
  /** Cumulative walking time from the start, seconds. */
  time: number | null;
  /** Cumulative distance from the start as printed, metres. */
  noteM: number | null;
  /** The bracketed waypoint this step starts at, if it has one. */
  ref: string | null;
  /** The instruction itself. */
  text: string;
  /** Asides: background, warnings, the aside about the friendly dogs. */
  notes: Array<{ text: string; warning: boolean }>;
  /** Which variant this step belongs to. */
  variant: string;
}

export interface RouteNotes {
  /** The hike these notes are for, as written at the top. */
  name: string;
  /** The summary line under it, if any. */
  summary: string;
  variants: NoteVariant[];
  steps: NoteStep[];
}

const STEP = /^(\d{1,2}):(\d{2})\s+([0-9][0-9.,]*\s*(?:km|m|M|KM|Km))\s+(.*)$/;
/** A step whose distance is printed but whose time is not, and vice versa. */
const STEP_DIST_ONLY = /^([0-9][0-9.,]*\s*(?:km|m|M|KM|Km))\s+(.*)$/;
const REF = /^\[([^\]]{1,40})\]\s*/;

/**
 * Parse a printed distance into metres.
 *
 * Scans of these notes routinely read "400m" as "400km", and a walk is not
 * four hundred kilometres. Anything absurd comes back null rather than
 * wrong, and an unplaced step is still a readable one.
 */
export function parseDistance(text: string): number | null {
  const m = /^([0-9][0-9.,]*)\s*(km|m)$/i.exec(text.trim());
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const metres = m[2]!.toLowerCase() === "km" ? value * 1000 : value;
  return metres >= 0 && metres <= 200_000 ? metres : null;
}

/**
 * Read a notes file.
 *
 * The format is the printed page, typed out: `# name`, an optional `> `
 * summary, `## ` for each variant, and one step per paragraph beginning with
 * its time and distance. Lines that do not begin a step continue the one
 * before, and an indented line is an aside rather than an instruction — the
 * same shape the page has, so transcribing is copying rather than encoding.
 */
export function parseNotes(text: string): RouteNotes {
  const out: RouteNotes = { name: "", summary: "", variants: [], steps: [] };
  let variant = "main";
  let current: NoteStep | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (line.startsWith("# ")) {
      out.name = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("> ")) {
      out.summary = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("## ")) {
      const name = line.slice(3).trim();
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "main";
      if (!out.variants.some((v) => v.id === id)) out.variants.push({ id, name });
      variant = id;
      current = null;
      continue;
    }

    const indented = /^\s{2,}/.test(rawLine);
    const body = line.trim();

    const step = STEP.exec(body);
    const distOnly = step ? null : STEP_DIST_ONLY.exec(body);
    if (step || distOnly) {
      const time = step ? Number(step[1]) * 3600 + Number(step[2]) * 60 : null;
      const noteM = parseDistance((step ? step[3] : distOnly![1])!);
      let rest = (step ? step[4] : distOnly![2])!.trim();
      let ref: string | null = null;
      const r = REF.exec(rest);
      if (r) {
        ref = r[1]!.trim();
        rest = rest.slice(r[0].length);
      } else {
        // A step can also name its waypoint mid-sentence — "For the [Hotel
        // del Oso], turn R over the footbridge" — and these notes bracket
        // the accommodation exactly as they bracket a numbered turn. Only
        // when there is precisely one, so a paragraph mentioning two places
        // is never anchored to whichever came first.
        const all = rest.match(/\[([^\]]{1,40})\]/g);
        if (all?.length === 1) {
          ref = all[0]!.slice(1, -1).trim();
          // The brackets have done their job; the name still reads as part
          // of the sentence, and the app shows it as a label anyway.
          rest = rest.replace(all[0]!, ref);
        }
      }
      const made: NoteStep = { time, noteM, ref, text: rest, notes: [], variant };
      out.steps.push(made);
      current = made;
      continue;
    }

    if (!current) continue; // preamble before the first step

    // An indented line, or one marked with "!", is an aside rather than more
    // of the instruction. Warnings are marked so the app can shout.
    const warning = /^!/.test(body) || /^(careful|be aware|note:?\s*careful)\b/i.test(body);
    if (indented || warning) {
      current.notes.push({ text: body.replace(/^!\s*/, ""), warning });
    } else {
      current.text = `${current.text} ${body}`.trim();
    }
  }

  if (!out.variants.length && out.steps.length) out.variants.push({ id: "main", name: "Route" });
  return out;
}

/** A waypoint on the track, as the app already knows it. */
export interface NoteAnchor {
  name: string;
  /** Distance along the track, metres. */
  prog: number;
}

/** A step with somewhere on the line to be. */
export interface PlacedStep extends NoteStep {
  /** Distance along the track, metres — null when it could not be placed. */
  prog: number | null;
  /** True when a named waypoint put it here, rather than interpolation. */
  exact: boolean;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Place every step on the track.
 *
 * Each variant is placed from its own anchors, because a GPX handed out
 * with these notes is not always one clean line: the day-1 file for Potes
 * to Cosgaya is 34.6 km for a 14.5 km walk, holding the harder option and
 * the main route end to end in one track. Assuming the notes start where
 * the track starts put the second instruction eleven kilometres out.
 *
 * So: anchors first, and the printed distances are fitted to them.
 *
 *   - Two or more anchors in a variant: interpolate between them, and
 *     extrapolate past the ends at the scale of the nearest stretch. That
 *     rescales a guidebook's kilometres onto measured ones and finds a
 *     variant sitting anywhere along the file.
 *   - Exactly one: offset from it at face value, which is within a few
 *     percent over the length of a day.
 *   - None at all, in the first variant: fall back to stretching the notes
 *     across the whole track, which is right for a plain GPX whose
 *     waypoints are unnamed. A later variant with no anchors is left
 *     unplaced rather than drawn onto a line it does not walk.
 */
export function placeSteps(
  steps: readonly NoteStep[],
  anchors: readonly NoteAnchor[],
  trackLength: number,
): PlacedStep[] {
  const byName = new Map(anchors.map((a) => [key(a.name), a.prog]));
  const exactFor = (s: NoteStep): number | undefined =>
    s.ref == null ? undefined : byName.get(key(s.ref));

  const firstVariant = steps[0]?.variant;
  const variants = [...new Set(steps.map((s) => s.variant))];
  const place = new Map<NoteStep, number | null>();

  for (const variant of variants) {
    const mine = steps.filter((s) => s.variant === variant);

    // Anchor pairs in note order, monotonic in both measures: a mistyped
    // reference must cost one step, not drag the rest of the day with it.
    const pairs: Array<{ noteM: number; prog: number }> = [];
    for (const s of mine) {
      const prog = exactFor(s);
      if (prog == null || s.noteM == null) continue;
      const last = pairs.at(-1);
      if (last && (prog <= last.prog || s.noteM <= last.noteM)) continue;
      pairs.push({ noteM: s.noteM, prog });
    }

    if (!pairs.length && variant === firstVariant) {
      const lastNote = Math.max(0, ...mine.map((s) => s.noteM ?? 0));
      if (lastNote > 0) {
        pairs.push({ noteM: 0, prog: 0 }, { noteM: lastNote, prog: trackLength });
      }
    }

    const clamp = (v: number) => Math.max(0, Math.min(trackLength, v));
    const fit = (noteM: number): number | null => {
      if (!pairs.length) return null;
      if (pairs.length === 1) return clamp(pairs[0]!.prog + (noteM - pairs[0]!.noteM));
      // The stretch this distance falls in, or the nearest one to
      // extrapolate along.
      let i = pairs.findIndex((p) => p.noteM >= noteM);
      if (i === -1) i = pairs.length - 1;
      const hi = pairs[Math.max(1, i)]!;
      const lo = pairs[Math.max(1, i) - 1]!;
      const span = hi.noteM - lo.noteM;
      const scale = span > 0 ? (hi.prog - lo.prog) / span : 1;
      return clamp(lo.prog + (noteM - lo.noteM) * scale);
    };

    for (const s of mine) {
      const exact = exactFor(s);
      place.set(s, exact ?? (s.noteM == null ? null : fit(s.noteM)));
    }
  }

  return steps.map((s) => ({
    ...s,
    prog: place.get(s) ?? null,
    exact: exactFor(s) != null,
  }));
}

/** The step the walker is in, and the one after it. */
export function stepAt(
  steps: readonly PlacedStep[],
  progress: number,
): { current: PlacedStep | null; next: PlacedStep | null } {
  const placed = steps.filter((s): s is PlacedStep & { prog: number } => s.prog != null);
  let current: PlacedStep | null = null;
  let next: PlacedStep | null = null;
  for (const s of placed) {
    if (s.prog <= progress + 1) current = s;
    else {
      next = s;
      break;
    }
  }
  return { current, next };
}
