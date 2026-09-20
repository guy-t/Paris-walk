/**
 * Picos Hikes.
 *
 * The shell: header, dashboard, map, sheet, and the two panels that slide
 * over them. Everything below this file is either a shared component or a
 * pure function; this is the only place that knows how they fit together.
 */

import {
  addRecord,
  clearSession as clearStoredSession,
  createFormatter,
  downloadGPX,
  positionAt,
  project,
  records,
  store,
  toGPX,
  toRecord,
  type LatLon,
  type RecordedPoint,
} from "@slownav/core";
import {
  MapView,
  Toast,
  UpdateToast,
  useGeolocation,
  useServiceWorker,
  useToast,
  useWakeLock,
  type MapMarker,
} from "@slownav/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dashboard } from "./Dashboard.js";
import { LibraryPanel } from "./LibraryPanel.js";
import { NearbySheet, tabForSight, type NearbyTab } from "./NearbySheet.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { APP, library, loadSettings, saveSettings, type HikeSettings } from "./model.js";
import { useHike } from "./useHike.js";
import "./hike.css";

const TILE_URL = "https://a.tile.opentopomap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  'Map: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · data © OpenStreetMap';

/** Keeps elapsed time and the moving average ticking between GPS fixes. */
const TICK_MS = 5000;

type Panel = "none" | "library" | "settings";

export function App() {
  const [settings, setSettings] = useState<HikeSettings>(loadSettings);
  const fmt = useMemo(() => createFormatter(settings.units), [settings.units]);
  const hike = useHike(settings);
  const { state } = hike;

  const [panel, setPanel] = useState<Panel>("none");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<NearbyTab>("nearby");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [compact, setCompact] = useState(() => store.get<boolean>("hike:compact") === true);
  const [mapFull, setMapFull] = useState(false);
  const [follow, setFollow] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const [centreNonce, setCentreNonce] = useState(0);
  const [resizeNonce, setResizeNonce] = useState(0);
  const [flyTo, setFlyTo] = useState<{ pos: LatLon; nonce: number } | null>(null);
  const [libraryNonce, setLibraryNonce] = useState(0);
  const [autoPrepareId, setAutoPrepareId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const { toast, show, dismiss } = useToast();
  const sw = useServiceWorker(`${import.meta.env.BASE_URL}sw.js`);

  const gps = useGeolocation({
    onFix: hike.onFix,
    onError: (message, permanent) => {
      if (permanent) alert(message);
      else show(message);
    },
    onResume: hike.resumeTracking,
  });
  useWakeLock(settings.wake && gps.tracking);

  // ---- boot: the hike we were on, or the library if there is none ----
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const current = store.get<string>("hike:current");
    if (current && library.get(current)) {
      const opened = hike.openHike(current);
      if (opened?.resumed) {
        show("Resumed this hike's session — press GPS to continue tracking.");
      }
      if (opened && !opened.hike.pts.length) return;
      if (opened && !store.get(`hike:sights:${current}`) && navigator.onLine) {
        void hike.loadSights(opened.hike, opened.track);
      }
    } else {
      setPanel("library");
    }
  }, [hike, show]);

  // ---- a slow tick, so elapsed time moves without a GPS fix ----
  useEffect(() => {
    if (state.mode !== "gps" || !state.session) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [state.mode, state.session]);

  // ---- close the menu on any outside tap ----
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".menu")) setMenuOpen(false);
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

  const openHike = useCallback(
    (id: string) => {
      const opened = hike.openHike(id);
      setPanel("none");
      setFitNonce((n) => n + 1);
      if (!opened) return;
      if (opened.resumed) show("Resumed this hike's session — press GPS to continue tracking.");
      if (!store.get(`hike:sights:${id}`) && navigator.onLine) {
        void hike.loadSights(opened.hike, opened.track);
      }
    },
    [hike, show],
  );

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
    show(
      `Saved: ${fmt.km(rec.dist)} in ${fmt.dur(rec.elapsed)} (${fmt.dur(rec.moving)} moving)`,
      5000,
    );
  }, [state.hike, state.session, gps, hike, fmt, show]);

  const resetSession = useCallback(() => {
    if (!state.hike) return;
    if (!confirm("Clear this hike's recorded track and timers?")) return;
    gps.stop();
    clearStoredSession(APP, state.hike.id);
    hike.endTracking();
    hike.clearSession();
    hike.setPreview(0);
    show("Session cleared");
  }, [state.hike, gps, hike, show]);

  const exportTrail = useCallback(() => {
    const trail: RecordedPoint[] | undefined = state.session?.trail.length
      ? state.session.trail
      : records(APP, state.hike?.id ?? "").slice(-1)[0]?.trail;
    if (!trail?.length || !state.hike) {
      show("No recorded track yet.");
      return;
    }
    downloadGPX(
      `${state.hike.name}_recorded`,
      toGPX(`${state.hike.name} (recorded)`, trail, true, "Slow Navigator · Picos Hikes"),
    );
  }, [state.session, state.hike, show]);

  // ---- what the map draws ----
  const doneUpTo = useMemo(() => {
    if (!state.track) return undefined;
    const { idx, pos } = positionAt(state.track.pts, state.track.cum, state.progress);
    return [...state.track.pts.slice(0, idx + 1), pos];
  }, [state.track, state.progress]);

  const markers = useMemo((): MapMarker[] => {
    const out: MapMarker[] = state.waypoints.map((w, i) => ({
      id: `wp/${i}`,
      lat: w.lat,
      lon: w.lon,
      kind: "wp",
      label: /^\d+$/.test(w.name) ? w.name : w.name.slice(0, 2) || String(i + 1),
      popup: `<b>${escapeHtml(w.name)}</b>${w.desc ? `<br>${escapeHtml(w.desc)}` : ""}`,
    }));
    for (const s of state.sights ?? []) {
      // Villages are context, not destinations; a pin for each would bury the map.
      if (s.group === "place") continue;
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

  const trail = useMemo(
    () => state.session?.trail.map((p) => [p[0], p[1]] as LatLon),
    [state.session],
  );

  return (
    <>
      <header className="bar">
        <h1 onClick={() => setPanel("library")} title="Choose a hike">
          {state.hike?.name ?? "Picos Hikes"}
        </h1>

        <button
          className={gps.tracking ? "on" : gps.status === "starting" ? "busy" : ""}
          onClick={toggleGps}
          title="Track my position"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            <circle cx="12" cy="12" r="8" />
          </svg>
          <span>GPS</span>
        </button>

        <div className="menu">
          <button onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }} title="More">
            ⋯
          </button>
          <div className={`menu-list ${menuOpen ? "open" : ""}`}>
            <button onClick={() => { setPanel("library"); setMenuOpen(false); }}>
              My hikes<small>Choose, import, prepare for offline</small>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setPanel("library");
                if (state.hike) setAutoPrepareId(state.hike.id);
              }}
            >
              Prepare this hike for offline
              <small>Downloads map tiles and sights for the route</small>
            </button>
            <button onClick={() => { setPanel("settings"); setMenuOpen(false); }}>
              Settings<small>Pace, units, alerts</small>
            </button>
            <hr />
            <button onClick={() => { finish(); setMenuOpen(false); }}>
              Finish hike &amp; save stats
              <small>Ends the session and stores the recorded track</small>
            </button>
            <button onClick={() => { resetSession(); setMenuOpen(false); }}>
              Reset this hike's session<small>Clears recorded track and timers</small>
            </button>
            <button onClick={() => { exportTrail(); setMenuOpen(false); }}>
              Export recorded track (GPX)
            </button>
            <hr />
            <label className="row">
              <span style={{ color: "var(--ink)", fontSize: 14 }}>Keep screen on while tracking</span>
              <input
                type="checkbox"
                checked={settings.wake}
                onChange={(e) => {
                  const next = { ...settings, wake: e.target.checked };
                  setSettings(next);
                  saveSettings(next);
                }}
              />
            </label>
            <hr />
            <button onClick={() => { setMenuOpen(false); alert(ABOUT); }}>
              About &amp; data sources
            </button>
          </div>
        </div>
      </header>

      {panel === "library" && (
        <LibraryPanel
          currentId={state.hike?.id ?? null}
          settings={settings}
          fmt={fmt}
          onOpen={openHike}
          onClose={() => setPanel("none")}
          onToast={show}
          refreshNonce={libraryNonce}
          onChanged={() => setLibraryNonce((n) => n + 1)}
          onPrepareSights={hike.loadSights}
          autoPrepareId={autoPrepareId}
          onAutoPrepared={() => setAutoPrepareId(null)}
        />
      )}

      {panel === "settings" && (
        <SettingsPanel
          settings={settings}
          onClose={() => setPanel("none")}
          onSave={(next) => {
            setSettings(next);
            saveSettings(next);
            setPanel("none");
            // The pace feeds the Tobler profile, so the track is re-measured.
            if (state.hike) openHike(state.hike.id);
            show("Settings saved");
          }}
        />
      )}

      <Dashboard
        state={state}
        eta={hike.eta}
        fmt={fmt}
        settings={settings}
        compact={compact || mapFull}
        onCompact={(v) => {
          setCompact(v);
          store.set("hike:compact", v);
        }}
        onScrub={hike.setPreview}
        tick={tick}
      />

      <div className="mapwrap">
        <MapView
          planned={state.track?.pts}
          doneUpTo={doneUpTo}
          trail={trail}
          markers={markers}
          position={state.pos}
          accuracy={state.mode === "gps" ? state.accuracy : null}
          tileUrl={TILE_URL}
          tileAttribution={TILE_ATTRIBUTION}
          imperialScale={settings.units === "imperial"}
          follow={follow}
          onUserPan={() => setFollow(false)}
          onMapClick={(pos) => {
            // Tapping the track moves the preview; tapping empty map does
            // nothing, so a stray thumb cannot teleport the walker.
            if (!state.track || state.mode !== "preview") return;
            const m = project(state.track.pts, state.track.cum, pos, { global: true });
            if (m && m.dist < 200) hike.setPreview(m.prog);
          }}
          fitNonce={fitNonce}
          centreNonce={centreNonce}
          resizeNonce={resizeNonce}
          flyTo={flyTo}
        />

        {state.mode === "preview" && state.track && !mapFull && (
          <div className="map-note">Preview: tap the track or profile to move. Press GPS to start.</div>
        )}

        <div className="map-fabs">
          <button
            className={`fab ${follow ? "on" : ""}`}
            title="Keep the map on me"
            onClick={() => {
              setFollow(true);
              setCentreNonce((n) => n + 1);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />
            </svg>
          </button>
          <button
            className={`fab ${mapFull ? "on" : ""}`}
            title="Full-screen map"
            onClick={() => {
              setMapFull((f) => !f);
              setResizeNonce((n) => n + 1);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
          <button
            className="fab"
            title="Whole hike"
            onClick={() => {
              setFollow(false);
              setFitNonce((n) => n + 1);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
            </svg>
          </button>
        </div>
      </div>

      <NearbySheet
        sights={state.sights}
        status={state.sightsStatus}
        progress={state.progress}
        position={state.pos}
        fmt={fmt}
        open={sheetOpen}
        onToggle={setSheetOpen}
        tab={tab}
        onTab={setTab}
        expandedIds={expanded}
        onExpand={(id) =>
          setExpanded((e) => {
            const next = new Set(e);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onShowOnMap={(s) => {
          setFollow(false);
          setFlyTo({ pos: [s.lat, s.lon], nonce: Date.now() });
        }}
      />

      <Toast toast={toast} onDismiss={dismiss} />
      <UpdateToast available={sw.updateAvailable} onReload={sw.applyUpdate} />
    </>
  );
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

const ABOUT = `Picos Hikes — part of Slow Navigator.

• Maps: OpenTopoMap (CC-BY-SA), stored on the phone when you prepare a hike for offline.
• Sights: OpenStreetMap along the route plus Wikipedia articles nearby (English first, Spanish otherwise).
• ETA: Tobler's hiking function, calibrated to your pace after twenty minutes.
• Battery: GPS only runs while the app is on screen.

This is a planning aid, not a substitute for a map, compass and judgement in the mountains.`;
