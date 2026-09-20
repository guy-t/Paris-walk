/**
 * The dashboard: the four numbers that matter, the off-track arrow, the
 * elevation profile, and the swipeable strip of everything else.
 *
 * "Compact" collapses it to just the four tiles. That is the mode you want on
 * a narrow path with the map full-screen, and it is remembered between
 * sessions because whoever wants it wants it every time.
 */
import { type Formatter } from "@slownav/core";
import type { Eta, HikeSettings } from "./model.js";
import type { HikeState } from "./useHike.js";
export interface DashboardProps {
    state: HikeState;
    eta: Eta | null;
    fmt: Formatter;
    settings: HikeSettings;
    compact: boolean;
    onCompact: (v: boolean) => void;
    onScrub: (metres: number) => void;
    /** Ticks every few seconds so elapsed and average times stay live. */
    tick: number;
}
export declare function Dashboard({ state, eta, fmt, settings, compact, onCompact, onScrub, tick, }: DashboardProps): import("react").JSX.Element;
//# sourceMappingURL=Dashboard.d.ts.map