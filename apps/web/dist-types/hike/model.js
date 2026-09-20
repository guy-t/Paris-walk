/**
 * The hiking app's own domain: settings, the library of tracks, and the ETA.
 */
import { hashStr, interp, positionAt, processTrack, project, repairElevation, store, } from "@slownav/core";
import embedded from "./tracks.json";
export const APP = "hike";
export const DEFAULT_SETTINGS = {
    units: "metric",
    pace: 5,
    off: 50,
    vib: true,
    sun: true,
    wake: false,
};
export function loadSettings() {
    return { ...DEFAULT_SETTINGS, ...(store.get("hike:settings") ?? {}) };
}
export function saveSettings(s) {
    store.set("hike:settings", s);
}
/**
 * The five embedded Picos tracks, plus anything the walker has imported.
 *
 * Elevations are repaired on the way out: one of the shipped tracks begins
 * with six points recorded before the device had an altitude fix, which
 * otherwise reads as a phantom kilometre of climb.
 */
export const library = {
    list() {
        const custom = store.get("hike:library") ?? [];
        const builtin = embedded.map((h) => ({
            ...h,
            pts: repairElevation(h.pts),
            builtin: true,
        }));
        return [...builtin, ...custom];
    },
    get(id) {
        return this.list().find((h) => h.id === id);
    },
    add(h) {
        const custom = store.get("hike:library") ?? [];
        custom.push(h);
        store.set("hike:library", custom);
    },
    remove(id) {
        store.set("hike:library", (store.get("hike:library") ?? []).filter((h) => h.id !== id));
    },
    /** A stable id for an imported file, so importing it twice does not duplicate it. */
    idFor(filename, pointCount) {
        return `gpx:${hashStr(filename + pointCount)}`;
    },
};
/** Place a hike's waypoints along its track, dropping any that are nowhere near it. */
export function waypointsAlong(track, wpts) {
    return wpts
        .map((w, i) => {
        const p = project(track.pts, track.cum, [w.lat, w.lon], { global: true });
        if (!p || p.dist >= 300)
            return null;
        return { ...w, name: w.name || `Waypoint ${i + 1}`, prog: p.prog };
    })
        .filter((w) => w !== null);
}
export function prepare(h, paceKmh) {
    return processTrack(h.pts, paceKmh);
}
/** Only calibrate to the walker's own pace after this much moving time, seconds. */
const CALIBRATE_AFTER_S = 20 * 60;
/** …and this much distance, metres. Below either, the sample is noise. */
const CALIBRATE_AFTER_M = 800;
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
export function eta(track, progress, session, now = Date.now()) {
    const { idx, t } = positionAt(track.pts, track.cum, progress);
    const toblerDone = interp(track.tobCum, idx, t);
    const toblerLeft = track.tobler - toblerDone;
    let factor = 1;
    let basis = "planned pace";
    if (session && session.moving > CALIBRATE_AFTER_S && session.dist > CALIBRATE_AFTER_M) {
        // What did Tobler predict for the stretch this session actually walked?
        const from = positionAt(track.pts, track.cum, Math.max(0, progress - session.dist));
        const predicted = toblerDone - interp(track.tobCum, from.idx, from.t);
        const elapsed = (now - session.start) / 1000;
        if (predicted > 300) {
            factor = Math.min(3, Math.max(0.5, elapsed / predicted));
            basis = "your pace today";
        }
    }
    const seconds = toblerLeft * factor;
    return { seconds, at: new Date(now + seconds * 1000), basis, toblerLeft };
}
//# sourceMappingURL=model.js.map