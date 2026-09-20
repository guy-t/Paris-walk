/**
 * The hiking app's state, and the wiring between a GPS fix and the dashboard.
 *
 * One state object with a `patch` updater, which is the same shape the
 * single-file version used — it keeps the flow of a fix readable in one
 * place: match it to the track, fold it into the session, save occasionally.
 */
import { type Fix, type LatLon, type ProcessedTrack, type Session } from "@slownav/core";
import { type Hike, type HikeSettings, type WaypointAt } from "./model.js";
import { type Sight } from "./sights.js";
export type SightsStatus = "idle" | "loading" | "ok" | "error";
export type Mode = "preview" | "gps";
export interface HikeState {
    hike: Hike | null;
    track: ProcessedTrack | null;
    waypoints: WaypointAt[];
    sights: Sight[] | null;
    sightsStatus: SightsStatus;
    mode: Mode;
    /** Metres along the track. */
    progress: number;
    pos: LatLon | null;
    accuracy: number | null;
    altitude: number | null;
    speed: number | null;
    heading: number | null;
    offTrack: boolean;
    offDistance: number;
    offBearing: number | null;
    /** The last fix was too vague to place on the track. */
    weak: boolean;
    session: Session | null;
    tiles: {
        have: number;
        total: number;
    } | null;
}
export declare function useHike(settings: HikeSettings): {
    state: HikeState;
    patch: (p: Partial<HikeState>) => void;
    eta: import("./model.js").Eta | null;
    openHike: (id: string) => {
        hike: Hike;
        track: ProcessedTrack;
        resumed: boolean;
    } | undefined;
    setPreview: (metres: number) => void;
    onFix: (fix: Fix) => void;
    beginSession: () => void;
    endTracking: () => void;
    resumeTracking: () => void | undefined;
    clearSession: () => void;
    setSession: (s: Session | null) => void;
    loadSights: (hike: Hike, track: ProcessedTrack) => Promise<void>;
    save: () => void;
};
//# sourceMappingURL=useHike.d.ts.map