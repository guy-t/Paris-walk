/**
 * Google's encoded-polyline format, which both OSRM and Valhalla return route
 * geometry in. Valhalla uses 6 decimal places, OSRM 5 — hence `precision`.
 */

import type { LatLon } from "./geo.js";

export function decodePolyline(str: string, precision = 6): LatLon[] {
  const factor = 10 ** precision;
  const out: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    out.push([lat / factor, lon / factor]);
  }
  return out;
}
