import { describe, expect, it } from "vitest";
import { corridorTiles, MAP_PROVIDERS, OFFLINE_TOP_ZOOM, sourceForProvider } from "./index.js";

const line = [
  [43.1534, -4.6235, 290],
  [43.1539, -4.6312, 320],
  [43.1539, -4.6504, 480],
] as const;

describe("sourceForProvider", () => {
  it("downloads every zoom a provider actually serves, up to the offline cap", () => {
    // The cap used to be 16, which threw away the Spanish survey's z17 — a
    // whole level of real detail on the one map these walks use.
    const ign = MAP_PROVIDERS.find((p) => p.id === "ign-es")!;
    expect(ign.maxNativeZoom).toBe(17);
    expect(sourceForProvider(ign)!.zooms).toEqual([12, 13, 14, 15, 16, 17]);
  });

  it("never asks for a zoom the provider has no tiles for", () => {
    const topo = MAP_PROVIDERS.find((p) => p.id === "opentopo")!;
    expect(topo.maxNativeZoom).toBe(16);
    expect(sourceForProvider(topo)!.zooms.at(-1)).toBe(16);
  });

  it("stops at the offline cap even where the provider goes deeper", () => {
    // Aerial imagery serves to z20. Downloading it would be four times the
    // tiles per level, and the corridor is only bounded because it stops.
    for (const p of MAP_PROVIDERS.filter((x) => !x.keyName)) {
      const src = sourceForProvider(p);
      if (src) expect(Math.max(...src.zooms)).toBeLessThanOrEqual(OFFLINE_TOP_ZOOM);
    }
  });

  it("returns nothing for a provider whose key is missing, rather than a broken URL", () => {
    const keyed = MAP_PROVIDERS.find((p) => p.keyName)!;
    expect(sourceForProvider(keyed, null)).toBeNull();
    expect(sourceForProvider(keyed, "abc")!.url).toContain("abc");
  });
});

describe("corridorTiles", () => {
  it("covers every zoom in the source", () => {
    const src = { url: "https://x/{z}/{x}/{y}.png", zooms: [14, 15], corridorM: 300 };
    const zs = new Set(corridorTiles(line, src).map((u) => u.split("/")[3]));
    expect([...zs].sort()).toEqual(["14", "15"]);
  });

  it("grows about fourfold per extra zoom, which is why the cap exists", () => {
    const at = (top: number) =>
      corridorTiles(line, {
        url: "https://x/{z}/{x}/{y}.png",
        zooms: Array.from({ length: top - 11 }, (_, i) => 12 + i),
        corridorM: 900,
      }).length;
    const z16 = at(16);
    const z17 = at(17);
    expect(z17).toBeGreaterThan(z16 * 2);
    // z18 is where a day's walk stops being a bounded download.
    expect(at(18)).toBeGreaterThan(z17 * 2);
  });

  it("asks for each tile once, however often the line doubles back", () => {
    const src = { url: "https://x/{z}/{x}/{y}.png", zooms: [15], corridorM: 300 };
    const there = [...line, ...[...line].reverse()];
    expect(corridorTiles(there, src).length).toBe(corridorTiles(line, src).length);
  });
});
