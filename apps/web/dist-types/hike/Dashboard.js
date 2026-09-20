import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The dashboard: the four numbers that matter, the off-track arrow, the
 * elevation profile, and the swipeable strip of everything else.
 *
 * "Compact" collapses it to just the four tiles. That is the mode you want on
 * a narrow path with the map full-screen, and it is remembered between
 * sessions because whoever wants it wants it every time.
 */
import { ElevationProfile, StatStrip, StatTile } from "@slownav/ui";
import { interp, positionAt, sunTimes } from "@slownav/core";
import { useMemo } from "react";
export function Dashboard({ state, eta, fmt, settings, compact, onCompact, onScrub, tick, }) {
    const { track, session, progress, mode } = state;
    const sun = useMemo(() => (track ? sunTimes(track.pts[0][0], track.pts[0][1]) : null), [track]);
    const waypointProgs = useMemo(() => state.waypoints.map((w) => w.prog), [state.waypoints]);
    if (!track) {
        return (_jsx("section", { className: "dash", children: _jsxs("div", { className: "status", children: [_jsx("span", { className: "dot" }), _jsx("span", { className: "status-text", children: "Choose a hike from the menu" })] }) }));
    }
    const { idx, t } = positionAt(track.pts, track.cum, progress);
    const climbLeft = Math.max(0, track.up - interp(track.upCum, idx, t));
    const altitude = mode === "gps" && state.altitude != null ? state.altitude : interp(track.ele, idx, t);
    const afterSunset = !!(sun && eta && eta.at > sun.sunset);
    const dotClass = !state.pos
        ? "dot"
        : `dot ${state.offTrack ? "off" : "live"}`;
    const status = mode !== "gps"
        ? "Preview · tap the profile or drag the slider"
        : !state.pos
            ? "Waiting for GPS…"
            : state.weak
                ? `Weak GPS (±${Math.round(state.accuracy ?? 0)} m)`
                : `Tracking · ±${Math.round(state.accuracy ?? 0)} m · ${fmt.speed(state.speed)}`;
    // The strip's derived numbers. Recomputed on `tick` so elapsed time moves
    // even when no fix has arrived.
    void tick;
    const elapsed = session ? (Date.now() - session.start) / 1000 : 0;
    const moving = session?.moving ?? 0;
    const dist = session?.dist ?? 0;
    const strip = [
        ["Altitude", fmt.alt(altitude)],
        ["Speed", fmt.speed(mode === "gps" ? state.speed : null)],
        ["Moving avg", fmt.speed(moving > 60 ? dist / moving : null)],
        ["Overall avg", fmt.speed(elapsed > 60 ? dist / elapsed : null)],
        ["Pace", fmt.pace(moving > 60 ? dist / moving : 0)],
        ["Elapsed", session ? fmt.dur(elapsed) : "—"],
        ["Moving", session ? fmt.dur(moving) : "—"],
        ["Climbed", fmt.alt(interp(track.upCum, idx, t))],
        ["Descended", fmt.alt(interp(track.downCum, idx, t))],
        ["Descent left", fmt.alt(track.down - interp(track.downCum, idx, t))],
        ["Sunset", sun ? fmt.clock(sun.sunset) : "—"],
        ["Total", `${fmt.km(track.length)} · ↑${fmt.alt(track.up)}`],
        ["Plan (Tobler)", fmt.dur(track.tobler)],
    ];
    const ahead = state.waypoints
        .filter((w) => w.prog > progress + 15)
        .sort((a, b) => a.prog - b.prog);
    return (_jsxs("section", { className: `dash ${compact ? "compact" : ""}`, children: [_jsxs("div", { className: "status", children: [_jsx("span", { className: state.mode === "gps" && !state.pos ? "dot" : dotClass }), _jsx("span", { className: "status-text", children: status }), _jsx("button", { className: "iconbtn", onClick: () => onCompact(!compact), title: compact ? "More detail" : "Less detail", "aria-label": compact ? "Show more detail" : "Show less detail", children: compact ? "▼" : "▲" })] }), _jsxs("div", { className: "tiles", children: [_jsx(StatTile, { label: "Done", value: fmt.km(progress) }), _jsx(StatTile, { label: "To go", value: fmt.km(Math.max(0, track.length - progress)) }), _jsx(StatTile, { label: "Climb left", value: fmt.alt(climbLeft) }), _jsx(StatTile, { label: afterSunset ? "ETA · after dark" : "ETA", value: eta ? fmt.clock(eta.at) : "—", detail: eta ? fmt.dur(eta.seconds) : undefined, alert: afterSunset && settings.sun })] }), mode === "gps" && state.offTrack && state.offBearing != null && (_jsxs("div", { className: "offtrack", children: [_jsx("div", { className: "arrow", 
                        // Points the way back relative to travel when we know which way
                        // the walker faces; north-up otherwise, and says so.
                        style: {
                            transform: `rotate(${state.heading != null ? state.offBearing - state.heading : state.offBearing}deg)`,
                        }, children: _jsx("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.6", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M12 21V4M5 11l7-7 7 7" }) }) }), _jsxs("div", { children: ["Path is ", fmt.dist(state.offDistance), " away \u00B7 bearing ", Math.round(state.offBearing), "\u00B0", state.heading == null ? " (arrow points from north)" : ""] })] })), _jsx("div", { className: "profile", children: _jsx(ElevationProfile, { track: track, progress: progress, waypoints: waypointProgs, onScrub: mode === "preview" ? onScrub : undefined, imperial: settings.units === "imperial", formatAltitude: fmt.alt }) }), ahead.length > 0 && (_jsxs("div", { className: "next", children: [_jsx("span", { style: { color: "var(--muted)" }, children: "Next" }), _jsx("span", { className: "n", children: ahead[0].name }), _jsxs("span", { className: "d", children: [fmt.dist(ahead[0].prog - progress), ahead[1] ? ` · then ${ahead[1].name} ${fmt.dist(ahead[1].prog - progress)}` : ""] })] })), _jsx(StatStrip, { stats: strip }), mode === "preview" && (_jsxs("div", { className: "scrub", children: [_jsx("button", { onClick: () => onScrub(progress - 500), children: "\u2212500 m" }), _jsx("input", { type: "range", min: 0, max: 1000, value: Math.round((1000 * progress) / track.length), onChange: (e) => onScrub((track.length * +e.target.value) / 1000), "aria-label": "Position along the hike" }), _jsx("button", { onClick: () => onScrub(progress + 500), children: "+500 m" }), _jsx("span", { className: "lab", children: fmt.km(progress) })] }))] }));
}
//# sourceMappingURL=Dashboard.js.map