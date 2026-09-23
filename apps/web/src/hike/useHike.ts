/**
 * The hiking app's state, and the wiring between a GPS fix and the dashboard.
 *
 * One state object with a `patch` updater, which is the same shape the
 * single-file version used — it keeps the flow of a fix readable in one
 * place: match it to the track, fold it into the session, save occasionally.
 */

import {
  applyFix,
  cachedCount,
  clearSession as clearStoredSession,
  corridorTiles,
  hikeTracker,
  loadSession,
  newSession,
  positionAt,
  saveSession as persistSession,
  store,
  HIKE_MATCH,
  type Fix,
  type LatLon,
  type ProcessedTrack,
  type RouteTracker,
  type Session,
} from "@slownav/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APP,
  dayId,
  eta,
  library,
  prepare,
  waypointsAlong,
  type Hike,
  type HikeSettings,
  type WaypointAt,
} from "./model.js";
import { buildSights, fetchSights, fetchWiki, type Sight } from "./sights.js";

export type SightsStatus = "idle" | "loading" | "ok" | "error";
export type Mode = "preview" | "gps";

export interface HikeState {
  hike: Hike | null;
  track: ProcessedTrack | null;
  waypoints: WaypointAt[];
  sights: Sight[] | null;
  sightsStatus: SightsStatus;
  mode: Mode;
  /** Metres along the track. */
  progress: number;
  pos: LatLon | null;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  offTrack: boolean;
  offDistance: number;
  offBearing: number | null;
  /** The last fix was too vague to place on the track. */
  weak: boolean;
  /** Seconds since the route position last came from a fix. */
  heldFor: number;
  session: Session | null;
  tiles: { have: number; total: number } | null;
}

const INITIAL: HikeState = {
  hike: null,
  track: null,
  waypoints: [],
  sights: null,
  sightsStatus: "idle",
  mode: "preview",
  progress: 0,
  pos: null,
  accuracy: null,
  altitude: null,
  speed: null,
  heading: null,
  offTrack: false,
  offDistance: 0,
  offBearing: null,
  weak: false,
  heldFor: 0,
  session: null,
  tiles: null,
};

/** Save the session at most this often — cheap insurance against a browser kill. */
const SAVE_EVERY_MS = 20000;
/** At most one off-track buzz a minute; more would be nagging. */
const VIBRATE_EVERY_MS = 60000;

export function useHike(settings: HikeSettings) {
  const [state, setState] = useState<HikeState>(INITIAL);
  const patch = useCallback((p: Partial<HikeState>) => setState((s) => ({ ...s, ...p })), []);

  // Held in refs because a GPS fix must not depend on a re-render having
  // happened, and because the tracker carries its own confirmation counters.
  const tracker = useRef<RouteTracker | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const lastSaved = useRef(0);
  const lastVibrated = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // A mirror of state, for callbacks that must stay stable across renders.
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Open a hike: measure it, restore the day's session, start loading sights. */
  const openHike = useCallback(
    (id: string) => {
      const hike = library.get(id);
      if (!hike) return;

      // Flush the outgoing session before anything replaces it. Saves are
      // otherwise every 20 seconds, so switching lines mid-walk dropped
      // whatever had accrued since the last one.
      const leaving = stateRef.current.hike;
      if (leaving && sessionRef.current) {
        persistSession(APP, dayId(leaving), sessionRef.current);
      }

      const track = prepare(hike, settingsRef.current.pace);
      const waypoints = waypointsAlong(track, hike.wpts ?? []);
      store.set("hike:current", id);

      const session = loadSession(APP, dayId(hike));
      const sights = store.get<Sight[]>(`hike:sights:${id}`);
      const progress = session ? session.maxProg : 0;

      sessionRef.current = session;
      tracker.current = hikeTracker(track.pts, track.cum, HIKE_MATCH, {
        offThreshold: settingsRef.current.off,
      });
      // Swapping to the other line of the same day, at a signpost, is a
      // relocation and not a resume. The session carries over, because it is
      // the same walk, but the tracker is left unanchored so the first fix
      // searches the whole new line and places the walker where they
      // actually are. Anchoring would aim it at a distance measured along
      // the line just left: right at the branch, where the two share their
      // first kilometres, and increasingly wrong anywhere else.
      const swapped = leaving != null && leaving.id !== id && dayId(leaving) === dayId(hike);
      // Everything else starts where the hike says: what the session reached,
      // or the start of the line for a hike being opened fresh.
      //
      // That second half is not a nicety. Left unanchored, the first fix
      // searched the whole line with no preference, and a day-3 circuit
      // begins and ends 64 m apart — so a first fix 30–60 m out, which is
      // ordinary before the GNSS has settled, could land on the *finish*.
      // Reported from the hill: day 3 loaded and snapped to the end. It then
      // stayed there, because the return leg runs alongside the outward one,
      // so the windowed match kept succeeding and the jump path was never
      // asked. Measured on day 3 from the trailhead with 100 m fixes, it
      // happened 21 times in 200; anchored at 0 it happens once in 400, and
      // recovers within the first kilometre.
      //
      // A walker who really does open the app half way along loses nothing:
      // the jump path finds them in three fixes, measured at 15 seconds from
      // 4 km and from 9 km along.
      if (!swapped) tracker.current.anchor(progress);

      setState({
        ...INITIAL,
        hike,
        track,
        waypoints,
        sights,
        sightsStatus: sights ? "ok" : "idle",
        session,
        progress,
        pos: positionAt(track.pts, track.cum, progress).pos,
      });

      // How much of this hike's map is already downloaded.
      const urls = corridorTiles(hike.pts);
      void cachedCount(urls).then((have) => patch({ tiles: { have, total: urls.length } }));

      return { hike, track, resumed: session != null && !swapped };
    },
    [patch],
  );

  /** Move the walker manually, in preview mode. */
  const setPreview = useCallback((metres: number) => {
    setState((s) => {
      if (!s.track) return s;
      const p = Math.max(0, Math.min(s.track.length, metres));
      // While tracking, the slider only scrolls the view: the GPS decides
      // where we are, and letting a drag override it would be a lie.
      if (s.mode === "gps") return { ...s, progress: p };
      return { ...s, progress: p, pos: positionAt(s.track.pts, s.track.cum, p).pos, offTrack: false };
    });
  }, []);

  /** Write the live session to storage, under the day it belongs to. */
  const save = useCallback(() => {
    const id = dayId(stateRef.current.hike);
    const s = sessionRef.current;
    if (id && s) persistSession(APP, id, s);
  }, []);

  /** Fold one GPS fix into the app. */
  const onFix = useCallback(
    (fix: Fix) => {
      const t = tracker.current;
      if (!t) return;
      const before = t.progress;
      const next = t.update(fix);

      if (next.weak) {
        patch({
          mode: "gps",
          pos: next.pos,
          accuracy: next.accuracy,
          weak: true,
          heldFor: next.heldFor,
        });
        return;
      }

      const session = sessionRef.current ?? newSession(fix.timestamp);
      sessionRef.current = session;
      applyFix(session, {
        fix,
        progress: next.progress,
        previousProgress: before,
        speed: next.speed,
      });

      // A fix whose own accuracy explains the distance is not evidence of a
      // detour. The tracker still treats it as off-route — that is how a bad
      // match gets escalated to a search of the whole line, and widening the
      // threshold instead measurably worsened the position — but the walker
      // is not told, because a banner and a buzz on a third of the fixes
      // through a weak stretch teach them to ignore both.
      const strayed =
        next.offRoute && next.offDistance > Math.max(settingsRef.current.off, next.accuracy);

      if (
        strayed &&
        settingsRef.current.vib &&
        navigator.vibrate &&
        fix.timestamp - lastVibrated.current > VIBRATE_EVERY_MS
      ) {
        navigator.vibrate([200, 100, 200]);
        lastVibrated.current = fix.timestamp;
      }

      patch({
        mode: "gps",
        pos: next.pos,
        accuracy: next.accuracy,
        altitude: next.altitude,
        speed: next.speed,
        heading: next.heading,
        progress: next.progress,
        offTrack: strayed,
        offDistance: next.offDistance,
        offBearing: next.offBearing,
        weak: false,
        heldFor: next.heldFor,
        // A new object each time, so React sees the session changed.
        session: { ...session },
      });

      if (fix.timestamp - lastSaved.current > SAVE_EVERY_MS) {
        lastSaved.current = fix.timestamp;
        save();
      }
    },
    [patch, save],
  );

  /** Begin a session, or continue the one already loaded. */
  const beginSession = useCallback(() => {
    if (!sessionRef.current) sessionRef.current = newSession();
    patch({ mode: "gps", session: { ...sessionRef.current } });
    save();
  }, [patch, save]);

  /** Stop tracking and drop back to preview at the current position. */
  const endTracking = useCallback(() => {
    save();
    setState((s) => ({
      ...s,
      mode: "preview",
      offTrack: false,
      weak: false,
      heldFor: 0,
      speed: null,
      pos: s.track ? positionAt(s.track.pts, s.track.cum, s.progress).pos : s.pos,
    }));
  }, [save]);

  /** After the app was hidden, the next fix may be far away — forget the history. */
  const resumeTracking = useCallback(() => tracker.current?.reset(), []);

  /**
   * Forget the session, in memory and in storage, in that order.
   *
   * The order matters: anything that saves afterwards must find nothing to
   * save. Deleting from storage first and clearing memory second left the
   * next `save()` — which `endTracking` performs — writing the old session
   * straight back, so "Reset" appeared to work and the walk reappeared the
   * next time the hike was opened.
   */
  const clearSession = useCallback(() => {
    sessionRef.current = null;
    lastSaved.current = 0;
    const id = dayId(stateRef.current.hike);
    if (id) clearStoredSession(APP, id);
    patch({ session: null, progress: 0 });
  }, [patch]);

  const setSession = useCallback(
    (s: Session | null) => {
      sessionRef.current = s;
      patch({ session: s ? { ...s } : null });
    },
    [patch],
  );

  /** Look up what is along this track, and keep it for next time. */
  const loadSights = useCallback(
    async (hike: Hike, track: ProcessedTrack) => {
      patch({ sightsStatus: "loading" });
      try {
        const [elements, wiki] = await Promise.all([
          fetchSights(hike.pts),
          fetchWiki(hike.pts).catch(() => []),
        ]);
        const sights = buildSights(elements, wiki, track);
        store.set(`hike:sights:${hike.id}`, sights);
        if (stateRef.current.hike?.id === hike.id) patch({ sights, sightsStatus: "ok" });
      } catch {
        patch({ sightsStatus: "error" });
      }
    },
    [patch],
  );

  // Save on the way out, which is the one moment the browser reliably gives us.
  useEffect(() => {
    const onHide = () => save();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [save]);

  const currentEta = useMemo(
    () => (state.track ? eta(state.track, state.progress, state.session) : null),
    [state.track, state.progress, state.session],
  );

  return {
    state,
    patch,
    eta: currentEta,
    openHike,
    setPreview,
    onFix,
    beginSession,
    endTracking,
    resumeTracking,
    clearSession,
    setSession,
    loadSights,
    save,
  };
}
