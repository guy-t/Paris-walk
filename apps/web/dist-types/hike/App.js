import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Picos Hikes.
 *
 * The shell: header, dashboard, map, sheet, and the two panels that slide
 * over them. Everything below this file is either a shared component or a
 * pure function; this is the only place that knows how they fit together.
 */
import { addRecord, clearSession as clearStoredSession, createFormatter, downloadGPX, positionAt, project, records, store, toGPX, toRecord, } from "@slownav/core";
import { MapView, Toast, UpdateToast, useGeolocation, useServiceWorker, useToast, useWakeLock, } from "@slownav/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dashboard } from "./Dashboard.js";
import { LibraryPanel } from "./LibraryPanel.js";
import { NearbySheet, tabForSight } from "./NearbySheet.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { APP, library, loadSettings, saveSettings } from "./model.js";
import { useHike } from "./useHike.js";
import "./hike.css";
const TILE_URL = "https://a.tile.opentopomap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = 'Map: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · data © OpenStreetMap';
/** Keeps elapsed time and the moving average ticking between GPS fixes. */
const TICK_MS = 5000;
export function App() {
    const [settings, setSettings] = useState(loadSettings);
    const fmt = useMemo(() => createFormatter(settings.units), [settings.units]);
    const hike = useHike(settings);
    const { state } = hike;
    const [panel, setPanel] = useState("none");
    const [menuOpen, setMenuOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [tab, setTab] = useState("nearby");
    const [expanded, setExpanded] = useState(new Set());
    const [compact, setCompact] = useState(() => store.get("hike:compact") === true);
    const [mapFull, setMapFull] = useState(false);
    const [follow, setFollow] = useState(true);
    const [fitNonce, setFitNonce] = useState(0);
    const [centreNonce, setCentreNonce] = useState(0);
    const [resizeNonce, setResizeNonce] = useState(0);
    const [flyTo, setFlyTo] = useState(null);
    const [libraryNonce, setLibraryNonce] = useState(0);
    const [autoPrepareId, setAutoPrepareId] = useState(null);
    const [tick, setTick] = useState(0);
    const { toast, show, dismiss } = useToast();
    const sw = useServiceWorker(`${import.meta.env.BASE_URL}sw.js`);
    const gps = useGeolocation({
        onFix: hike.onFix,
        onError: (message, permanent) => {
            if (permanent)
                alert(message);
            else
                show(message);
        },
        onResume: hike.resumeTracking,
    });
    useWakeLock(settings.wake && gps.tracking);
    // ---- boot: the hike we were on, or the library if there is none ----
    const booted = useRef(false);
    useEffect(() => {
        if (booted.current)
            return;
        booted.current = true;
        const current = store.get("hike:current");
        if (current && library.get(current)) {
            const opened = hike.openHike(current);
            if (opened?.resumed) {
                show("Resumed this hike's session — press GPS to continue tracking.");
            }
            if (opened && !opened.hike.pts.length)
                return;
            if (opened && !store.get(`hike:sights:${current}`) && navigator.onLine) {
                void hike.loadSights(opened.hike, opened.track);
            }
        }
        else {
            setPanel("library");
        }
    }, [hike, show]);
    // ---- a slow tick, so elapsed time moves without a GPS fix ----
    useEffect(() => {
        if (state.mode !== "gps" || !state.session)
            return;
        const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
        return () => clearInterval(id);
    }, [state.mode, state.session]);
    // ---- close the menu on any outside tap ----
    useEffect(() => {
        if (!menuOpen)
            return;
        const close = (e) => {
            if (!e.target.closest(".menu"))
                setMenuOpen(false);
        };
        document.addEventListener("click", close);
        return () => document.removeEventListener("click", close);
    }, [menuOpen]);
    // ---- body classes drive the panel and full-screen layouts ----
    useEffect(() => {
        document.body.classList.toggle("library", panel === "library");
        document.body.classList.toggle("settings", panel === "settings");
        document.body.classList.toggle("map-full", mapFull);
    }, [panel, mapFull]);
    const openHike = useCallback((id) => {
        const opened = hike.openHike(id);
        setPanel("none");
        setFitNonce((n) => n + 1);
        if (!opened)
            return;
        if (opened.resumed)
            show("Resumed this hike's session — press GPS to continue tracking.");
        if (!store.get(`hike:sights:${id}`) && navigator.onLine) {
            void hike.loadSights(opened.hike, opened.track);
        }
    }, [hike, show]);
    const toggleGps = useCallback(() => {
        if (gps.tracking) {
            gps.stop();
            hike.endTracking();
            return;
        }
        if (!state.track) {
            show("Choose a hike first.");
            return;
        }
        hike.beginSession();
        setFollow(true);
        gps.start();
    }, [gps, hike, state.track, show]);
    const finish = useCallback(() => {
        if (!state.hike || !state.session) {
            show("No session to finish.");
            return;
        }
        const rec = toRecord(state.session);
        addRecord(APP, state.hike.id, rec);
        clearStoredSession(APP, state.hike.id);
        gps.stop();
        hike.endTracking();
        hike.clearSession();
        hike.setPreview(0);
        show(`Saved: ${fmt.km(rec.dist)} in ${fmt.dur(rec.elapsed)} (${fmt.dur(rec.moving)} moving)`, 5000);
    }, [state.hike, state.session, gps, hike, fmt, show]);
    const resetSession = useCallback(() => {
        if (!state.hike)
            return;
        if (!confirm("Clear this hike's recorded track and timers?"))
            return;
        gps.stop();
        clearStoredSession(APP, state.hike.id);
        hike.endTracking();
        hike.clearSession();
        hike.setPreview(0);
        show("Session cleared");
    }, [state.hike, gps, hike, show]);
    const exportTrail = useCallback(() => {
        const trail = state.session?.trail.length
            ? state.session.trail
            : records(APP, state.hike?.id ?? "").slice(-1)[0]?.trail;
        if (!trail?.length || !state.hike) {
            show("No recorded track yet.");
            return;
        }
        downloadGPX(`${state.hike.name}_recorded`, toGPX(`${state.hike.name} (recorded)`, trail, true, "Slow Navigator · Picos Hikes"));
    }, [state.session, state.hike, show]);
    // ---- what the map draws ----
    const doneUpTo = useMemo(() => {
        if (!state.track)
            return undefined;
        const { idx, pos } = positionAt(state.track.pts, state.track.cum, state.progress);
        return [...state.track.pts.slice(0, idx + 1), pos];
    }, [state.track, state.progress]);
    const markers = useMemo(() => {
        const out = state.waypoints.map((w, i) => ({
            id: `wp/${i}`,
            lat: w.lat,
            lon: w.lon,
            kind: "wp",
            label: /^\d+$/.test(w.name) ? w.name : w.name.slice(0, 2) || String(i + 1),
            popup: `<b>${escapeHtml(w.name)}</b>${w.desc ? `<br>${escapeHtml(w.desc)}` : ""}`,
        }));
        for (const s of state.sights ?? []) {
            // Villages are context, not destinations; a pin for each would bury the map.
            if (s.group === "place")
                continue;
            out.push({
                id: s.id,
                lat: s.lat,
                lon: s.lon,
                kind: s.icon,
                popup: `<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.kind)}${s.ele ? ` · ${s.ele} m` : ""}`,
                onClick: () => {
                    setSheetOpen(true);
                    setTab(tabForSight(s));
                    setExpanded((e) => new Set(e).add(s.id));
                },
            });
        }
        return out;
    }, [state.waypoints, state.sights]);
    const trail = useMemo(() => state.session?.trail.map((p) => [p[0], p[1]]), [state.session]);
    return (_jsxs(_Fragment, { children: [_jsxs("header", { className: "bar", children: [_jsx("h1", { onClick: () => setPanel("library"), title: "Choose a hike", children: state.hike?.name ?? "Picos Hikes" }), _jsxs("button", { className: gps.tracking ? "on" : gps.status === "starting" ? "busy" : "", onClick: toggleGps, title: "Track my position", children: [_jsxs("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4", strokeLinecap: "round", children: [_jsx("circle", { cx: "12", cy: "12", r: "3" }), _jsx("path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" }), _jsx("circle", { cx: "12", cy: "12", r: "8" })] }), _jsx("span", { children: "GPS" })] }), _jsxs("div", { className: "menu", children: [_jsx("button", { onClick: (e) => { e.stopPropagation(); setMenuOpen((o) => !o); }, title: "More", children: "\u22EF" }), _jsxs("div", { className: `menu-list ${menuOpen ? "open" : ""}`, children: [_jsxs("button", { onClick: () => { setPanel("library"); setMenuOpen(false); }, children: ["My hikes", _jsx("small", { children: "Choose, import, prepare for offline" })] }), _jsxs("button", { onClick: () => {
                                            setMenuOpen(false);
                                            setPanel("library");
                                            if (state.hike)
                                                setAutoPrepareId(state.hike.id);
                                        }, children: ["Prepare this hike for offline", _jsx("small", { children: "Downloads map tiles and sights for the route" })] }), _jsxs("button", { onClick: () => { setPanel("settings"); setMenuOpen(false); }, children: ["Settings", _jsx("small", { children: "Pace, units, alerts" })] }), _jsx("hr", {}), _jsxs("button", { onClick: () => { finish(); setMenuOpen(false); }, children: ["Finish hike & save stats", _jsx("small", { children: "Ends the session and stores the recorded track" })] }), _jsxs("button", { onClick: () => { resetSession(); setMenuOpen(false); }, children: ["Reset this hike's session", _jsx("small", { children: "Clears recorded track and timers" })] }), _jsx("button", { onClick: () => { exportTrail(); setMenuOpen(false); }, children: "Export recorded track (GPX)" }), _jsx("hr", {}), _jsxs("label", { className: "row", children: [_jsx("span", { style: { color: "var(--ink)", fontSize: 14 }, children: "Keep screen on while tracking" }), _jsx("input", { type: "checkbox", checked: settings.wake, onChange: (e) => {
                                                    const next = { ...settings, wake: e.target.checked };
                                                    setSettings(next);
                                                    saveSettings(next);
                                                } })] }), _jsx("hr", {}), _jsx("button", { onClick: () => { setMenuOpen(false); alert(ABOUT); }, children: "About & data sources" })] })] })] }), panel === "library" && (_jsx(LibraryPanel, { currentId: state.hike?.id ?? null, settings: settings, fmt: fmt, onOpen: openHike, onClose: () => setPanel("none"), onToast: show, refreshNonce: libraryNonce, onChanged: () => setLibraryNonce((n) => n + 1), onPrepareSights: hike.loadSights, autoPrepareId: autoPrepareId, onAutoPrepared: () => setAutoPrepareId(null) })), panel === "settings" && (_jsx(SettingsPanel, { settings: settings, onClose: () => setPanel("none"), onSave: (next) => {
                    setSettings(next);
                    saveSettings(next);
                    setPanel("none");
                    // The pace feeds the Tobler profile, so the track is re-measured.
                    if (state.hike)
                        openHike(state.hike.id);
                    show("Settings saved");
                } })), _jsx(Dashboard, { state: state, eta: hike.eta, fmt: fmt, settings: settings, compact: compact || mapFull, onCompact: (v) => {
                    setCompact(v);
                    store.set("hike:compact", v);
                }, onScrub: hike.setPreview, tick: tick }), _jsxs("div", { className: "mapwrap", children: [_jsx(MapView, { planned: state.track?.pts, doneUpTo: doneUpTo, trail: trail, markers: markers, position: state.pos, accuracy: state.mode === "gps" ? state.accuracy : null, tileUrl: TILE_URL, tileAttribution: TILE_ATTRIBUTION, imperialScale: settings.units === "imperial", follow: follow, onUserPan: () => setFollow(false), onMapClick: (pos) => {
                            // Tapping the track moves the preview; tapping empty map does
                            // nothing, so a stray thumb cannot teleport the walker.
                            if (!state.track || state.mode !== "preview")
                                return;
                            const m = project(state.track.pts, state.track.cum, pos, { global: true });
                            if (m && m.dist < 200)
                                hike.setPreview(m.prog);
                        }, fitNonce: fitNonce, centreNonce: centreNonce, resizeNonce: resizeNonce, flyTo: flyTo }), state.mode === "preview" && state.track && !mapFull && (_jsx("div", { className: "map-note", children: "Preview: tap the track or profile to move. Press GPS to start." })), _jsxs("div", { className: "map-fabs", children: [_jsx("button", { className: `fab ${follow ? "on" : ""}`, title: "Keep the map on me", onClick: () => {
                                    setFollow(true);
                                    setCentreNonce((n) => n + 1);
                                }, children: _jsx("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M21 3L10 14M21 3l-7 18-4-7-7-4z" }) }) }), _jsx("button", { className: `fab ${mapFull ? "on" : ""}`, title: "Full-screen map", onClick: () => {
                                    setMapFull((f) => !f);
                                    setResizeNonce((n) => n + 1);
                                }, children: _jsx("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" }) }) }), _jsx("button", { className: "fab", title: "Whole hike", onClick: () => {
                                    setFollow(false);
                                    setFitNonce((n) => n + 1);
                                }, children: _jsx("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" }) }) })] })] }), _jsx(NearbySheet, { sights: state.sights, status: state.sightsStatus, progress: state.progress, position: state.pos, fmt: fmt, open: sheetOpen, onToggle: setSheetOpen, tab: tab, onTab: setTab, expandedIds: expanded, onExpand: (id) => setExpanded((e) => {
                    const next = new Set(e);
                    if (next.has(id))
                        next.delete(id);
                    else
                        next.add(id);
                    return next;
                }), onShowOnMap: (s) => {
                    setFollow(false);
                    setFlyTo({ pos: [s.lat, s.lon], nonce: Date.now() });
                } }), _jsx(Toast, { toast: toast, onDismiss: dismiss }), _jsx(UpdateToast, { available: sw.updateAvailable, onReload: sw.applyUpdate })] }));
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const ABOUT = `Picos Hikes — part of Slow Navigator.

• Maps: OpenTopoMap (CC-BY-SA), stored on the phone when you prepare a hike for offline.
• Sights: OpenStreetMap along the route plus Wikipedia articles nearby (English first, Spanish otherwise).
• ETA: Tobler's hiking function, calibrated to your pace after twenty minutes.
• Battery: GPS only runs while the app is on screen.

This is a planning aid, not a substitute for a map, compass and judgement in the mountains.`;
//# sourceMappingURL=App.js.map