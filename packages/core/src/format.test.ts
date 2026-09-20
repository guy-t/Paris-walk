import { describe, expect, it } from "vitest";
import { createFormatter, walkingDistance } from "./format.js";

const m = createFormatter("metric");
const i = createFormatter("imperial");

describe("metric formatting", () => {
  it("rounds short distances to 10 m", () => {
    expect(m.dist(123)).toBe("120 m");
    expect(m.dist(4)).toBe("0 m");
  });

  it("switches to kilometres above 1 km", () => {
    expect(m.dist(1500)).toBe("1.5 km");
    expect(m.dist(15000)).toBe("15 km");
  });

  it("formats speed and pace", () => {
    expect(m.speed(1.4)).toBe("5.0 km/h");
    expect(m.pace(1000 / 600)).toBe("10:00 /km");
  });

  it("says nothing rather than guessing when there is no speed", () => {
    expect(m.speed(null)).toBe("—");
    expect(m.speed(NaN)).toBe("—");
    expect(m.pace(0)).toBe("—");
  });

  it("formats durations", () => {
    expect(m.dur(600)).toBe("10 min");
    expect(m.dur(3600)).toBe("1 h 00");
    expect(m.dur(5460)).toBe("1 h 31");
    expect(m.dur(-1)).toBe("—");
    expect(m.dur(Infinity)).toBe("—");
  });

  it("formats altitude in whole metres", () => {
    expect(m.alt(1234.6)).toBe("1235 m");
  });
});

describe("imperial formatting", () => {
  it("uses feet for short distances", () => {
    expect(i.dist(100)).toMatch(/ft$/);
  });

  it("uses miles for long ones", () => {
    expect(i.dist(5000)).toBe("3.1 mi");
  });

  it("formats speed in mph and pace per mile", () => {
    expect(i.speed(1.4)).toBe("3.1 mph");
    expect(i.pace(1.4)).toMatch(/\/mi$/);
  });

  it("formats altitude in feet", () => {
    expect(i.alt(1000)).toBe("3281 ft");
  });
});

describe("walkingDistance", () => {
  it("rounds to 5 m when close, so the number is actionable", () => {
    expect(walkingDistance(42)).toBe("40 m");
    expect(walkingDistance(43)).toBe("45 m");
  });

  it("rounds to 10 m further out", () => {
    expect(walkingDistance(248)).toBe("250 m");
    expect(walkingDistance(523)).toBe("520 m");
  });

  it("switches to kilometres at 1 km", () => {
    expect(walkingDistance(1500)).toBe("1.5 km");
  });
});
