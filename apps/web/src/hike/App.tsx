/**
 * Picos Hikes.
 *
 * The shell: header, dashboard, map, sheet, and the two panels that slide
 * over them. Everything below this file is either a shared component or a
 * pure function; this is the only place that knows how they fit together.
 */

import {
  addRecord,
  createFormatter,
  downloadGPX,
  getProvider,
  positionAt,
  project,
  records,
  store,
  storageReport,
  suggestProvider,
  tileUrl as providerTileUrl,
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
import {
  APP,
  library,
  loadSettings,
  PREFERRED_PROVIDERS,
  saveSettings,
  type HikeSettings,
} from "./model.js";
import { positionWatcher } from "../shared/geolocation.js";
import { wantsServiceWorker } from "../shared/platform.js";
import { APP_VERSION } from "../shared/version.js";
import { onOpenedFiles } from "../shared/openedFiles.js";
import { importGpxFiles, importMessage } from "./importGpx.js";
import { useHike } from "./useHike.js";
import { useWeather } from "./useWeather.js";
import "./hike.css";

/** Keeps elapsed time and the moving average ticking between GPS fixes. */
const TICK_MS = 5000;

type Panel = "none" | "library" | "settings";

export function App() {
  const [settings, setSettings] = useState<HikeSettings>(loadSettings);
  const fmt = useMemo(() => createFormatter(settings.units), [settings.units]);
  const hike = useHike(settings);
  const { state } = hike;

  // Which base map, and the URL to actually use. A provider needing a key the
  // walker has not supplied would render a grid of broken tiles, so it falls
  // back rather than showing that.
  const start = state.track?.pts[0] ?? null;
  const provider = useMemo(() => {
    const chosen = getProvider(settings.provider);
    const key = chosen.keyName ? store.get<string>(`map:key:${chosen.keyName}`) : null;
    // A provider whose key is missing has no usable URL at all; anything else
    // the walker picked is honoured, including one whose coverage box does not
    // quite reach — the boxes are approximate and they may know better.
    if (providerTileUrl(chosen, key)) return chosen;
    return suggestProvider(start ?? [43.15, -4.75], PREFERRED_PROVIDERS);
  }, [settings.provider, start]);

  const tiles = useMemo(() => {
    const key = provider.keyName ? store.get<string>(`map:key:${provider.keyName}`) : null;
    return providerTileUrl(provider, key);
  }, [provider]);

  const [panel, setPanel] = useState<Panel>("none");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<NearbyTab>("nearby");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [compact, setCompact] = useState(() => store.get<boolean>("hike:compact") === true);
  const [mapFull, setMapFull] = useState(false);
  // Starts off: opening a hike should show the whole walk, not a close-up of
  // wherever you happen to be standing. Tapping the arrow locks on.
  const [follow, setFollow] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [centreNonce, setCentreNonce] = useState(0);
  const [resizeNonce, setResizeNonce] = useState(0);
  const [flyTo, setFlyTo] = useState<{ pos: LatLon; nonce: number } | null>(null);
  const [libraryNonce, setLibraryNonce] = useState(0);
  const [autoPrepareId, setAutoPrepareId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const { toast, show, dismiss } = useToast();
  // Empty string disables registration: inside the native shell the assets
  // are already local, and a cache over local files only adds a way for them
  // to disagree.
  const sw = useServiceWorker(wantsServiceWorker() ? `${import.meta.env.BASE_URL}sw.js` : "");

  // Chosen once: the browser API in a tab, Capacitor's plugin in the shell.
  const watcher = useMemo(() => positionWatcher(), []);

  /**
   * Whether the walker asked for GPS, as opposed to it starting itself.
   *
   * A refusal deserves a dialog when someone just tapped "Start GPS", and
   * deserves nothing louder than a toast when the app started the watch on
   * its own — otherwise a phone with location switched off would greet you
   * with an alert every single time you opened the app.
   */
  const gpsAsked = useRef(false);

  const gps = useGeolocation({
    watcher,
    onFix: hike.onFix,
    onError: (message, permanent) => {
      if (permanent && gpsAsked.current) alert(message);
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
      setFitNonce((n) => n + 1);
      if (opened?.resumed) show("Resumed this hike's session.");
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

  // ---- a route opened or shared from elsewhere on the phone ----
  //
  // Tapping a .gpx in Files or in a mail attachment is how a route actually
  // arrives, and it beats hunting through a picker for it. The shell reads
  // the file; this puts it in the library, says so, and shows the list so
  // the walk is one tap away rather than somewhere unseen.
  useEffect(
    () =>
      onOpenedFiles((files) => {
        const result = importGpxFiles(files);
        show(importMessage(result));
        setLibraryNonce((n) => n + 1);
        if (result.imported) setPanel("library");
      }),
    [show],
  );

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
      if (opened.resumed) show("Resumed this hike's session.");
      if (!store.get(`hike:sights:${id}`) && navigator.onLine) {
        void hike.loadSights(opened.hike, opened.track);
      }
    },
    [hike, show],
  );

  /**
   * Begin tracking as soon as there is a route, unless that was turned off.
   *
   * Once per app launch, never on a reopened panel — restarting the watch on
   * every render would defeat the point of stopping it when the page hides.
   */
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !settings.gpsOnOpen) return;
    if (!state.track || gps.tracking) return;
    autoStarted.current = true;
    gpsAsked.current = false;
    hike.beginSession();
    gps.start();
  }, [state.track, settings.gpsOnOpen, gps, hike]);

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
    gpsAsked.current = true;
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
    // Clear before stopping: endTracking saves, and it must find nothing.
    hike.clearSession();
    gps.stop();
    hike.endTracking();
    hike.setPreview(0);
    show(
      `Saved: ${fmt.km(rec.dist)} in ${fmt.dur(rec.elapsed)} (${fmt.dur(rec.moving)} moving)`,
      5000,
    );
  }, [state.hike, state.session, gps, hike, fmt, show]);

  const resetSession = useCallback(() => {
    if (!state.hike) return;
    if (!confirm("Clear this hike's recorded track and timers?")) return;
    hike.clearSession();
    gps.stop();
    hike.endTracking();
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
    if (!settings.showSights) return out;
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
  }, [state.waypoints, state.sights, settings.showSights]);

  // The pace the ETA has settled on, so the forecast and the arrival time on
  // the dashboard never disagree about when the walker reaches the col.
  const paceFactor =
    hike.eta && hike.eta.toblerLeft > 0 ? hike.eta.seconds / hike.eta.toblerLeft : 1;
  const weather = useWeather(state.hike?.id ?? null, state.track, state.progress, paceFactor);

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

        <div className="menu">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            ☰ Menu
          </button>
          <div className={`menu-list ${menuOpen ? "open" : ""}`}>
            <button onClick={() => { toggleGps(); setMenuOpen(false); }}>
              {gps.tracking ? "Stop GPS" : "Start GPS"}
              <small>
                {gps.tracking
                  ? "Tracking now — stops the watch and the recording"
                  : "Begins tracking and recording this walk"}
              </small>
            </button>
            <hr />
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
              <small>Map tiles and sights, for no signal</small>
            </button>
            <button onClick={() => { setPanel("settings"); setMenuOpen(false); }}>
              Base map<small>{provider.name} — tap to change</small>
            </button>
            <button onClick={() => { setPanel("settings"); setMenuOpen(false); }}>
              Settings<small>Pace, units, alerts, off-track distance</small>
            </button>
            <hr />
            <button onClick={() => { finish(); setMenuOpen(false); }}>
              Finish hike &amp; save stats
              <small>Ends the session and saves the track</small>
            </button>
            <button onClick={() => { resetSession(); setMenuOpen(false); }}>
              Reset this hike's session<small>Clears recorded track and timers</small>
            </button>
            <button onClick={() => { exportTrail(); setMenuOpen(false); }}>
              Export recorded track (GPX)
            </button>
            <hr />
            <label className="row">
              <span>Keep screen on while tracking</span>
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
            <button onClick={() => { setMenuOpen(false); alert(storageText()); }}>
              Storage &amp; saved data
              <small>What is stored, and whether anything more will fit</small>
            </button>
            <button onClick={() => { setMenuOpen(false); alert(aboutText(provider.name)); }}>
              About &amp; data sources
            </button>
            <span className="build">Build {APP_VERSION}</span>
          </div>
        </div>
      </header>

      {panel === "library" && (
        <LibraryPanel
          currentId={state.hike?.id ?? null}
          settings={settings}
          provider={provider}
          providerKey={provider.keyName ? store.get<string>(`map:key:${provider.keyName}`) : null}
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
          near={start}
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
          tileUrl={tiles ?? getProvider("opentopo").url}
          tileAttribution={provider.attribution}
          maxZoom={provider.maxZoom}
          maxNativeZoom={provider.maxNativeZoom}
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
            className={`fab ${settings.showSights ? "on" : ""}`}
            title={settings.showSights ? "Hide sights" : "Show sights"}
            aria-pressed={settings.showSights}
            onClick={() => {
              const next = { ...settings, showSights: !settings.showSights };
              setSettings(next);
              saveSettings(next);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {settings.showSights ? (
                <>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              ) : (
                <>
                  <path d="M2 12s3.5-7 10-7c2 0 3.8.7 5.3 1.6M22 12s-3.5 7-10 7c-2 0-3.8-.7-5.3-1.6" />
                  <path d="M3 3l18 18" />
                </>
              )}
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
        weather={{
          rows: weather.rows,
          status: weather.status,
          fetchedAt: weather.fetchedAt,
          savedOffline: weather.savedOffline,
          barometer: weather.barometer,
          fmt,
          onRefresh: weather.refresh,
        }}
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

/**
 * What is saved, and whether more will fit.
 *
 * A hike that imports and then is not in the list has either not been saved
 * or not been listed, and from a hillside those look the same. This says
 * which, in words that can be read back down a phone line.
 */
function storageText(): string {
  const r = storageReport();
  const lines = [
    `Saved data: ${r.totalKB} kB in ${r.top.length ? "these keys" : "nothing yet"}`,
    ...r.top.map((t) => `  ${t.key} — ${t.kB} kB`),
    "",
    r.canWrite
      ? "A test write of 64 kB succeeded, so there is room to save a hike."
      : `A test write of 64 kB FAILED: ${r.error ?? "no reason given"}`,
    "",
    `Build ${APP_VERSION}.`,
  ];
  return lines.join("\n");
}

const aboutText = (mapName: string): string => `Picos Hikes — part of Slow Navigator.
Build ${APP_VERSION}.

• Maps: ${mapName}, stored on the phone when you prepare a hike for offline. Change it in Settings.
• Sights: OpenStreetMap along the route plus Wikipedia articles nearby (English first, Spanish otherwise).
• ETA: Tobler's hiking function, calibrated to your pace after twenty minutes.
• Battery: GPS only runs while the app is on screen.

This is a planning aid, not a substitute for a map, compass and judgement in the mountains.`;
