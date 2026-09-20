/**
 * The Leaflet map, wrapped thinly.
 *
 * Deliberately not react-leaflet: the map is the one part of these apps that
 * must *not* re-render on every GPS fix. React owns the chrome around it; this
 * component owns a single Leaflet instance and mutates it imperatively when
 * props change. Redrawing a 3000-point polyline five times a minute would
 * flatten the battery the rest of the app works so hard to save.
 *
 * "Calm follow" is the other reason this is hand-written. A map that recentres
 * on every fix is unreadable while walking — the ground slides under you and
 * you cannot tap anything. Instead the map only pans when the walker leaves
 * the middle 56% of the viewport, and stops following entirely the moment the
 * user drags it.
 */

import L from "leaflet";
import { useEffect, useRef } from "react";
import type { AnyPoint, LatLon } from "@slownav/core";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  /** CSS class for the marker dot, e.g. "peak", "water", "hut". */
  kind: string;
  /** Popup HTML. Callers must escape anything user- or OSM-supplied. */
  popup?: string;
  /** Marker label, for waypoints that show a number or initials. */
  label?: string;
  onClick?: () => void;
}

export interface MapViewProps {
  /** The planned route. */
  planned?: readonly AnyPoint[];
  /** How far along the planned route we are, metres — drawn in "done" grey. */
  doneUpTo?: readonly AnyPoint[];
  /** The recorded trail, drawn dashed. */
  trail?: readonly AnyPoint[];
  markers?: readonly MapMarker[];
  /** Where the walker is. */
  position?: LatLon | null;
  /** Accuracy circle radius in metres; 0 or null draws none. */
  accuracy?: number | null;
  /** Tile layer URL template. */
  tileUrl: string;
  tileAttribution: string;
  maxZoom?: number;
  maxNativeZoom?: number;
  /** An extra overlay, e.g. OpenSeaMap. */
  overlayUrl?: string | null;
  imperialScale?: boolean;
  /** Called when the user drags, so the app can turn the follow button off. */
  onUserPan?: () => void;
  /** Called when the user taps the map, with the tapped coordinate. */
  onMapClick?: (pos: LatLon) => void;
  /** Follow the walker. Set false when the user has taken control. */
  follow: boolean;
  /** Bumping this number refits the map to the whole route. */
  fitNonce?: number;
  /** Bumping this number recentres hard on the walker, zooming in. */
  centreNonce?: number;
  /** Bumping this invalidates the size, after a layout change. */
  resizeNonce?: number;
  /** Pan to this point when it changes, e.g. "show on map" from a list. */
  flyTo?: { pos: LatLon; nonce: number } | null;
  className?: string;
}

/** Zoom used the first time we lock on to the walker. */
const FOLLOW_ZOOM = 15;
/** Fraction of the viewport edge that counts as "about to walk off screen". */
const EDGE = 0.22;
/** Never redraw the done-line more often than this while tracking, ms. */
const DONE_REDRAW_MS = 3000;

export function MapView({
  planned,
  doneUpTo,
  trail,
  markers,
  position,
  accuracy,
  tileUrl,
  tileAttribution,
  maxZoom = 17,
  maxNativeZoom = 16,
  overlayUrl,
  imperialScale = false,
  onUserPan,
  onMapClick,
  follow,
  fitNonce = 0,
  centreNonce = 0,
  resizeNonce = 0,
  flyTo,
  className,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<{
    planned?: L.Polyline;
    done?: L.Polyline;
    trail?: L.Polyline;
    markers?: L.LayerGroup;
    you?: L.Marker;
    acc?: L.Circle;
    overlay?: L.TileLayer;
  }>({});
  /** True once we have zoomed in on the walker at least once. */
  const zoomedIn = useRef(false);
  const userZooming = useRef(false);
  const lastDoneAt = useRef(0);
  // Read inside Leaflet handlers, which are registered once and would
  // otherwise close over a stale prop.
  const followRef = useRef(follow);
  followRef.current = follow;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onUserPanRef = useRef(onUserPan);
  onUserPanRef.current = onUserPan;

  // ---- create the map once ----
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, {
      zoomControl: false,
      preferCanvas: true, // thousands of points; SVG would crawl
      zoomSnap: 0.5,
    }).setView([43.15, -4.75], 11);
    mapRef.current = map;

    L.tileLayer(tileUrl, { maxZoom, maxNativeZoom, attribution: tileAttribution }).addTo(map);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    L.control
      .scale({ imperial: imperialScale, metric: !imperialScale, position: "bottomright" })
      .addTo(map);

    layers.current.planned = L.polyline([], {
      color: "#1d4ed8",
      weight: 4,
      opacity: 0.85,
      smoothFactor: 1.2,
    }).addTo(map);
    layers.current.done = L.polyline([], {
      color: "#9ca3af",
      weight: 4,
      opacity: 0.9,
      smoothFactor: 1.2,
    }).addTo(map);
    layers.current.trail = L.polyline([], {
      color: "#c2410c",
      weight: 3,
      opacity: 0.95,
      dashArray: "6 5",
      smoothFactor: 1,
    }).addTo(map);
    layers.current.markers = L.layerGroup().addTo(map);
    layers.current.you = L.marker([0, 0], {
      icon: L.divIcon({
        className: "",
        html: '<div class="you-marker"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      zIndexOffset: 1000,
    });
    layers.current.acc = L.circle([0, 0], {
      radius: 0,
      color: "#2563eb",
      weight: 1,
      fillOpacity: 0.08,
    });

    map.on("dragstart", () => onUserPanRef.current?.());
    map.on("zoomstart", () => {
      userZooming.current = true;
    });
    map.on("zoomend", () => {
      userZooming.current = false;
    });
    map.on("click", (e: L.LeafletMouseEvent) =>
      onMapClickRef.current?.([e.latlng.lat, e.latlng.lng]),
    );

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Tile configuration is fixed for the life of a map; changing apps
    // unmounts this component entirely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- the planned route ----
  useEffect(() => {
    const l = layers.current.planned;
    if (!l) return;
    l.setLatLngs((planned ?? []).map((p) => [p[0], p[1]] as L.LatLngTuple));
    zoomedIn.current = false;
  }, [planned]);

  // ---- the part already walked ----
  useEffect(() => {
    const l = layers.current.done;
    if (!l) return;
    // Throttled: the walked line grows by one point at a time and redrawing it
    // on every fix is the single most expensive thing the map can do.
    const now = Date.now();
    if (now - lastDoneAt.current < DONE_REDRAW_MS && (doneUpTo?.length ?? 0) > 0) return;
    lastDoneAt.current = now;
    l.setLatLngs((doneUpTo ?? []).map((p) => [p[0], p[1]] as L.LatLngTuple));
  }, [doneUpTo]);

  // ---- the recorded trail ----
  useEffect(() => {
    layers.current.trail?.setLatLngs((trail ?? []).map((p) => [p[0], p[1]] as L.LatLngTuple));
  }, [trail]);

  // ---- markers ----
  useEffect(() => {
    const group = layers.current.markers;
    if (!group) return;
    group.clearLayers();
    for (const m of markers ?? []) {
      const marker = L.marker([m.lat, m.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div class="mk ${m.kind}">${m.label ?? ""}</div>`,
          iconSize: m.label ? [20, 20] : [14, 14],
          iconAnchor: m.label ? [10, 10] : [7, 7],
        }),
      });
      if (m.popup) marker.bindPopup(m.popup);
      if (m.onClick) marker.on("click", m.onClick);
      marker.addTo(group);
    }
  }, [markers]);

  // ---- an optional overlay, e.g. sea marks ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layers.current.overlay) {
      map.removeLayer(layers.current.overlay);
      layers.current.overlay = undefined;
    }
    if (overlayUrl) {
      layers.current.overlay = L.tileLayer(overlayUrl, { maxZoom: 18, opacity: 0.9 }).addTo(map);
    }
  }, [overlayUrl]);

  // ---- the walker ----
  useEffect(() => {
    const map = mapRef.current;
    const you = layers.current.you;
    const acc = layers.current.acc;
    if (!map || !you || !acc) return;
    if (!position) {
      if (map.hasLayer(you)) {
        map.removeLayer(you);
        map.removeLayer(acc);
      }
      return;
    }
    if (!map.hasLayer(you)) {
      you.addTo(map);
      acc.addTo(map);
    }
    you.setLatLng(position);
    acc.setLatLng(position).setRadius(accuracy ?? 0);

    // Calm follow: only pan when the walker nears the edge of the view.
    if (!followRef.current || userZooming.current) return;
    if (!zoomedIn.current) {
      map.setView(position, FOLLOW_ZOOM, { animate: false });
      zoomedIn.current = true;
      return;
    }
    const size = map.getSize();
    const pt = map.latLngToContainerPoint(position);
    const mx = size.x * EDGE;
    const my = size.y * EDGE;
    if (pt.x < mx || pt.x > size.x - mx || pt.y < my || pt.y > size.y - my) {
      map.panTo(position, { animate: true, duration: 0.5 });
    }
  }, [position, accuracy]);

  // ---- imperative commands, driven by a bumped nonce ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitNonce || !planned?.length) return;
    map.fitBounds(L.latLngBounds(planned.map((p) => [p[0], p[1]] as L.LatLngTuple)), {
      padding: [30, 30],
    });
  }, [fitNonce, planned]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !centreNonce || !position) return;
    map.setView(position, Math.max(map.getZoom(), FOLLOW_ZOOM), { animate: true });
    zoomedIn.current = true;
  }, [centreNonce, position]);

  useEffect(() => {
    if (!resizeNonce) return;
    // After a layout change the container has not been measured yet.
    const id = setTimeout(() => mapRef.current?.invalidateSize(), 50);
    return () => clearTimeout(id);
  }, [resizeNonce]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo(flyTo.pos, Math.max(map.getZoom(), FOLLOW_ZOOM), { duration: 0.6 });
  }, [flyTo]);

  return <div ref={hostRef} className={className ?? "map"} />;
}
