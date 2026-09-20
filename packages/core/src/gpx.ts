/**
 * GPX in and out.
 *
 * Imports are simplified to 3 m and rounded to 6 decimal places (about 10 cm)
 * on the way in: phone-recorded tracks routinely carry a point per second,
 * which is tens of thousands of points for a day's walk, and every one of them
 * would be scored on every GPS fix by the map-matcher and stored in
 * localStorage. 3 m is well below the accuracy of the fix that will be matched
 * against it, so nothing is lost that was ever real.
 */

import { simplify, type Point3 } from "./geo.js";

export interface Waypoint {
  name: string;
  desc: string;
  lat: number;
  lon: number;
}

export interface ParsedGpx {
  name: string;
  pts: Point3[];
  wpts: Waypoint[];
}

/** A recorded point, which may carry a timestamp for export. */
export type RecordedPoint = readonly [
  lat: number,
  lon: number,
  ele: number | null,
  time?: number | null,
];

/**
 * Parse a GPX document.
 *
 * @throws if the file is not XML, or contains no track or route.
 */
export function parseGPX(text: string, fallbackName = "Imported track"): ParsedGpx {
  const doc = new DOMParser().parseFromString(text.trim(), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not a valid GPX file");

  // A route (<rte>) is a planned line; a track (<trk>) is usually a recorded
  // one. Either works as a line to follow, so fall back to the route.
  let nodes = [...doc.querySelectorAll("trk trkpt")];
  if (nodes.length < 2) nodes = [...doc.querySelectorAll("rte rtept")];
  if (nodes.length < 2) throw new Error("No track in this GPX");

  const arr: Point3[] = nodes.map((p) => [
    +(p.getAttribute("lat") ?? 0),
    +(p.getAttribute("lon") ?? 0),
    +(p.querySelector("ele")?.textContent || 0),
  ]);

  const wpts: Waypoint[] = [...doc.querySelectorAll("gpx > wpt")].map((w) => ({
    name: w.querySelector("name")?.textContent?.trim() || "",
    desc: w.querySelector("desc")?.textContent?.trim() || "",
    lat: +(w.getAttribute("lat") ?? 0),
    lon: +(w.getAttribute("lon") ?? 0),
  }));

  // Queried one at a time, not as a selector list: a list matches in document
  // order, so `<metadata><name>` would win over the track's own name simply
  // for appearing first. The track name is the one a walker recognises.
  const name =
    ["trk > name", "rte > name", "metadata > name"]
      .map((sel) => doc.querySelector(sel)?.textContent?.trim())
      .find((n) => n) || fallbackName;

  const pts = simplify(arr, 3).map(
    (p) => [+p[0].toFixed(6), +p[1].toFixed(6), Math.round(p[2])] as Point3,
  );
  return { name, pts, wpts };
}

function esc(s: string): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * Serialise a line as GPX.
 *
 * @param withTime include `<time>` elements, which turns a bare line into a
 *   recorded track that other tools will show a speed profile for.
 */
export function toGPX(
  name: string,
  pts: readonly RecordedPoint[],
  withTime = false,
  creator = "Slow Navigator",
): string {
  const body = pts
    .map((p) => {
      const ele = p[2] != null ? `<ele>${Math.round(p[2])}</ele>` : "";
      const time = withTime && p[3] ? `<time>${new Date(p[3]).toISOString()}</time>` : "";
      return `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${ele}${time}</trkpt>`;
    })
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="${esc(creator)}" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `<trk><name>${esc(name)}</name><trkseg>\n${body}\n</trkseg></trk>\n</gpx>\n`
  );
}

/** Offer a GPX file to the user as a download. */
export function downloadGPX(filename: string, gpx: string): void {
  const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: filename.replace(/[^\w-]+/g, "_") + (filename.endsWith(".gpx") ? "" : ".gpx"),
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
