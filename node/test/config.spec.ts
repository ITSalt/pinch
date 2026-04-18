import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import { InvariantViolation } from "../src/invariants.js";

describe("resolveConfig — defaults", () => {
  it("returns frozen defaults when no options given", () => {
    const cfg = resolveConfig(undefined, { env: {} });
    expect(cfg.workingWindow.start).toBe("08:00");
    expect(cfg.workingWindow.end).toBe("23:00");
    expect(cfg.pacing.spawnDelayMs.min).toBe(15_000);
    expect(cfg.pacing.spawnDelayMs.max).toBe(30_000);
    expect(cfg.pacing.waveCooldownMs.min).toBe(120_000);
    expect(cfg.pacing.waveCooldownMs.max).toBe(300_000);
    expect(cfg.pacing.waveEveryN).toBe(5);
    expect(cfg.limits.maxGlobalParallelSessions).toBe(5);
    expect(cfg.limits.maxParallelPerProject).toBe(3);
    expect(cfg.limits.maxActiveProjects).toBe(3);
    expect(cfg.runner.claudeBinary).toBe("claude");
    expect(cfg.runner.taskTimeoutMs).toBe(600_000);
    expect(cfg.runner.args).toEqual(["--print"]);
  });

  it("result is deeply frozen", () => {
    const cfg = resolveConfig(undefined, { env: {} });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.pacing)).toBe(true);
    expect(Object.isFrozen(cfg.pacing.spawnDelayMs)).toBe(true);
    expect(Object.isFrozen(cfg.limits)).toBe(true);
    expect(Object.isFrozen(cfg.runner.args)).toBe(true);
  });

  it("DEFAULT_CONFIG is frozen", () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.pacing)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.pacing.spawnDelayMs)).toBe(true);
  });
});

describe("resolveConfig — merge precedence", () => {
  it("options override defaults", () => {
    const cfg = resolveConfig(
      {
        workingWindow: { start: "09:00" },
        pacing: { waveEveryN: 4 },
      },
      { env: {} },
    );
    expect(cfg.workingWindow.start).toBe("09:00");
    expect(cfg.workingWindow.end).toBe("23:00");
    expect(cfg.pacing.waveEveryN).toBe(4);
  });

  it("env overrides defaults", () => {
    const cfg = resolveConfig(undefined, {
      env: {
        PINCH_WINDOW_START: "10:00",
        PINCH_SPAWN_DELAY_MIN_MS: "20000",
        PINCH_SPAWN_DELAY_MAX_MS: "40000",
      },
    });
    expect(cfg.workingWindow.start).toBe("10:00");
    expect(cfg.pacing.spawnDelayMs.min).toBe(20_000);
    expect(cfg.pacing.spawnDelayMs.max).toBe(40_000);
  });

  it("options override env", () => {
    const cfg = resolveConfig(
      { workingWindow: { start: "11:00" } },
      { env: { PINCH_WINDOW_START: "10:00" } },
    );
    expect(cfg.workingWindow.start).toBe("11:00");
  });

  it("env that would violate invariants still throws", () => {
    expect(() =>
      resolveConfig(undefined, { env: { PINCH_MAX_GLOBAL_PARALLEL: "99" } }),
    ).toThrowError(InvariantViolation);
  });

  it("ignores empty env values", () => {
    const cfg = resolveConfig(undefined, { env: { PINCH_WINDOW_START: "" } });
    expect(cfg.workingWindow.start).toBe("08:00");
  });

  it("ignores non-numeric env values for numeric fields", () => {
    const cfg = resolveConfig(undefined, { env: { PINCH_SPAWN_DELAY_MIN_MS: "not-a-number" } });
    expect(cfg.pacing.spawnDelayMs.min).toBe(15_000);
  });
});
