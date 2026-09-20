/**
 * The library: pick a hike, import a GPX, download a hike for offline.
 *
 * Each row shows what the walk costs — distance, climb, the Tobler estimate,
 * and how it went last time — and how ready it is for a day with no signal.
 * The offline state is checked per row rather than assumed, because the tile
 * cache is shared with the browser's own eviction policy and can disappear.
 */

import {
  cachedCount,
  corridorTiles,
  downloadGPX,
  estimateMB,
  parseGPX,
  precacheTiles,
  processTrack,
  records,
  repairElevation,
  storageUsedMB,
  store,
  toGPX,
  type Formatter,
  type ProcessedTrack,
  type Session,
} from "@slownav/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP, library, type Hike, type HikeSettings } from "./model.js";

/** A small SVG sparkline of the elevation profile, for the row. */
function Thumb({ track }: { track: ProcessedTrack }) {
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
  return (
    <svg className="thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={d} fill="#cfd9d2" stroke="#2f4f3e" strokeWidth="1" />
    </svg>
  );
}

interface OfflineState {
  have: number;
  total: number;
}

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

export function LibraryPanel({
  currentId,
  settings,
  fmt,
  onOpen,
  onClose,
  onToast,
  refreshNonce,
  onChanged,
  onPrepareSights,
  autoPrepareId,
  onAutoPrepared,
}: LibraryPanelProps) {
  const hikes = useMemo(() => library.list(), [refreshNonce]);
  const [offline, setOffline] = useState<Record<string, OfflineState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<Record<string, string>>({});
  const [progressFrac, setProgressFrac] = useState<Record<string, number>>({});
  const [storageMB, setStorageMB] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const tracks = useMemo(
    () => new Map(hikes.map((h) => [h.id, processTrack(h.pts, settings.pace)])),
    [hikes, settings.pace],
  );

  const refreshOffline = useCallback(
    async (id: string, pts: Hike["pts"]) => {
      const urls = corridorTiles(pts);
      const have = await cachedCount(urls);
      setOffline((o) => ({ ...o, [id]: { have, total: urls.length } }));
    },
    [],
  );

  useEffect(() => {
    for (const h of hikes) void refreshOffline(h.id, h.pts);
    void storageUsedMB().then(setStorageMB);
  }, [hikes, refreshOffline]);

  const prepare = useCallback(
    async (h: Hike) => {
      if (!navigator.onLine) {
        onToast("You're offline — connect to Wi-Fi first.");
        return;
      }
      setBusy(h.id);
      try {
        const track = tracks.get(h.id)!;
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
      } catch (e) {
        setProgressText((p) => ({
          ...p,
          [h.id]: `Failed: ${e instanceof Error ? e.message : String(e)}`,
        }));
      }
      setBusy(null);
    },
    [tracks, onPrepareSights, onToast, refreshOffline],
  );

  // "Prepare this hike for offline" from the menu opens the panel and starts
  // the download for that row, so it takes one tap rather than three.
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  useEffect(() => {
    if (!autoPrepareId) return;
    const h = hikes.find((x) => x.id === autoPrepareId);
    if (h) void prepareRef.current(h);
    onAutoPrepared?.();
  }, [autoPrepareId, hikes, onAutoPrepared]);

  const importFiles = async (files: FileList) => {
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
      } catch (err) {
        onToast(`${f.name}: ${err instanceof Error ? err.message : "could not be read"}`);
      }
    }
    onChanged();
  };

  return (
    <div className="panel" id="library">
      <div className="panel-head">
        <h2>My hikes</h2>
        <button className="close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="panel-body">
        {hikes.map((h) => {
          const track = tracks.get(h.id)!;
          const recs = records(APP, h.id);
          const best = recs.length ? recs[recs.length - 1] : null;
          const sess = store.get<Session>(`hike:session:${h.id}`);
          const off = offline[h.id];
          const ready = off ? off.have >= off.total * 0.95 : false;

          return (
            <div className={`hike ${h.id === currentId ? "current" : ""}`} key={h.id}>
              <div className="t">{h.name}</div>
              <div className="stats">
                {fmt.km(track.length)} · ↑ {fmt.alt(track.up)} · ↓ {fmt.alt(track.down)} ·{" "}
                {fmt.alt(track.minEle)}–{fmt.alt(track.maxEle)}
                <br />
                Est. {fmt.dur(track.tobler)} moving
                {best && (
                  <>
                    <br />
                    Last time: {fmt.dur(best.elapsed)} ({fmt.dur(best.moving)} moving),{" "}
                    {new Date(best.date).toLocaleDateString()}
                  </>
                )}
                {sess && !sess.finished && (
                  <>
                    <br />
                    <b>Session in progress</b> — {fmt.km(sess.maxProg)} done
                  </>
                )}
                <br />
                <span className={`off ${off ? (ready ? "ok" : "no") : ""}`}>
                  {!off
                    ? "checking offline maps…"
                    : ready
                      ? `Offline maps ready (${off.have} tiles)`
                      : off.have
                        ? `Offline maps ${Math.round((100 * off.have) / off.total)}% (${off.have}/${off.total} tiles)`
                        : `Not prepared for offline (${off.total} tiles, ≈ ${estimateMB(off.total)} MB)`}
                </span>
              </div>

              <Thumb track={track} />

              <div className="acts">
                {h.id !== currentId && (
                  <button className="primary" onClick={() => onOpen(h.id)}>
                    Open
                  </button>
                )}
                <button disabled={busy === h.id} onClick={() => void prepare(h)}>
                  {busy === h.id ? "Preparing…" : "Prepare offline"}
                </button>
                <button
                  onClick={() =>
                    downloadGPX(h.name, toGPX(h.name, h.pts, false, "Slow Navigator · Picos Hikes"))
                  }
                >
                  GPX
                </button>
                {!h.builtin && (
                  <button
                    className="danger"
                    onClick={() => {
                      if (!confirm(`Delete "${h.name}"?`)) return;
                      library.remove(h.id);
                      if (currentId === h.id) store.del("hike:current");
                      onChanged();
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>

              {progressText[h.id] && (
                <>
                  <div className="progress" style={{ gridColumn: "1 / -1" }}>
                    <i style={{ width: `${Math.round((progressFrac[h.id] ?? 0) * 100)}%` }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", gridColumn: "1 / -1" }}>
                    {progressText[h.id]}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel-foot">
        <input
          ref={fileInput}
          type="file"
          accept=".gpx,application/gpx+xml"
          hidden
          multiple
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button className="primary" onClick={() => fileInput.current?.click()}>
          Import GPX
        </button>
        <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
          {storageMB != null ? `Offline storage used: ${storageMB} MB` : ""}
        </span>
      </div>
    </div>
  );
}
