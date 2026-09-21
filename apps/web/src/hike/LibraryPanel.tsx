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
  sourceForProvider,
  downloadGPX,
  estimateMB,
  precacheTiles,
  processTrack,
  records,
  storageUsedMB,
  store,
  toGPX,
  type Formatter,
  type MapProvider,
  type ProcessedTrack,
  type Session,
  type TileSource,
} from "@slownav/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP, library, type Hike, type HikeSettings } from "./model.js";
import { gpxAccept } from "../shared/platform.js";
import { importGpxFiles, importMessage } from "./importGpx.js";
import { refreshForecast } from "./weather.js";

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
  /** The base map in use — offline downloads must match what is displayed. */
  provider: MapProvider;
  /** Its API key, if it needs one. */
  providerKey?: string | null;
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
  provider,
  providerKey,
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

  // Tiles are cached by URL, so each provider is counted and downloaded
  // separately — switching map does not silently claim the new one is
  // already downloaded because the old one was.
  const source: TileSource | null = useMemo(
    () => sourceForProvider(provider, providerKey),
    [provider, providerKey],
  );

  const urlsFor = useCallback(
    (pts: Hike["pts"]) => (source ? corridorTiles(pts, source) : []),
    [source],
  );

  const refreshOffline = useCallback(
    async (id: string, pts: Hike["pts"]) => {
      const urls = urlsFor(pts);
      const have = await cachedCount(urls);
      setOffline((o) => ({ ...o, [id]: { have, total: urls.length } }));
    },
    [urlsFor],
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
        // The forecast too, while there is still signal — it is the thing
        // most obviously wanted on the hill and least obtainable there. It
        // is small and it is a bonus: a weather service having an afternoon
        // must not stop the map downloading.
        setProgressText((p) => ({ ...p, [h.id]: "Getting the forecast…" }));
        await refreshForecast(h.id, track).catch(() => undefined);

        const urls = urlsFor(h.pts);
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
    [tracks, onPrepareSights, onToast, refreshOffline, urlsFor],
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

  /**
   * Import whatever was picked.
   *
   * The picker is unfiltered on a phone (see `gpxAccept`), so anything at
   * all can arrive here — being handed something that is not a GPX is a
   * normal outcome, not a surprise. What happens to the contents is shared
   * with routes opened from outside the app, so the two cannot drift.
   */
  const importFiles = async (files: FileList) => {
    const incoming = await Promise.all(
      Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() })),
    );
    onToast(importMessage(importGpxFiles(incoming)));
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
                        : `Not prepared for offline (${off.total} tiles, ≈ ${estimateMB(off.total, provider.tileKB)} MB)`}
                </span>
              </div>

              <Thumb track={track} />

              <div className="acts">
                {/*
                  The hike already open needs a way back, not an Open. It had
                  neither: "Prepare this hike for offline" in the menu sends
                  the walker straight to this row, and it was the one row
                  with no button to leave by — only the ✕ at the top of the
                  panel, which is not what anyone looks for after a download
                  finishes.

                  Back rather than re-open: the hike is already loaded, so
                  closing the panel is the whole job and cannot disturb a
                  session in progress.
                */}
                {h.id === currentId ? (
                  <button className="primary" onClick={onClose}>
                    Back to hike
                  </button>
                ) : (
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
        {/* accept is undefined on a phone, where a filter greys the file out. */}
        <input
          ref={fileInput}
          type="file"
          accept={gpxAccept()}
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
