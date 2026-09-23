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
  OFFLINE_TOP_ZOOM,
  positionAt,
  project,
  records,
  stepAt,
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
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Dashboard } from "./Dashboard.js";
import { LibraryPanel } from "./LibraryPanel.js";
import { NearbySheet, tabForSight, type NearbyTab } from "./NearbySheet.js";
import { SettingsPanel } from "./SettingsPanel.js";
import {
  APP,
  dayId,
  library,
  lineForVariant,
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
import {
  importNotes,
  clearNotes,
  loadNotes,
  loadVariant,
  placeNotes,
  saveVariant,
  type StoredNotes,
} from "./notes.js";
import { useSteps } from "./useSteps.js";
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
  /**
   * A long instruction takes the dashboard's extras rather than being cut.
   *
   * Measured rather than compared against a threshold, because the right
   * threshold differs on every screen: a 900px phone has room for the
   * longest of these notes and should keep its elevation profile, a 560px
   * one has not and should spend it.
   *
   * The measurement has to be taken with the dashboard whole, or it reads
   * the layout this very decision produced — so each one starts by putting
   * the extras back, lets that paint, and only then asks whether the
   * instruction fits. Caching the answer instead looked simpler and was
   * wrong: the first reading landed in a transient layout and stuck, hiding
   * the profile on a screen with room to spare.
   */
  const cueRef = useRef<HTMLDivElement>(null);
  const [cueTall, setCueTall] = useState(false);
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
  // Re-chosen when the background setting changes, and only then: the hook
  // compares watcher identities and restarts the watch on a real change, so
  // turning it on at a col takes effect at the col.
  const watcher = useMemo(() => positionWatcher(settings.bgGps), [settings.bgGps]);

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
    // The map gives up most of its minimum height while the sheet is open,
    // which is the only way the sheet can fit on a 740px screen at all.
    document.body.classList.toggle("sheet-open", sheetOpen);
    document.body.classList.toggle("cue-tall", cueTall);
  }, [panel, mapFull, sheetOpen, cueTall]);

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
    addRecord(APP, dayId(state.hike), rec);
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

  // ---- route notes: the walking company's own instructions ----
  //
  // Imported from a file and kept on this device. They are placed on the
  // line using the waypoints the app has already projected, so an
  // instruction that names one sits exactly on it.
  const [notes, setNotes] = useState<StoredNotes | null>(null);
  const [variant, setVariant] = useState("main");
  const notesInput = useRef<HTMLInputElement>(null);
  // Keyed to the day, not to the line: a day's harder option is a second
  // hike, and importing the same notes twice to walk it would be absurd.
  const day = dayId(state.hike);
  useEffect(() => {
    const open = state.hike;
    const loaded = open ? loadNotes(dayId(open)) : null;
    setNotes(loaded);
    if (!open) {
      setVariant("main");
      return;
    }
    // The line decides which variant is shown, when it can say: opening the
    // harder option from the library is as much a choice as tapping the
    // pill, and reading out the main route's instructions while standing on
    // the other line would be a lie the walker has no way to spot.
    const mine = library.family(open.id).findIndex((h) => h.id === open.id);
    const byLine = loaded?.variants[mine]?.id;
    const chosen = byLine ?? loadVariant(dayId(open), loaded);
    setVariant(chosen);
    if (byLine) saveVariant(dayId(open), byLine);
  }, [state.hike]);

  const noteSteps = useMemo(
    () => placeNotes(notes, state.track, state.hike?.wpts ?? []),
    [notes, state.track, state.hike],
  );
  const cue = useMemo(
    () => stepAt(noteSteps.filter((s) => s.variant === variant), state.progress),
    [noteSteps, variant, state.progress],
  );

  /**
   * The instruction on the header, which is usually the walk's but need not be.
   *
   * `stepAt` reads the step off the distance walked, and that is right until
   * the walk and the notes part company — a turn missed, a stretch covered
   * with the screen off, a variant taken that the app was not told about.
   * Reported from the hill: the cue sat on `[D]` for a long time with no way
   * to move it on, which is the worst version of this, because the one
   * instruction on the screen is then confidently wrong.
   *
   * So the arrows hold a step of the walker's choosing. The hold is released
   * by the walk catching up with it, or by the button that says so — never
   * silently, because a cue that sprang back while being read would be worse
   * than one that is stuck.
   */
  const [heldStep, setHeldStep] = useState<number | null>(null);
  const shown = useMemo(() => noteSteps.filter((s) => s.variant === variant), [noteSteps, variant]);
  const liveIndex = cue.current ? shown.indexOf(cue.current) : -1;
  useEffect(() => setHeldStep(null), [state.hike, variant]);
  useEffect(() => {
    // The walk has reached what was being held: hand it back.
    if (heldStep != null && liveIndex >= heldStep) setHeldStep(null);
  }, [liveIndex, heldStep]);

  /**
   * Stepping by swipe rather than by buttons.
   *
   * The arrows were two 40px targets either side of the one thing on the
   * screen worth reading, on a line the walker has to take in at a junction.
   * A swipe costs no width at all, and the text can have the lot.
   *
   * Dragged live rather than snapping on release: the card following the
   * thumb is the whole affordance, since nothing on screen now says the
   * gesture exists. Damped past the threshold so it never slides off.
   */
  const [drag, setDrag] = useState(0);
  const swipe = useRef<{ x: number; y: number; at: number } | null>(null);

  /**
   * Long enough without a usable fix that the route position is history.
   *
   * Two minutes is twenty-odd fixes at the rate they normally arrive, and a
   * walker covers 140 m in it — about the point where the distance to the
   * next instruction stops being a number worth believing.
   */
  const stale = state.mode === "gps" && state.heldFor > 120;
  const cueIndex = heldStep ?? liveIndex;
  const cueStep = shown[cueIndex] ?? null;
  const cueNext = shown[cueIndex + 1] ?? null;
  // The list in the sheet scrolls to whatever the header is showing, so the
  // arrows move both and the two never disagree about where the walker is.
  const currentIndex = cueStep ? noteSteps.indexOf(cueStep) : -1;

  // The next-waypoint row is what the dashboard had before there was a cue.
  // With one on screen it is a second answer to the same question, one row
  // lower and less specific. Set here rather than with the other body
  // classes because it depends on the cue, which is worked out below them.
  useEffect(() => {
    document.body.classList.toggle("has-cue", cueStep != null);
  }, [cueStep]);

  const measureCue = useCallback(() => {
    const el = cueRef.current;
    if (!el) return;
    // Take the class off, read, put it back: reading a layout property
    // forces the browser to recompute, so this sees the room the cue would
    // have with the dashboard whole, in one pass and without a frame in
    // between for anything to be painted in. Going through React and a
    // requestAnimationFrame instead is a race — the frame can arrive before
    // the state has committed, and then the reading is of the layout this
    // decision produced rather than of the one it needs.
    const was = document.body.classList.contains("cue-tall");
    document.body.classList.remove("cue-tall");
    const fits = el.scrollHeight <= el.clientHeight;
    if (was) document.body.classList.add("cue-tall");
    setCueTall(!fits);
  }, []);

  /**
   * Re-measured whenever the cue's ceiling could have moved.
   *
   * Every trigger here is state this component already holds, which is the
   * point: watching the dashboard's size instead would catch the change this
   * very decision causes, and flap. The sheet is in the list because opening
   * it takes the profile away too — a measurement from that moment said the
   * instruction fitted, and it was still saying so long after the sheet had
   * closed and taken the room back.
   */
  useEffect(() => {
    if (panel !== "none") return;
    measureCue();
  }, [cueStep, sheetOpen, compact, mapFull, panel, measureCue]);

  useEffect(() => {
    const again = () => measureCue();
    // The sheet's height is animated, so a measurement taken when it opens
    // or closes reads a layout that is still moving — 19px of cue, in the
    // middle of a 250ms transition, which says nothing fits and then stands
    // for the rest of the walk. This is the one that gets it right.
    const settled = (e: TransitionEvent) => {
      if (e.propertyName === "max-height") measureCue();
    };
    window.addEventListener("resize", again);
    window.addEventListener("orientationchange", again);
    document.addEventListener("transitionend", settled);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("orientationchange", again);
      document.removeEventListener("transitionend", settled);
    };
  }, [measureCue]);

  const stepCue = useCallback(
    (delta: number) => {
      setHeldStep((held) => {
        const from = held ?? liveIndex;
        return Math.max(0, Math.min(shown.length - 1, from + delta));
      });
    },
    [liveIndex, shown.length],
  );

  /** Past this, in pixels, a drag was meant as a swipe. */
  const SWIPE_MIN = 44;

  const onCuePointerDown = useCallback((e: ReactPointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY, at: Date.now() };
  }, []);

  const onCuePointerMove = useCallback((e: ReactPointerEvent) => {
    const from = swipe.current;
    if (!from) return;
    const dx = e.clientX - from.x;
    // A vertical gesture belongs to the page, not to the cue: let it go the
    // moment it looks like one, rather than fighting a scroll.
    if (Math.abs(e.clientY - from.y) > Math.abs(dx)) {
      swipe.current = null;
      setDrag(0);
      return;
    }
    // Damped beyond the threshold, so the end of the notes feels like an end.
    setDrag(Math.abs(dx) <= SWIPE_MIN ? dx : Math.sign(dx) * (SWIPE_MIN + (Math.abs(dx) - SWIPE_MIN) * 0.3));
  }, []);

  const onCuePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const from = swipe.current;
      swipe.current = null;
      setDrag(0);
      if (!from) return;
      const dx = e.clientX - from.x;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(e.clientY - from.y) > Math.abs(dx)) return;
      // Left takes you forward, the way a page turns.
      stepCue(dx < 0 ? 1 : -1);
    },
    [stepCue],
  );

  /**
   * Choose which line of the day the walker is on.
   *
   * Both a notes choice and a route change. A day that forks ships as two
   * hikes — one GPX document is one line to the map-matcher — so the pill in
   * the Route notes tab has to open the other one. The notes, the choice and
   * the session all hang off the day, so nothing is re-imported and nothing
   * recorded is lost — and `openHike` sees that this is a swap rather than a
   * resume, so the tracker finds the walker on the new line instead of
   * trusting a distance measured along the old one.
   *
   * A day with no separate line for that variant (notes with three sections,
   * a day that ships two) just changes which instructions are shown, which is
   * what this did before there was a second line at all.
   */
  const chooseVariant = useCallback(
    (id: string) => {
      setVariant(id);
      if (day) saveVariant(day, id);
      const current = state.hike;
      if (!current || !notes) return;
      const line = lineForVariant(
        library.family(current.id),
        notes.variants.map((v) => v.id),
        id,
      );
      if (!line || line === current.id) return;
      const opened = hike.openHike(line);
      if (!opened) return;
      setFitNonce((n) => n + 1);
      show(`Now on ${opened.hike.name}.`);
      if (!store.get(`hike:sights:${line}`) && navigator.onLine) {
        void hike.loadSights(opened.hike, opened.track);
      }
    },
    [day, notes, state.hike, hike, show],
  );

  // The pace the ETA has settled on, so the forecast and the arrival time on
  // the dashboard never disagree about when the walker reaches the col.
  const paceFactor =
    hike.eta && hike.eta.toblerLeft > 0 ? hike.eta.seconds / hike.eta.toblerLeft : 1;
  const weather = useWeather(state.hike?.id ?? null, state.track, state.progress, paceFactor);

  const steps = useSteps({
    tracking: gps.tracking,
    enabled: settings.steps,
    heldFor: state.mode === "gps" ? state.heldFor : 0,
    dist: state.session?.dist ?? 0,
  });

  /**
   * One buzz as each instruction becomes the current one.
   *
   * The cue answers "what now" better than anything else on the screen, and
   * this is what makes it answerable without looking: a walker with the phone
   * in a pocket gets told there is something to read, at the junction rather
   * than fifty metres past it. Two pulses for a step carrying a warning,
   * because CAREFUL deserves to be distinguishable from "turn R".
   *
   * Only forwards, and only while tracking. The preview slider walks the
   * whole day in a second and would buzz its way through every instruction;
   * a cue going backwards is the walk being re-matched, not a junction.
   */
  const buzzedAt = useRef<number | null>(null);
  useEffect(() => {
    buzzedAt.current = null;
  }, [state.hike, variant]);
  useEffect(() => {
    if (state.mode !== "gps" || !settings.cueVib) {
      buzzedAt.current = null;
      return;
    }
    if (liveIndex < 0) return;
    const was = buzzedAt.current;
    buzzedAt.current = liveIndex;
    // Nothing on the first instruction the walk lands on: there is no
    // junction behind it, and a buzz as the app opens is only a surprise.
    if (was == null || liveIndex <= was) return;
    const step = shown[liveIndex];
    if (!step) return;
    navigator.vibrate?.(step.notes.some((n) => n.warning) ? [120, 90, 120] : [120]);
  }, [liveIndex, shown, settings.cueVib, state.mode]);

  /**
   * The altitude worth putting on the dashboard.
   *
   * Reported from the hill: the dashboard tile and the weather tab's
   * barometer showed different numbers. They are different instruments — a
   * GPS fix is routinely 10–30 m out vertically, which is why the barometer
   * is read at all — but only one screen said so.
   *
   * Only a *calibrated* reading is preferred. Without a sea-level pressure to
   * work from, a pressure altitude can be a couple of hundred metres out, and
   * putting that on the dashboard as if it were a position is the one thing
   * the barometer must never be allowed to do.
   */
  const betterAltitude = useMemo(
    () =>
      weather.barometer.calibrated && weather.barometer.altitudeM != null
        ? { metres: weather.barometer.altitudeM, source: "barometer" }
        : null,
    [weather.barometer.calibrated, weather.barometer.altitudeM],
  );

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

      {cueStep && (
        <div
          ref={cueRef}
          className={`cue${cueStep.notes.some((n) => n.warning) ? " warn" : ""}${heldStep != null ? " held" : ""}`}
          // Swiped, not tapped — but still reachable from a keyboard, which
          // is all the arrow buttons were doing for anyone who needed them.
          role="group"
          aria-label={`Instruction ${cueIndex + 1} of ${shown.length}`}
          tabIndex={0}
          onPointerDown={onCuePointerDown}
          onPointerMove={onCuePointerMove}
          onPointerUp={onCuePointerUp}
          onPointerCancel={() => {
            swipe.current = null;
            setDrag(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") stepCue(1);
            else if (e.key === "ArrowLeft") stepCue(-1);
            else return;
            e.preventDefault();
          }}
        >
          <div
            className={`cue-body${drag !== 0 ? " dragging" : ""}`}
            style={{ transform: `translateX(${drag}px)` }}
          >
            {cueStep.ref ? <strong className="note-ref">{cueStep.ref}</strong> : null}
            <span className="cue-text">{cueStep.text}</span>
          </div>
          <div className="cue-foot">
            {/* Where this instruction is relative to the walker, not just
                where the next one is. A cue that has stopped advancing then
                says so — "1.8 km back" — instead of looking current.

                And when the fixes have been too vague to place for a while,
                that distance is measured from where the walker was before the
                signal went, not from where they are. Saying so is the whole
                difference between a cue that is stale and a cue that is
                confidently wrong — which is what "stuck at [D]" felt like. */}
            <span className={`cue-dist${stale ? " stale" : ""}`}>
              {stale
                ? `position ${fmt.dur(state.heldFor)} old`
                : cueStep.prog == null
                  ? "not on this line"
                  : cueStep.prog >= state.progress
                    ? `in ${fmt.dist(cueStep.prog - state.progress)}`
                    : `${fmt.dist(state.progress - cueStep.prog)} back`}
            </span>
            {heldStep != null ? (
              <button className="cue-live" onClick={() => setHeldStep(null)}>
                Back to live
              </button>
            ) : stale ? (
              // How far the step counter says the walker has come since the
              // position was last known. It takes the slot "next 300 m" had,
              // because that distance is measured from the stale position and
              // means nothing while this one does. Offered, never applied: the
              // walker swipes the cue on if it looks right.
              steps.heldDistance != null &&
              steps.heldDistance >= 50 && (
                <span className="cue-dist stale">≈{fmt.dist(steps.heldDistance)} walked</span>
              )
            ) : (
              cueNext?.prog != null && (
                <span className="cue-dist">next {fmt.dist(cueNext.prog - state.progress)}</span>
              )
            )}
          </div>
        </div>
      )}

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
        altitude={betterAltitude}
        steps={steps.available ? steps : null}
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
          // Never ask for a tile "Prepare offline" would not have saved: past
          // this the map upscales what is cached — soft, but never the blank
          // screen that was reported from the hill.
          maxNativeZoom={Math.min(provider.maxNativeZoom, OFFLINE_TOP_ZOOM)}
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
        notes={{
          notes,
          steps: noteSteps,
          progress: state.progress,
          currentIndex,
          fmt,
          variant,
          onVariant: chooseVariant,
          onImport: () => notesInput.current?.click(),
          onForget: () => {
            if (!day) return;
            clearNotes(day);
            setNotes(null);
            show("Route notes removed from this phone.");
          },
        }}
        onShowOnMap={(s) => {
          setFollow(false);
          setFlyTo({ pos: [s.lat, s.lon], nonce: Date.now() });
        }}
      />

      {/* Unfiltered, for the same reason the GPX picker is: Android greys
          out a file whose type it cannot agree on. */}
      <input
        ref={notesInput}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !day) return;
          void file.text().then((text) => {
            const result = importNotes(day, text);
            show(result.message);
            if (!result.ok) return;
            setNotes(result.notes);
            setVariant(loadVariant(day, result.notes));
          });
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
