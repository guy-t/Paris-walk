import { describe, expect, it } from "vitest";
import { applyFix, elapsed, newSession, toRecord } from "./session.js";
import type { Fix } from "./tracker.js";

const START = 1_700_000_000_000;

function fix(t: number, lat = 48.85, lon = 2.35, extra: Partial<Fix> = {}): Fix {
  return { lat, lon, accuracy: 10, timestamp: START + t * 1000, speed: 1.4, ...extra };
}

describe("session", () => {
  it("counts distance from progress along the line, not from fix to fix", () => {
    const s = newSession(START);
    // Two fixes at the same place — a phone on a table, jittering.
    applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
    applyFix(s, {
      fix: fix(10, 48.8501, 2.3501), // ~13 m of jitter
      progress: 0,
      previousProgress: 0,
      speed: 1.4,
    });
    expect(s.dist).toBe(0);
  });

  it("accrues distance as the walker advances", () => {
    const s = newSession(START);
    applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
    applyFix(s, { fix: fix(60), progress: 80, previousProgress: 0, speed: 1.4 });
    applyFix(s, { fix: fix(120), progress: 160, previousProgress: 80, speed: 1.4 });
    expect(s.dist).toBeCloseTo(160, 5);
  });

  it("does not count a re-sync jump as distance walked", () => {
    const s = newSession(START);
    applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
    // The tracker re-synced 900 m forward: that is not distance covered.
    applyFix(s, { fix: fix(30), progress: 900, previousProgress: 0, speed: 1.4 });
    expect(s.dist).toBe(0);
    expect(s.maxProg).toBe(900);
  });

  it("does not count backwards movement", () => {
    const s = newSession(START);
    applyFix(s, { fix: fix(0), progress: 200, previousProgress: 200, speed: 1.4 });
    applyFix(s, { fix: fix(30), progress: 150, previousProgress: 200, speed: 1.4 });
    expect(s.dist).toBe(0);
  });

  it("remembers the furthest point reached", () => {
    const s = newSession(START);
    applyFix(s, { fix: fix(0), progress: 500, previousProgress: 0, speed: 1.4 });
    applyFix(s, { fix: fix(30), progress: 400, previousProgress: 500, speed: 1.4 });
    expect(s.maxProg).toBe(500);
  });

  describe("moving time", () => {
    it("counts time between fixes while moving", () => {
      const s = newSession(START);
      applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
      applyFix(s, { fix: fix(30), progress: 40, previousProgress: 0, speed: 1.4 });
      expect(s.moving).toBeCloseTo(30, 5);
    });

    it("does not count time spent standing still", () => {
      const s = newSession(START);
      applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 0 });
      applyFix(s, { fix: fix(30), progress: 0, previousProgress: 0, speed: 0.1 });
      expect(s.moving).toBe(0);
    });

    it("does not count a long gap as walking", () => {
      const s = newSession(START);
      applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
      // The screen was off for an hour; that is not an hour of walking.
      applyFix(s, { fix: fix(3600), progress: 100, previousProgress: 0, speed: 1.4 });
      expect(s.moving).toBe(0);
    });
  });

  describe("recorded trail", () => {
    it("records the first fix", () => {
      const s = newSession(START);
      applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
      expect(s.trail).toHaveLength(1);
    });

    it("does not record a point for every jitter", () => {
      const s = newSession(START);
      applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
      applyFix(s, { fix: fix(5, 48.85002), progress: 2, previousProgress: 0, speed: 1.4 });
      expect(s.trail).toHaveLength(1);
    });

    it("records a point once the walker has moved", () => {
      const s = newSession(START);
      applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
      applyFix(s, { fix: fix(30, 48.8505), progress: 55, previousProgress: 0, speed: 1.4 });
      expect(s.trail).toHaveLength(2);
    });

    it("records a point after a long rest, so the pause is visible", () => {
      const s = newSession(START);
      applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 0 });
      applyFix(s, { fix: fix(60), progress: 0, previousProgress: 0, speed: 0 });
      expect(s.trail).toHaveLength(2);
    });

    it("keeps altitude when the fix has one", () => {
      const s = newSession(START);
      applyFix(s, {
        fix: fix(0, 48.85, 2.35, { altitude: 512.4 }),
        progress: 0,
        previousProgress: 0,
        speed: 1.4,
      });
      expect(s.trail[0][2]).toBe(512);
    });
  });

  it("corrects a start time that is later than the first fix", () => {
    const s = newSession(START);
    applyFix(s, { fix: fix(-600), progress: 0, previousProgress: 0, speed: 1.4 });
    expect(s.start).toBe(START - 600_000);
  });

  it("reports elapsed time from the start", () => {
    const s = newSession(START);
    expect(elapsed(s, START + 90_000)).toBe(90);
  });

  it("turns into a record worth keeping", () => {
    const s = newSession(START);
    applyFix(s, { fix: fix(0), progress: 0, previousProgress: 0, speed: 1.4 });
    // Walked in plausible steps: a single 800 m leap would be read as a re-sync.
    for (let i = 1; i <= 8; i++) {
      applyFix(s, {
        fix: fix(i * 60, 48.85 + i * 0.001),
        progress: i * 100,
        previousProgress: (i - 1) * 100,
        speed: 1.4,
      });
    }
    const rec = toRecord(s, START + 900_000);
    expect(rec.date).toBe(START);
    expect(rec.elapsed).toBe(900);
    expect(rec.dist).toBeCloseTo(800, 5);
    expect(rec.trail.length).toBeGreaterThan(0);
  });
});
