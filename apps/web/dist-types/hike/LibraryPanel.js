import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The library: pick a hike, import a GPX, download a hike for offline.
 *
 * Each row shows what the walk costs — distance, climb, the Tobler estimate,
 * and how it went last time — and how ready it is for a day with no signal.
 * The offline state is checked per row rather than assumed, because the tile
 * cache is shared with the browser's own eviction policy and can disappear.
 */
import { cachedCount, corridorTiles, downloadGPX, estimateMB, parseGPX, precacheTiles, processTrack, records, repairElevation, storageUsedMB, store, toGPX, } from "@slownav/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP, library } from "./model.js";
/** A small SVG sparkline of the elevation profile, for the row. */
function Thumb({ track }) {
    const W = 110;
    const H = 44;
    const d = useMemo(() => {
        const n = track.pts.length;
        const step = Math.max(1, Math.floor(n / W));
        const range = track.maxEle - track.minEle + 1;
        let path = `M0,${H}`;
        for (let i = 0; i < n; i += step) {
            const x = ((track.cum[i] / track.length) * W).toFixed(1);
            const y = (H - 4 - ((track.ele[i] - track.minEle) / range) * (H - 8)).toFixed(1);
            path += ` L${x},${y}`;
        }
        return `${path} L${W},${H} Z`;
    }, [track]);
    return (_jsx("svg", { className: "thumb", viewBox: `0 0 ${W} ${H}`, "aria-hidden": true, children: _jsx("path", { d: d, fill: "#cfd9d2", stroke: "#2f4f3e", strokeWidth: "1" }) }));
}
export function LibraryPanel({ currentId, settings, fmt, onOpen, onClose, onToast, refreshNonce, onChanged, onPrepareSights, autoPrepareId, onAutoPrepared, }) {
    const hikes = useMemo(() => library.list(), [refreshNonce]);
    const [offline, setOffline] = useState({});
    const [busy, setBusy] = useState(null);
    const [progressText, setProgressText] = useState({});
    const [progressFrac, setProgressFrac] = useState({});
    const [storageMB, setStorageMB] = useState(null);
    const fileInput = useRef(null);
    const tracks = useMemo(() => new Map(hikes.map((h) => [h.id, processTrack(h.pts, settings.pace)])), [hikes, settings.pace]);
    const refreshOffline = useCallback(async (id, pts) => {
        const urls = corridorTiles(pts);
        const have = await cachedCount(urls);
        setOffline((o) => ({ ...o, [id]: { have, total: urls.length } }));
    }, []);
    useEffect(() => {
        for (const h of hikes)
            void refreshOffline(h.id, h.pts);
        void storageUsedMB().then(setStorageMB);
    }, [hikes, refreshOffline]);
    const prepare = useCallback(async (h) => {
        if (!navigator.onLine) {
            onToast("You're offline — connect to Wi-Fi first.");
            return;
        }
        setBusy(h.id);
        try {
            const track = tracks.get(h.id);
            if (!store.get(`hike:sights:${h.id}`)) {
                setProgressText((p) => ({ ...p, [h.id]: "Looking up sights and articles…" }));
                await onPrepareSights(h, track);
            }
            const urls = corridorTiles(h.pts);
            const res = await precacheTiles(urls, ({ done, total, failed }) => {
                setProgressText((p) => ({
                    ...p,
                    [h.id]: `Downloading map ${done}/${total}${failed ? ` (${failed} failed)` : ""}`,
                }));
                setProgressFrac((p) => ({ ...p, [h.id]: done / total }));
            });
            setProgressText((p) => ({
                ...p,
                [h.id]: res.failed
                    ? `Done with ${res.failed} tiles missing — run again to fill the gaps.`
                    : "Ready for offline.",
            }));
            await refreshOffline(h.id, h.pts);
            void storageUsedMB().then(setStorageMB);
        }
        catch (e) {
            setProgressText((p) => ({
                ...p,
                [h.id]: `Failed: ${e instanceof Error ? e.message : String(e)}`,
            }));
        }
        setBusy(null);
    }, [tracks, onPrepareSights, onToast, refreshOffline]);
    // "Prepare this hike for offline" from the menu opens the panel and starts
    // the download for that row, so it takes one tap rather than three.
    const prepareRef = useRef(prepare);
    prepareRef.current = prepare;
    useEffect(() => {
        if (!autoPrepareId)
            return;
        const h = hikes.find((x) => x.id === autoPrepareId);
        if (h)
            void prepareRef.current(h);
        onAutoPrepared?.();
    }, [autoPrepareId, hikes, onAutoPrepared]);
    const importFiles = async (files) => {
        for (const f of Array.from(files)) {
            try {
                const parsed = parseGPX(await f.text(), f.name.replace(/\.gpx$/i, ""));
                library.add({
                    id: library.idFor(f.name, parsed.pts.length),
                    name: parsed.name,
                    pts: repairElevation(parsed.pts),
                    wpts: parsed.wpts,
                });
                onToast(`Imported ${f.name}`);
            }
            catch (err) {
                onToast(`${f.name}: ${err instanceof Error ? err.message : "could not be read"}`);
            }
        }
        onChanged();
    };
    return (_jsxs("div", { className: "panel", id: "library", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { children: "My hikes" }), _jsx("button", { className: "close", onClick: onClose, "aria-label": "Close", children: "\u2715" })] }), _jsx("div", { className: "panel-body", children: hikes.map((h) => {
                    const track = tracks.get(h.id);
                    const recs = records(APP, h.id);
                    const best = recs.length ? recs[recs.length - 1] : null;
                    const sess = store.get(`hike:session:${h.id}`);
                    const off = offline[h.id];
                    const ready = off ? off.have >= off.total * 0.95 : false;
                    return (_jsxs("div", { className: `hike ${h.id === currentId ? "current" : ""}`, children: [_jsx("div", { className: "t", children: h.name }), _jsxs("div", { className: "stats", children: [fmt.km(track.length), " \u00B7 \u2191 ", fmt.alt(track.up), " \u00B7 \u2193 ", fmt.alt(track.down), " \u00B7", " ", fmt.alt(track.minEle), "\u2013", fmt.alt(track.maxEle), _jsx("br", {}), "Est. ", fmt.dur(track.tobler), " moving", best && (_jsxs(_Fragment, { children: [_jsx("br", {}), "Last time: ", fmt.dur(best.elapsed), " (", fmt.dur(best.moving), " moving),", " ", new Date(best.date).toLocaleDateString()] })), sess && !sess.finished && (_jsxs(_Fragment, { children: [_jsx("br", {}), _jsx("b", { children: "Session in progress" }), " \u2014 ", fmt.km(sess.maxProg), " done"] })), _jsx("br", {}), _jsx("span", { className: `off ${off ? (ready ? "ok" : "no") : ""}`, children: !off
                                            ? "checking offline maps…"
                                            : ready
                                                ? `Offline maps ready (${off.have} tiles)`
                                                : off.have
                                                    ? `Offline maps ${Math.round((100 * off.have) / off.total)}% (${off.have}/${off.total} tiles)`
                                                    : `Not prepared for offline (${off.total} tiles, ≈ ${estimateMB(off.total)} MB)` })] }), _jsx(Thumb, { track: track }), _jsxs("div", { className: "acts", children: [h.id !== currentId && (_jsx("button", { className: "primary", onClick: () => onOpen(h.id), children: "Open" })), _jsx("button", { disabled: busy === h.id, onClick: () => void prepare(h), children: busy === h.id ? "Preparing…" : "Prepare offline" }), _jsx("button", { onClick: () => downloadGPX(h.name, toGPX(h.name, h.pts, false, "Slow Navigator · Picos Hikes")), children: "GPX" }), !h.builtin && (_jsx("button", { className: "danger", onClick: () => {
                                            if (!confirm(`Delete "${h.name}"?`))
                                                return;
                                            library.remove(h.id);
                                            if (currentId === h.id)
                                                store.del("hike:current");
                                            onChanged();
                                        }, children: "Delete" }))] }), progressText[h.id] && (_jsxs(_Fragment, { children: [_jsx("div", { className: "progress", style: { gridColumn: "1 / -1" }, children: _jsx("i", { style: { width: `${Math.round((progressFrac[h.id] ?? 0) * 100)}%` } }) }), _jsx("div", { style: { fontSize: 12, color: "var(--muted)", gridColumn: "1 / -1" }, children: progressText[h.id] })] }))] }, h.id));
                }) }), _jsxs("div", { className: "panel-foot", children: [_jsx("input", { ref: fileInput, type: "file", accept: ".gpx,application/gpx+xml", hidden: true, multiple: true, onChange: (e) => {
                            if (e.target.files)
                                void importFiles(e.target.files);
                            e.target.value = "";
                        } }), _jsx("button", { className: "primary", onClick: () => fileInput.current?.click(), children: "Import GPX" }), _jsx("span", { style: { fontSize: 12, color: "var(--muted)", alignSelf: "center" }, children: storageMB != null ? `Offline storage used: ${storageMB} MB` : "" })] })] }));
}
//# sourceMappingURL=LibraryPanel.js.map