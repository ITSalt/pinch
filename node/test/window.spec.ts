import { describe, expect, it } from "vitest";
import { WorkingWindow, wallClockInTz } from "../src/window.js";
import type { Clock, WorkingWindowConfig } from "../src/types.js";

function fakeClock(epochMs: number): Clock {
  return {
    now: () => epochMs,
    monotonicMs: () => 0,
    sleep: async () => undefined,
  };
}

const UTC_WINDOW: WorkingWindowConfig = { start: "08:00", end: "23:00", tz: "UTC" };

function utcAt(h: number, m = 0, s = 0): number {
  return Date.UTC(2025, 5, 15, h, m, s);
}

describe("WorkingWindow in UTC", () => {
  it("is closed before start", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(7, 59)));
    expect(w.isOpenNow()).toBe(false);
  });

  it("is open exactly at start", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(8, 0)));
    expect(w.isOpenNow()).toBe(true);
  });

  it("is open mid-window", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(15, 0)));
    expect(w.isOpenNow()).toBe(true);
  });

  it("is closed exactly at end", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(23, 0)));
    expect(w.isOpenNow()).toBe(false);
  });

  it("is closed after end", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(23, 30)));
    expect(w.isOpenNow()).toBe(false);
  });
});

describe("WorkingWindow — msUntilNextOpen", () => {
  it("returns 0 when open", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(10, 0)));
    expect(w.msUntilNextOpen()).toBe(0);
  });

  it("is 1 hour before start", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(7, 0)));
    expect(w.msUntilNextOpen()).toBe(60 * 60 * 1000);
  });

  it("accounts for seconds past the minute", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(7, 0, 30)));
    expect(w.msUntilNextOpen()).toBe(60 * 60 * 1000 - 30_000);
  });

  it("wraps to next day after close", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(23, 0)));
    const expected = (24 - 23 + 8) * 60 * 60 * 1000;
    expect(w.msUntilNextOpen()).toBe(expected);
  });

  it("wraps from 23:59:30 correctly", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(23, 59, 30)));
    const expectedMinutes = 24 * 60 - (23 * 60 + 59) + 8 * 60;
    const expectedMs = expectedMinutes * 60_000 - 30_000;
    expect(w.msUntilNextOpen()).toBe(expectedMs);
  });
});

describe("WorkingWindow — msUntilClose", () => {
  it("returns 0 when closed", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(5, 0)));
    expect(w.msUntilClose()).toBe(0);
  });

  it("returns full duration at open", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(8, 0)));
    expect(w.msUntilClose()).toBe(15 * 60 * 60 * 1000);
  });

  it("decreases toward close", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(utcAt(22, 55)));
    expect(w.msUntilClose()).toBe(5 * 60 * 1000);
  });
});

describe("WorkingWindow — 24:00 end", () => {
  const W: WorkingWindowConfig = { start: "08:00", end: "24:00", tz: "UTC" };

  it("is open all day from 08:00", () => {
    const w = new WorkingWindow(W, fakeClock(utcAt(8, 0)));
    expect(w.isOpenNow()).toBe(true);
    const w2 = new WorkingWindow(W, fakeClock(utcAt(23, 59)));
    expect(w2.isOpenNow()).toBe(true);
  });
});

describe("WorkingWindow in Europe/Moscow", () => {
  const W: WorkingWindowConfig = { start: "08:00", end: "23:00", tz: "Europe/Moscow" };

  it("08:00 Moscow == 05:00 UTC is open", () => {
    const w = new WorkingWindow(W, fakeClock(Date.UTC(2025, 5, 15, 5, 0)));
    expect(w.isOpenNow()).toBe(true);
  });

  it("04:00 UTC (07:00 Moscow) is closed", () => {
    const w = new WorkingWindow(W, fakeClock(Date.UTC(2025, 5, 15, 4, 0)));
    expect(w.isOpenNow()).toBe(false);
  });
});

describe("wallClockInTz", () => {
  it("returns correct wall time in UTC", () => {
    const wc = wallClockInTz(Date.UTC(2025, 5, 15, 10, 30, 45), "UTC");
    expect(wc.hour).toBe(10);
    expect(wc.minute).toBe(30);
    expect(wc.second).toBe(45);
  });

  it("returns correct wall time in Europe/Moscow (UTC+3)", () => {
    const wc = wallClockInTz(Date.UTC(2025, 5, 15, 10, 0, 0), "Europe/Moscow");
    expect(wc.hour).toBe(13);
  });

  it("normalizes midnight 24 → 0", () => {
    const wc = wallClockInTz(Date.UTC(2025, 5, 15, 0, 0, 0), "UTC");
    expect(wc.hour).toBe(0);
  });
});

describe("WorkingWindow — describe", () => {
  it("returns human-readable string", () => {
    const w = new WorkingWindow(UTC_WINDOW, fakeClock(0));
    expect(w.describe()).toBe("08:00-23:00 UTC");
  });
});
