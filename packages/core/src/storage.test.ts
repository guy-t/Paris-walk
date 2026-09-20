// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { storageReport, store } from "./storage.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("storageReport", () => {
  it("says a write succeeded, and leaves nothing behind when it does", () => {
    const r = storageReport(1);
    expect(r.canWrite).toBe(true);
    expect(r.error).toBeUndefined();
    expect(localStorage.getItem("slownav:probe")).toBeNull();
  });

  it("names what is using the space, biggest first", () => {
    store.set("hike:library", "a".repeat(2000));
    store.set("hike:settings", "b".repeat(50));
    const r = storageReport(1);
    expect(r.top[0]?.key).toBe("hike:library");
    expect(r.totalKB).toBeGreaterThan(0);
  });

  it("reports a refused write rather than pretending it worked", () => {
    // What a full quota looks like from here — and what the app has to say
    // out loud, instead of claiming a hike was imported.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    });
    const r = storageReport(1);
    expect(r.canWrite).toBe(false);
    expect(r.error).toContain("QuotaExceededError");
  });
});
