/**
 * The hiking app's own domain: settings, the library of tracks, and the ETA.
 */
import { type Point3, type ProcessedTrack, type Session, type Units, type Waypoint } from "@slownav/core";
export declare const APP = "hike";
export interface HikeSettings {
    units: Units;
    /** Flat-ground walking pace, km/h — what the Tobler estimate is scaled to. */
    pace: number;
    /** Distance from the track that counts as off it, metres. */
    off: number;
    /** Buzz when going off track. */
    vib: boolean;
    /** Warn when the ETA falls after sunset. */
    sun: boolean;
    /** Hold the screen awake while tracking. */
    wake: boolean;
}
export declare const DEFAULT_SETTINGS: HikeSettings;
export declare function loadSettings(): HikeSettings;
export declare function saveSettings(s: HikeSettings): void;
export interface Hike {
    id: string;
    name: string;
    pts: Point3[];
    wpts?: Waypoint[];
    /** True for the five tracks shipped with the app, which cannot be deleted. */
    builtin?: boolean;
}
/** A waypoint with its distance along the track worked out. */
export interface WaypointAt extends Waypoint {
    prog: number;
}
/**
 * The five embedded Picos tracks, plus anything the walker has imported.
 *
 * Elevations are repaired on the way out: one of the shipped tracks begins
 * with six points recorded before the device had an altitude fix, which
 * otherwise reads as a phantom kilometre of climb.
 */
export declare const library: {
    list(): Hike[];
    get(id: string): Hike | undefined;
    add(h: Hike): void;
    remove(id: string): void;
    /** A stable id for an imported file, so importing it twice does not duplicate it. */
    idFor(filename: string, pointCount: number): string;
};
/** Place a hike's waypoints along its track, dropping any that are nowhere near it. */
export declare function waypointsAlong(track: ProcessedTrack, wpts: readonly Waypoint[]): WaypointAt[];
export declare function prepare(h: Hike, paceKmh: number): ProcessedTrack;
export interface Eta {
    /** Seconds remaining. */
    seconds: number;
    at: Date;
    /** What the estimate is based on — shown so the number can be trusted or not. */
    basis: "planned pace" | "your pace today";
    /** Tobler's own prediction for the remaining distance, unscaled. */
    toblerLeft: number;
}
/**
 * Time to the end of the track.
 *
 * Starts from Tobler's hiking function over the remaining profile, then — once
 * there is enough of a sample — scales it by how this walker is actually
 * doing today against what Tobler predicted for the ground already covered.
 * A heavy pack, deep snow or a hangover all show up here without anyone
 * having to tell the app about them.
 *
 * The scaling is clamped to 0.5–3×: beyond that the sample is more likely to
 * be wrong than the walker is to be that fast or that slow.
 */
export declare function eta(track: ProcessedTrack, progress: number, session: Session | null, now?: number): Eta;
//# sourceMappingURL=model.d.ts.map