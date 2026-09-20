/**
 * The bottom sheet all three apps use for "what is around me".
 *
 * Collapsed to a header by default: on a phone the map matters more than the
 * list, and a sheet that opens itself covers the thing the walker is looking
 * at. Tapping the header toggles it.
 */

import type { ReactNode } from "react";

export interface SheetTab {
  id: string;
  label: string;
}

export interface SheetProps {
  title: string;
  /** Shown next to the title — usually how many items are in the current tab. */
  count?: number | string;
  open: boolean;
  onToggle: (open: boolean) => void;
  tabs?: readonly SheetTab[];
  activeTab?: string;
  onTab?: (id: string) => void;
  children: ReactNode;
  className?: string;
}

export function Sheet({
  title,
  count,
  open,
  onToggle,
  tabs,
  activeTab,
  onTab,
  children,
  className,
}: SheetProps) {
  return (
    <section className={`sheet ${open ? "open" : ""} ${className ?? ""}`}>
      <header
        className="sheet-head"
        onClick={() => onToggle(!open)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(!open);
          }
        }}
      >
        <span className="grip" />
        <h2>{title}</h2>
        {count != null && <span className="count">{count}</span>}
        <span className="chev" aria-hidden>
          {open ? "▼" : "▲"}
        </span>
        <button
          className="close"
          aria-label="Close"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(false);
          }}
        >
          ✕
        </button>
      </header>

      {tabs && tabs.length > 0 && (
        <nav className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={t.id === activeTab ? "on" : ""}
              onClick={() => onTab?.(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <div className="sheet-body">{children}</div>
    </section>
  );
}

export interface PoiCardProps {
  name: string;
  kind: string;
  /** "in 400 m", "back 1.2 km · 80 m off the track". */
  distance: string;
  /** True once the walker is past it, which greys it out. */
  passed?: boolean;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

/** One entry in a sheet: a header line that expands to show detail. */
export function PoiCard({
  name,
  kind,
  distance,
  passed,
  open,
  onToggle,
  children,
}: PoiCardProps) {
  return (
    <article className={`poi ${passed ? "passed" : ""} ${open ? "open" : ""}`}>
      <header className="poi-head" onClick={onToggle}>
        <span className="name">{name}</span>
        <span className="kind">{kind}</span>
        <span className="dist">{distance}</span>
        <span className="caret" aria-hidden>
          ▼
        </span>
      </header>
      {open && <div className="poi-body">{children}</div>}
    </article>
  );
}
