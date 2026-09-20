/**
 * The library: pick a hike, import a GPX, download a hike for offline.
 *
 * Each row shows what the walk costs — distance, climb, the Tobler estimate,
 * and how it went last time — and how ready it is for a day with no signal.
 * The offline state is checked per row rather than assumed, because the tile
 * cache is shared with the browser's own eviction policy and can disappear.
 */
import { type Formatter, type ProcessedTrack } from "@slownav/core";
import { type Hike, type HikeSettings } from "./model.js";
export interface LibraryPanelProps {
    currentId: string | null;
    settings: HikeSettings;
    fmt: Formatter;
    onOpen: (id: string) => void;
    onClose: () => void;
    onToast: (m: string) => void;
    /** Bumped by the parent to force a re-read after an import or delete. */
    refreshNonce: number;
    onChanged: () => void;
    /** Fetches sights before the tiles, so an offline hike has both. */
    onPrepareSights: (h: Hike, track: ProcessedTrack) => Promise<void>;
    /** Set by the parent when "Prepare this hike for offline" was chosen from the menu. */
    autoPrepareId?: string | null;
    onAutoPrepared?: () => void;
}
export declare function LibraryPanel({ currentId, settings, fmt, onOpen, onClose, onToast, refreshNonce, onChanged, onPrepareSights, autoPrepareId, onAutoPrepared, }: LibraryPanelProps): import("react").JSX.Element;
//# sourceMappingURL=LibraryPanel.d.ts.map