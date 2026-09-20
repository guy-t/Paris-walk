// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { onOpenedFiles, takeOpenedFiles } from "./openedFiles.js";

/** Stand in for the Android shell's JavascriptInterface. */
function shell(queue: unknown): () => void {
  const g = globalThis as { SlowNavFiles?: { take: () => string } };
  g.SlowNavFiles = { take: () => (typeof queue === "string" ? queue : JSON.stringify(queue)) };
  return () => delete g.SlowNavFiles;
}

afterEach(() => {
  delete (globalThis as { SlowNavFiles?: unknown }).SlowNavFiles;
});

describe("takeOpenedFiles", () => {
  it("is empty in a browser, where no shell is handing anything over", () => {
    expect(takeOpenedFiles()).toEqual([]);
  });

  it("collects what the shell queued", () => {
    shell([{ name: "day-one.gpx", text: "<gpx/>" }]);
    expect(takeOpenedFiles()).toEqual([{ name: "day-one.gpx", text: "<gpx/>" }]);
  });

  it("drops entries that are not files, rather than passing them on", () => {
    shell([{ name: "ok.gpx", text: "<gpx/>" }, { name: 7 }, null, "nonsense"]);
    expect(takeOpenedFiles()).toEqual([{ name: "ok.gpx", text: "<gpx/>" }]);
  });

  it("survives a shell handing over something unreadable", () => {
    // Starting the app matters more than the handover: the picker still works.
    shell("{ not json");
    expect(takeOpenedFiles()).toEqual([]);
  });
});

describe("onOpenedFiles", () => {
  it("delivers what is already waiting, without waiting for an event", () => {
    shell([{ name: "day-one.gpx", text: "<gpx/>" }]);
    const deliver = vi.fn();
    const stop = onOpenedFiles(deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
    stop();
  });

  it("says nothing when nothing is waiting", () => {
    const deliver = vi.fn();
    const stop = onOpenedFiles(deliver);
    expect(deliver).not.toHaveBeenCalled();
    stop();
  });

  it("delivers a file that arrives while the app is already open", () => {
    const deliver = vi.fn();
    const stop = onOpenedFiles(deliver);
    shell([{ name: "later.gpx", text: "<gpx/>" }]);
    window.dispatchEvent(new Event("slownav:openedfiles"));
    expect(deliver).toHaveBeenCalledWith([{ name: "later.gpx", text: "<gpx/>" }]);
    stop();
  });

  it("stops listening once torn down", () => {
    const deliver = vi.fn();
    onOpenedFiles(deliver)();
    shell([{ name: "later.gpx", text: "<gpx/>" }]);
    window.dispatchEvent(new Event("slownav:openedfiles"));
    expect(deliver).not.toHaveBeenCalled();
  });
});
