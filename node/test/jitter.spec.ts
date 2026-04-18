import { describe, expect, it } from "vitest";
import { JitteredDelay, constantRng, seededRng } from "../src/jitter.js";

describe("JitteredDelay", () => {
  const spawnRange = { min: 15_000, max: 30_000 };
  const waveRange = { min: 120_000, max: 300_000 };

  it("spawnDelayMs returns value in [min, max]", () => {
    const d = new JitteredDelay(spawnRange, waveRange, seededRng(42));
    for (let i = 0; i < 1000; i++) {
      const v = d.spawnDelayMs();
      expect(v).toBeGreaterThanOrEqual(spawnRange.min);
      expect(v).toBeLessThanOrEqual(spawnRange.max);
    }
  });

  it("waveCooldownMs returns value in [min, max]", () => {
    const d = new JitteredDelay(spawnRange, waveRange, seededRng(42));
    for (let i = 0; i < 1000; i++) {
      const v = d.waveCooldownMs();
      expect(v).toBeGreaterThanOrEqual(waveRange.min);
      expect(v).toBeLessThanOrEqual(waveRange.max);
    }
  });

  it("returns min when rng=0", () => {
    const d = new JitteredDelay(spawnRange, waveRange, constantRng(0));
    expect(d.spawnDelayMs()).toBe(spawnRange.min);
    expect(d.waveCooldownMs()).toBe(waveRange.min);
  });

  it("returns max when rng just below 1", () => {
    const d = new JitteredDelay(spawnRange, waveRange, constantRng(0.999999));
    expect(d.spawnDelayMs()).toBe(spawnRange.max);
    expect(d.waveCooldownMs()).toBe(waveRange.max);
  });

  it("degenerate range min==max returns fixed value", () => {
    const d = new JitteredDelay({ min: 15_000, max: 15_000 }, waveRange, seededRng(1));
    expect(d.spawnDelayMs()).toBe(15_000);
  });

  it("startupJitterMs returns 0 when max <= 0", () => {
    const d = new JitteredDelay(spawnRange, waveRange, seededRng(1));
    expect(d.startupJitterMs(0)).toBe(0);
    expect(d.startupJitterMs(-100)).toBe(0);
  });

  it("startupJitterMs stays in [0, max)", () => {
    const d = new JitteredDelay(spawnRange, waveRange, seededRng(1));
    for (let i = 0; i < 500; i++) {
      const v = d.startupJitterMs(5 * 60 * 1000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5 * 60 * 1000);
    }
  });
});

describe("seededRng", () => {
  it("produces deterministic sequence for same seed", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces values in [0, 1)", () => {
    const rng = seededRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds diverge", () => {
    const a = seededRng(1);
    const b = seededRng(2);
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      if (a() !== b()) diff++;
    }
    expect(diff).toBeGreaterThan(90);
  });
});

describe("constantRng", () => {
  it("returns the configured value", () => {
    const rng = constantRng(0.5);
    expect(rng()).toBe(0.5);
    expect(rng()).toBe(0.5);
  });

  it("rejects values outside [0, 1)", () => {
    expect(() => constantRng(1)).toThrow(RangeError);
    expect(() => constantRng(-0.1)).toThrow(RangeError);
  });
});
