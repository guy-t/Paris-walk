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
  onImport: () => void;
  onForget: () => void;
}

export function NotesPanel({
  notes,
  steps,
  progress,
  currentIndex,
  fmt,
  onImport,
  onForget,
}: NotesPanelProps) {
  const currentRef = useRef<HTMLDivElement>(null);

  // Follow the walk: when the current step changes, bring it into view
  // rather than making someone scroll to find where they are.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  if (!notes) {
    return (
      <div className="sheet-empty">
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

  return (
    <div className="notes">
      {steps.map((s, i) => {
        const ahead = s.prog == null ? null : s.prog - progress;
        const current = i === currentIndex;
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
