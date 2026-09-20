/**
 * "What is around me" — the bottom sheet.
 *
 * Five tabs, because what a walker wants to know changes with the situation:
 * water and shelter when it is going wrong, sights when it is going well,
 * food when arriving somewhere. "Nearby" sorts by straight-line distance
 * because that is what matters when you are standing still; "Ahead" sorts by
 * distance along the track because that is what matters when you are moving.
 */
import { type Formatter, type LatLon } from "@slownav/core";
import type { Sight } from "./sights.js";
import type { SightsStatus } from "./useHike.js";
export type NearbyTab = "nearby" | "ahead" | "water" | "sights" | "food";
/** Which tab a sight belongs to when opened from a map marker. */
export declare function tabForSight(s: Sight): NearbyTab;
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
}
export declare function NearbySheet({ sights, status, progress, position, fmt, open, onToggle, tab, onTab, onShowOnMap, expandedIds, onExpand, }: NearbySheetProps): import("react").JSX.Element;
//# sourceMappingURL=NearbySheet.d.ts.map