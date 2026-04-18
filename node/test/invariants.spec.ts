import { describe, expect, it } from "vitest";
import {
  HARD_INVARIANTS,
  InvariantViolation,
  computeWindowDurationMinutes,
  parseHHMMToMinutes,
  validateInvariants,
} from "../src/invariants.js";
import { resolveConfig } from "../src/config.js";
import type { ResolvedConfig } from "../src/types.js";

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return resolveConfig({ ...overrides });
}

describe("HARD_INVARIANTS", () => {
  it("exposes the expected hard caps", () => {
    expect(HARD_INVARIANTS.maxGlobalParallelSessions).toBe(5);
    expect(HARD_INVARIANTS.maxParallelPerProject).toBe(3);
    expect(HARD_INVARIANTS.maxActiveProjects).toBe(3);
    expect(HARD_INVARIANTS.minDowntimeHoursPerDay).toBe(8);
    expect(HARD_INVARIANTS.maxWorkingHoursPerDay).toBe(16);
    expect(HARD_INVARIANTS.minSpawnDelayMs).toBe(15_000);
    expect(HARD_INVARIANTS.minWaveCooldownMs).toBe(120_000);
  });

  it("is frozen and cannot be mutated", () => {
    expect(Object.isFrozen(HARD_INVARIANTS)).toBe(true);
    expect(() => {
      (HARD_INVARIANTS as unknown as { maxGlobalParallelSessions: number }).maxGlobalParallelSessions = 99;
    }).toThrow();
  });
});

describe("validateInvariants — limits", () => {
  it("accepts defaults", () => {
    expect(() => validateInvariants(baseConfig())).not.toThrow();
  });

  it("rejects maxGlobalParallelSessions > 5", () => {
    expect(() => resolveConfig({ limits: { maxGlobalParallelSessions: 6 } })).toThrowError(
      InvariantViolation,
    );
  });

  it("rejects maxGlobalParallelSessions < 1", () => {
    expect(() => resolveConfig({ limits: { maxGlobalParallelSessions: 0 } })).toThrowError(
      InvariantViolation,
    );
  });

  it("rejects maxParallelPerProject > 3", () => {
    expect(() => resolveConfig({ limits: { maxParallelPerProject: 4 } })).toThrowError(
      InvariantViolation,
    );
  });

  it("rejects maxActiveProjects > 3", () => {
    expect(() => resolveConfig({ limits: { maxActiveProjects: 4 } })).toThrowError(
      InvariantViolation,
    );
  });

  it("rejects per-project > global", () => {
    expect(() =>
      resolveConfig({
        limits: { maxGlobalParallelSessions: 2, maxParallelPerProject: 3 },
      }),
    ).toThrowError(InvariantViolation);
  });

  it("accepts per-project == global", () => {
    expect(() =>
      resolveConfig({
        limits: { maxGlobalParallelSessions: 3, maxParallelPerProject: 3 },
      }),
    ).not.toThrow();
  });

  it("rejects non-integer limits", () => {
    expect(() => resolveConfig({ limits: { maxGlobalParallelSessions: 2.5 } })).toThrowError(
      InvariantViolation,
    );
  });
});

describe("validateInvariants — pacing", () => {
  it("rejects spawnDelayMs.min < 15000", () => {
    expect(() =>
      resolveConfig({ pacing: { spawnDelayMs: { min: 14_999, max: 20_000 } } }),
    ).toThrowError(InvariantViolation);
  });

  it("accepts spawnDelayMs.min == 15000", () => {
    expect(() =>
      resolveConfig({ pacing: { spawnDelayMs: { min: 15_000, max: 20_000 } } }),
    ).not.toThrow();
  });

  it("rejects spawnDelayMs.max < min", () => {
    expect(() =>
      resolveConfig({ pacing: { spawnDelayMs: { min: 20_000, max: 15_000 } } }),
    ).toThrowError(InvariantViolation);
  });

  it("rejects waveCooldownMs.min < 120000", () => {
    expect(() =>
      resolveConfig({ pacing: { waveCooldownMs: { min: 119_999, max: 200_000 } } }),
    ).toThrowError(InvariantViolation);
  });

  it("rejects waveEveryN < 1", () => {
    expect(() => resolveConfig({ pacing: { waveEveryN: 0 } })).toThrowError(InvariantViolation);
  });

  it("rejects waveEveryN non-integer", () => {
    expect(() => resolveConfig({ pacing: { waveEveryN: 2.5 } })).toThrowError(InvariantViolation);
  });
});

describe("validateInvariants — window", () => {
  it("accepts 08:00-23:00 (15h)", () => {
    expect(() =>
      resolveConfig({ workingWindow: { start: "08:00", end: "23:00" } }),
    ).not.toThrow();
  });

  it("accepts 08:00-24:00 (16h boundary)", () => {
    expect(() =>
      resolveConfig({ workingWindow: { start: "08:00", end: "24:00" } }),
    ).not.toThrow();
  });

  it("rejects 07:00-24:00 (17h > 16h cap)", () => {
    expect(() =>
      resolveConfig({ workingWindow: { start: "07:00", end: "24:00" } }),
    ).toThrowError(InvariantViolation);
  });

  it("rejects 00:00-23:59 (nearly 24h)", () => {
    expect(() =>
      resolveConfig({ workingWindow: { start: "00:00", end: "23:59" } }),
    ).toThrowError(InvariantViolation);
  });

  it("rejects wrap-around (end <= start)", () => {
    expect(() =>
      resolveConfig({ workingWindow: { start: "22:00", end: "06:00" } }),
    ).toThrowError(InvariantViolation);
  });

  it("rejects end == start", () => {
    expect(() =>
      resolveConfig({ workingWindow: { start: "08:00", end: "08:00" } }),
    ).toThrowError(InvariantViolation);
  });

  it("rejects malformed HH:MM", () => {
    expect(() =>
      resolveConfig({ workingWindow: { start: "8am", end: "23:00" } }),
    ).toThrowError(InvariantViolation);
    expect(() =>
      resolveConfig({ workingWindow: { start: "25:00", end: "26:00" } }),
    ).toThrowError(InvariantViolation);
    expect(() =>
      resolveConfig({ workingWindow: { start: "24:30", end: "24:45" } }),
    ).toThrowError(InvariantViolation);
  });
});

describe("computeWindowDurationMinutes", () => {
  it("computes basic intervals", () => {
    expect(computeWindowDurationMinutes("08:00", "23:00")).toBe(15 * 60);
    expect(computeWindowDurationMinutes("09:30", "10:15")).toBe(45);
    expect(computeWindowDurationMinutes("00:00", "16:00")).toBe(16 * 60);
  });
});

describe("parseHHMMToMinutes", () => {
  it("parses valid formats", () => {
    expect(parseHHMMToMinutes("00:00", "x")).toBe(0);
    expect(parseHHMMToMinutes("23:59", "x")).toBe(23 * 60 + 59);
    expect(parseHHMMToMinutes("24:00", "x")).toBe(24 * 60);
  });

  it("accepts single-digit hour", () => {
    expect(parseHHMMToMinutes("8:00", "x")).toBe(8 * 60);
  });
});

describe("InvariantViolation", () => {
  it("carries structured fields", () => {
    try {
      resolveConfig({ limits: { maxGlobalParallelSessions: 99 } });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InvariantViolation);
      const v = e as InvariantViolation;
      expect(v.invariant).toBe("maxGlobalParallelSessions");
      expect(v.configured).toBe(99);
      expect(v.bound).toBe("<=5");
    }
  });
});
