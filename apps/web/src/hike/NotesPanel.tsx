/**
 * The route notes tab: the walking company's own instructions, in order,
 * with the one you are walking now held at the top.
 *
 * Read on the move, one-handed, sometimes at a junction in the rain. So the
 * current step is large and first, what is coming is next, and everything
 * else is there to scroll back to when a turn was missed.
 */

import type { Formatter } from "@slownav/core";
import type { PlacedStep } from "@slownav/core";
import { useEffect, useRef } from "react";
import type { StoredNotes } from "./notes.js";

export interface NotesPanelProps {
  notes: StoredNotes | null;
  steps: PlacedStep[];
  progress: number;
  /** The step the walker is in, if any — rendered large at the top. */
  currentIndex: number;
  fmt: Formatter;
  /** Which variant the walker is on, and how to change it. */
  variant: string;
  onVariant: (id: string) => void;
  /**
   * The day's lines, and which one is open.
   *
   * These come from the library rather than from the notes' own headings,
   * which is a correction. The pills used to be built from the `## ` lines in
   * the imported file and matched to a line *by position*, so they appeared
   * only once notes had been imported and only worked when the booklet listed
   * exactly the variants the library holds, in the same order. The Basque
   * day 3 booklet lists six walking options against two lines, and before its
   * notes are typed up there are none at all — leaving the choice four taps
   * away in the library, at a signpost.
   */
  lines?: readonly { id: string; name: string }[];
  onLine?: (id: string) => void;
  currentLine?: string | null;
  onImport: () => void;
  onForget: () => void;
}

/**
 * A line's name with the day stripped off, because the pills sit under a
 * header already saying which day it is. "Day 3 Hondarribia to San Sebastián
 * (easier, off the ridge)" becomes "easier, off the ridge", and a main line
 * with nothing in brackets becomes "Main route".
 */
function shortName(name: string): string {
  const m = /\(([^)]+)\)\s*$/.exec(name);
  return m ? m[1]! : "Main route";
}

export function NotesPanel({
  notes,
  steps,
  progress,
  currentIndex,
  fmt,
  variant,
  onVariant,
  lines,
  onLine,
  currentLine,
  onImport,
  onForget,
}: NotesPanelProps) {
  const currentRef = useRef<HTMLDivElement>(null);

  /**
   * Which line of the day, above everything else in the tab.
   *
   * Shown whenever the day has more than one, notes or no notes: the line is
   * what the map draws, what the distance counts down and what the ETA is
   * for, so it is worth changing even on a day whose instructions have not
   * been typed up.
   */
  const chooser =
    lines && lines.length > 1 && onLine ? (
      <div className="variants" role="group" aria-label="Which route are you walking?">
        {lines.map((l) => (
          <button
            key={l.id}
            className={l.id === currentLine ? "on" : ""}
            aria-pressed={l.id === currentLine}
            onClick={() => onLine(l.id)}
          >
            {shortName(l.name)}
          </button>
        ))}
      </div>
    ) : null;

  // Follow the walk: when the current step changes, bring it into view
  // rather than making someone scroll to find where they are.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  if (!notes) {
    return (
      <div className="sheet-empty">
        {chooser}
        <p>
          No route notes for this hike yet. Import the day’s instructions and they will be
          placed along the line, so the app can tell you which one you are on.
        </p>
        <button className="primary" onClick={onImport}>
          Import notes for this hike
        </button>
        <p className="hint" style={{ marginTop: 10 }}>
          A plain text file: one instruction per paragraph, each starting with its time and
          distance — <code>0:27 2.1km Turn R onto the walkway…</code> — and any waypoint in
          square brackets, as the printed notes have them.
        </p>
      </div>
    );
  }

  const shown = steps.filter((s) => s.variant === variant);

  return (
    <div className="notes">
      {chooser}
      {/* The notes' own variants, where a booklet prints more of them than the
          library has lines — the text can still be switched when the geometry
          cannot. Hidden when the chooser above already covers the same
          ground, so a day does not show two rows of pills saying one thing. */}
      {notes.variants.length > 1 && notes.variants.length !== (lines?.length ?? 0) && (
        <div className="variants" role="group" aria-label="Which instructions are you following?">
          {notes.variants.map((v) => (
            <button
              key={v.id}
              className={v.id === variant ? "on" : ""}
              aria-pressed={v.id === variant}
              onClick={() => onVariant(v.id)}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}
      {shown.map((s, i) => {
        const ahead = s.prog == null ? null : s.prog - progress;
        const current = steps.indexOf(s) === currentIndex;
        return (
          <div
            key={`${s.variant}-${i}`}
            className={`note-step${current ? " current" : ""}${s.prog == null ? " unplaced" : ""}`}
            {...(current ? { ref: currentRef } : {})}
          >
            <div className="note-head">
              <span className="note-where">
                {s.ref ? <strong className="note-ref">{s.ref}</strong> : null}
                {s.prog == null
                  ? "not on this line"
                  : ahead! >= 0
                    ? `in ${fmt.dist(ahead!)}`
                    : `${fmt.dist(-ahead!)} back`}
                {/* Said plainly: an interpolated step is somewhere about
                    here, and a walker deciding whether to turn deserves to
                    know which kind of number they are reading. */}
                {s.exact ? "" : " · about"}
              </span>
              {s.time != null && (
                <span className="note-time">
                  {Math.floor(s.time / 3600)}:{String(Math.round((s.time % 3600) / 60)).padStart(2, "0")}
                </span>
              )}
            </div>
            <div className="note-text">{s.text}</div>
            {s.notes.map((n, j) => (
              <div key={j} className={`note-aside${n.warning ? " warn" : ""}`}>
                {n.text}
              </div>
            ))}
          </div>
        );
      })}
      <div className="notes-foot">
        <span>
          {notes.name}
          {notes.summary ? ` · ${notes.summary}` : ""}
        </span>
        <span>
          <button onClick={onImport}>Replace</button>{" "}
          <button onClick={onForget}>Forget</button>
        </span>
      </div>
    </div>
  );
}
