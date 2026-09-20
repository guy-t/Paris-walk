import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_ID,
  MAP_PROVIDERS,
  covers,
  getProvider,
  providersFor,
  suggestProvider,
  tileUrl,
} from "./providers.js";

const POTES = [43.153, -4.628] as const; // Picos de Europa, Spain
const AUXERRE = [47.798, 3.573] as const; // on the Yonne, France
const SYDNEY = [-33.87, 151.21] as const; // neither

describe("map providers", () => {
  it("every provider has a usable tile template", () => {
    for (const p of MAP_PROVIDERS) {
      expect(p.url).toMatch(/\{z\}/);
      expect(p.url).toMatch(/\{x\}/);
      expect(p.url).toMatch(/\{y\}/);
      expect(p.attribution).not.toBe("");
    }
  });

  it("falls back to the default for an unknown id", () => {
    expect(getProvider("nonsense").id).toBe(DEFAULT_PROVIDER_ID);
    expect(getProvider(null).id).toBe(DEFAULT_PROVIDER_ID);
  });

  describe("coverage", () => {
    it("knows Spain's survey reaches the Picos and not Australia", () => {
      const es = getProvider("ign-es");
      expect(covers(es, POTES)).toBe(true);
      expect(covers(es, SYDNEY)).toBe(false);
    });

    it("knows France's map reaches the Yonne and not Australia", () => {
      const fr = getProvider("ign-fr");
      expect(covers(fr, AUXERRE)).toBe(true);
      expect(covers(fr, SYDNEY)).toBe(false);
    });

    /**
     * The boxes overlap around the Pyrenees on purpose. A rectangle cannot
     * follow that border, and both agencies really do serve tiles across it.
     * Which map to prefer there is the app's call, not the geometry's.
     */
    it("allows the Spanish and French boxes to overlap near the border", () => {
      expect(covers(getProvider("ign-fr"), POTES)).toBe(true);
      expect(suggestProvider(POTES, ["ign-es"]).id).toBe("ign-es");
      expect(suggestProvider(POTES, ["ign-fr"]).id).toBe("ign-fr");
    });

    it("treats a provider with no bounds as worldwide", () => {
      const world = getProvider("opentopo");
      expect(covers(world, POTES)).toBe(true);
      expect(covers(world, SYDNEY)).toBe(true);
    });
  });

  describe("tile urls", () => {
    it("returns the template unchanged when no key is needed", () => {
      const p = getProvider("opentopo");
      expect(tileUrl(p)).toBe(p.url);
    });

    it("fills in a key when one is given", () => {
      const p = getProvider("maptiler-outdoor");
      expect(tileUrl(p, "abc123")).toContain("key=abc123");
      expect(tileUrl(p, "abc123")).not.toContain("{key}");
    });

    it("returns null rather than a broken url when the key is missing", () => {
      expect(tileUrl(getProvider("maptiler-outdoor"), null)).toBeNull();
      expect(tileUrl(getProvider("maptiler-outdoor"), "")).toBeNull();
    });

    it("escapes a key so it cannot break out of the query string", () => {
      const url = tileUrl(getProvider("maptiler-outdoor"), "a&b=c");
      expect(url).toContain("a%26b%3Dc");
    });
  });
});

describe("choosing a provider", () => {
  it("honours the app's own preference where it reaches", () => {
    // The hiking app knows its routes are in the Picos.
    expect(suggestProvider(POTES, ["ign-es", "opentopo"]).id).toBe("ign-es");
    // The boat app knows its route is French.
    expect(suggestProvider(AUXERRE, ["ign-fr", "opentopo"]).id).toBe("ign-fr");
  });

  it("falls through when the preferred provider does not reach", () => {
    // An imported GPX from Australia, opened in the hiking app.
    const chosen = suggestProvider(SYDNEY, ["ign-es", "opentopo"]);
    expect(chosen.id).toBe("opentopo");
    expect(chosen.bounds).toBeUndefined();
  });

  it("never picks a provider needing a key the walker has not set", () => {
    for (const point of [POTES, AUXERRE, SYDNEY]) {
      expect(suggestProvider(point, ["maptiler-outdoor"]).keyName).toBeUndefined();
    }
  });

  it("ignores a preference for a provider that does not exist", () => {
    expect(suggestProvider(POTES, ["nonsense"]).id).toBeTruthy();
  });

  /**
   * Coverage boxes are approximate and overlap near borders on purpose — a
   * national agency does serve some way across its own frontier, and a
   * rectangle cannot follow the Pyrenees. They exist to grey out a provider
   * that is nowhere near, not to arbitrate between two plausible maps.
   */
  it("greys out only what is genuinely far away", () => {
    const listed = providersFor(SYDNEY);
    expect(listed.find((x) => x.provider.id === "ign-es")!.available).toBe(false);
    expect(listed.find((x) => x.provider.id === "ign-fr")!.available).toBe(false);
    expect(listed.find((x) => x.provider.id === "opentopo")!.available).toBe(true);
  });

  it("lists available providers before unavailable ones", () => {
    const listed = providersFor(SYDNEY).map((x) => x.available);
    expect(listed).toEqual([...listed].sort((a, b) => (a === b ? 0 : a ? -1 : 1)));
  });
});
