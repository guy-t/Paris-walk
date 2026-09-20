import { describe, expect, it } from "vitest";
import { gpxAccept } from "./platform.js";

/**
 * The picker filter is the whole reason a GPX in a subfolder of Documents
 * could not be selected on the phone, so the rule that decides it is pinned
 * here rather than left to a UA string read at render time.
 */
describe("gpxAccept", () => {
  const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36";
  const CAPACITOR_SHELL =
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126 Mobile Safari/537.36";
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

  it("filters nothing on Android, in the browser or in the shell", () => {
    expect(gpxAccept(ANDROID_CHROME)).toBeUndefined();
    expect(gpxAccept(CAPACITOR_SHELL)).toBeUndefined();
  });

  it("filters nothing on iOS", () => {
    expect(gpxAccept(IPHONE)).toBeUndefined();
  });

  it("still filters on a desktop, where the extension is honoured", () => {
    expect(gpxAccept(DESKTOP)).toContain(".gpx");
  });
});
