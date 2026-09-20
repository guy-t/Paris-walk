/**
 * "What is around me" — the bottom sheet.
 *
 * Five tabs, because what a walker wants to know changes with the situation:
 * water and shelter when it is going wrong, sights when it is going well,
 * food when arriving somewhere. "Nearby" sorts by straight-line distance
 * because that is what matters when you are standing still; "Ahead" sorts by
 * distance along the track because that is what matters when you are moving.
 */

import { PoiCard, Sheet, type SheetTab } from "@slownav/ui";
import { haversine, type Formatter, type LatLon } from "@slownav/core";
import { useMemo, useState } from "react";
import type { Sight, SightGroup } from "./sights.js";
import type { SightsStatus } from "./useHike.js";
import { WeatherPanel, type WeatherPanelProps } from "./WeatherPanel.js";
import { NotesPanel, type NotesPanelProps } from "./NotesPanel.js";

export type NearbyTab = "nearby" | "ahead" | "notes" | "weather" | "water" | "sights" | "food";

const TABS: SheetTab[] = [
  { id: "nearby", label: "Nearby" },
  { id: "ahead", label: "Ahead" },
  { id: "notes", label: "Route notes" },
  { id: "weather", label: "Weather" },
  { id: "water", label: "Water & shelter" },
  { id: "sights", label: "Sights" },
  { id: "food", label: "Food & services" },
];

const GROUP_TITLES: Record<SightGroup, string> = {
  water: "Water",
  hut: "Shelter",
  peak: "Peaks & cols",
  sight: "Sights",
  place: "Places",
  food: "Food & drink",
  shop: "Shops",
  service: "Services",
};

/** Which tab a sight belongs to when opened from a map marker. */
export function tabForSight(s: Sight): NearbyTab {
  if (s.group === "water" || s.group === "hut") return "water";
  if (s.group === "food" || s.group === "shop" || s.group === "service") return "food";
  return "sights";
}

export interface NearbySheetProps {
  sights: Sight[] | null;
  status: SightsStatus;
  progress: number;
  position: LatLon | null;
  fmt: Formatter;
  open: boolean;
  onToggle: (open: boolean) => void;
  tab: NearbyTab;
  onTab: (t: NearbyTab) => void;
  onShowOnMap: (s: Sight) => void;
  /** Sights to render expanded — used when one is opened from the map. */
  expandedIds: ReadonlySet<string>;
  onExpand: (id: string) => void;
  /** Everything the weather tab shows. */
  weather: WeatherPanelProps;
  /** Everything the route notes tab shows. */
  notes: NotesPanelProps;
}

export function NearbySheet({
  sights,
  status,
  progress,
  position,
  fmt,
  open,
  onToggle,
  tab,
  onTab,
  onShowOnMap,
  expandedIds,
  onExpand,
  weather,
  notes,
}: NearbySheetProps) {
  const [search] = useState("");

  const { list, title } = useMemo(() => {
    if (!sights) return { list: [] as Sight[], title: "Nearby" };
    // Straight-line distance from here; falls back to distance along the
    // track before there is a position.
    const withStraight = sights.map((s) => ({
      s,
      straight: position ? haversine(position, [s.lat, s.lon]) : Math.abs(s.prog - progress),
    }));

    switch (tab) {
      case "nearby":
        return {
          title: "Nearby (1.5 km)",
          list: withStraight
            .filter((x) => x.straight <= 1500)
            .sort((a, b) => a.straight - b.straight)
            .slice(0, 40)
            .map((x) => x.s),
        };
      case "ahead":
        return {
          title: "Ahead (6 km)",
          list: sights
            .filter((s) => s.prog > progress && s.prog - progress <= 6000)
            .sort((a, b) => a.prog - b.prog),
        };
      case "water":
        return {
          title: "Water & shelter",
          list: sights
            .filter((s) => s.group === "water" || s.group === "hut")
            .sort((a, b) => a.prog - b.prog),
        };
      case "sights":
        return {
          title: "Sights",
          list: sights
            .filter((s) => s.group === "sight" || s.group === "peak" || s.group === "place")
            .sort((a, b) => a.prog - b.prog),
        };
      default:
        return {
          title: "Food & services",
          list: sights
            .filter((s) => /^(food|shop|service)$/.test(s.group))
            .sort((a, b) => a.prog - b.prog),
        };
    }
  }, [sights, tab, progress, position, search]);

  const label = (s: Sight) => {
    const along = s.prog - progress;
    const off = s.lateral > 60 ? ` · ${fmt.dist(s.lateral)} off the track` : "";
    return `${along >= 0 ? "in " : "back "}${fmt.dist(Math.abs(along))}${off}`;
  };

  let body: React.ReactNode;
  if (tab === "weather") {
    body = <WeatherPanel {...weather} />;
  } else if (tab === "notes") {
    body = <NotesPanel {...notes} />;
  } else if (!sights) {
    body = (
      <div className="sheet-empty">
        {status === "loading"
          ? "Looking up sights along the route…"
          : status === "error"
            ? "Couldn't load sights (no connection?). Prepare the hike for offline while you have signal."
            : "No sights loaded."}
      </div>
    );
  } else if (!list.length) {
    body = <div className="sheet-empty">Nothing here.</div>;
  } else {
    let lastGroup = "";
    body = list.map((s) => {
      // Only the mixed tabs need group headings; the rest are already one kind.
      let heading: string | null = null;
      if (tab === "nearby" || tab === "ahead") {
        const g = GROUP_TITLES[s.group] ?? "Other";
        if (g !== lastGroup) {
          heading = g;
          lastGroup = g;
        }
      }
      const meta = [
        s.ele ? `${s.ele} m` : "",
        s.tags.opening_hours ? `Hours: ${s.tags.opening_hours}` : "",
        s.tags.phone ?? "",
        s.tags["description:en"] || s.tags.description || "",
      ]
        .filter(Boolean)
        .join(" · ");

      return (
        <div key={s.id}>
          {heading && <div className="group-title">{heading}</div>}
          <PoiCard
            name={s.name}
            kind={s.kind}
            distance={label(s)}
            passed={s.prog < progress - 100}
            open={expandedIds.has(s.id)}
            onToggle={() => onExpand(s.id)}
          >
            {s.wiki?.extract && <p className="fact">{s.wiki.extract}</p>}
            {meta && <p className="meta">{meta}</p>}
            <div className="actions">
              <button onClick={() => onShowOnMap(s)}>Show on map</button>
              {s.wiki && (
                <a className="btn" href={s.wiki.url} target="_blank" rel="noopener noreferrer">
                  {/* Labelled when it is not English, so nobody taps into Spanish unawares. */}
                  Wikipedia{s.wiki.lang !== "en" ? ` (${s.wiki.lang.toUpperCase()})` : ""}
                </a>
              )}
              {s.tags.website && (
                <a className="btn" href={s.tags.website} target="_blank" rel="noopener noreferrer">
                  Website
                </a>
              )}
              <a
                className="btn"
                href={`https://www.google.com/search?q=${encodeURIComponent(`${s.name} Picos de Europa`)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Search
              </a>
              <a
                className="btn"
                href={`https://www.google.com/maps?q=${s.lat},${s.lon}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Maps
              </a>
            </div>
          </PoiCard>
        </div>
      );
    });
  }

  return (
    <Sheet
      title={
        tab === "weather"
          ? "Weather along the route"
          : tab === "notes"
            ? notes.notes?.name || "Route notes"
            : title
      }
      count={tab === "weather" || tab === "notes" ? undefined : sights ? list.length : undefined}
      open={open}
      onToggle={onToggle}
      tabs={TABS}
      activeTab={tab}
      onTab={(id) => onTab(id as NearbyTab)}
    >
      {body}
    </Sheet>
  );
}
