import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRIDE_M,

  addStride,
  cadence,
  distanceFromSteps,
  newStride,
  stepsBetween,
  strideOf,
} from "./pedometer.js";

describe("stride", () => {
  it("assumes a default until enough of the walk has been measured", () => {
    const s = addStride(newStride(), 100, 140); // 0.71 m, but only 140 steps
    expect(strideOf(s).measured).toBe(false);
    expect(strideOf(s).metres).toBe(DEFAULT_STRIDE_M);
  });

  it("measures the walker's own stride once there is enough of it", () => {
    let s = newStride();
    for (let i = 0; i < 10; i++) s = addStride(s, 80, 100); // 0.8 m
    expect(strideOf(s).measured).toBe(true);
    expect(strideOf(s).metres).toBeCloseTo(0.8, 2);
  });

  /**
   * A cable car adds 2 km with no steps, a phone shaken in a rucksack adds
   * steps with no metres, and a route-position re-sync adds hundreds of
   * metres in one fix. Any of them folded in would poison the average for
   * the rest of the week, so an implausible stride is not a sample.
   */
  it("refuses a sample that is not a walker", () => {
    const s = addStride(newStride(), 500, 200); // 2.5 m a step
    expect(s).toEqual(newStride());
    expect(addStride(newStride(), 10, 200)).toEqual(newStride()); // 5 cm a step
    expect(addStride(newStride(), 0, 100)).toEqual(newStride());
    expect(addStride(newStride(), 100, 0)).toEqual(newStride());
    expect(addStride(newStride(), NaN, 100)).toEqual(newStride());
  });

  it("turns steps into a distance", () => {
    let s = newStride();
    for (let i = 0; i < 10; i++) s = addStride(s, 75, 100);
    expect(distanceFromSteps(1000, s)).toBeCloseTo(750, 0);
    expect(distanceFromSteps(0, s)).toBe(0);
    expect(distanceFromSteps(-5, s)).toBe(0);
  });
});

describe("readings", () => {
  it("counts the difference between two readings of a since-boot counter", () => {
    expect(stepsBetween({ steps: 120_400, at: 0 }, { steps: 121_000, at: 1000 })).toBe(600);
  });

  /** A reboot mid-walk resets the counter; the walker did not walk backwards. */
  it("reads a counter that has gone backwards as no steps", () => {
    expect(stepsBetween({ steps: 120_400, at: 0 }, { steps: 12, at: 1000 })).toBe(0);
  });

  it("has no opinion without two readings", () => {
    expect(stepsBetween(null, { steps: 12, at: 0 })).toBe(0);
    expect(cadence(null, { steps: 12, at: 0 })).toBeNull();
  });

  it("gives cadence in steps a minute", () => {
    const from = { steps: 1000, at: 0 };
    const to = { steps: 1220, at: 120_000 };
    expect(cadence(from, to)).toBeCloseTo(110, 0);
  });

  /** Over a few seconds the count is too coarse to divide by. */
  it("declines a cadence over too short an interval", () => {
    expect(cadence({ steps: 1000, at: 0 }, { steps: 1005, at: 5000 })).toBeNull();
  });

  /**
   * A rate no feet reach means the two numbers do not belong together — a
   * phone shaken in a rucksack, or a counter reporting a backlog in one event.
   * Found by a browser measurement that read 11,005 steps a minute, which is
   * exactly the kind of nonsense a dashboard must not show.
   */
  it("declines a cadence nobody could walk", () => {
    expect(cadence({ steps: 1000, at: 0 }, { steps: 12000, at: 60_000 })).toBeNull();
  });
});
