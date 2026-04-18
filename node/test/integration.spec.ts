import { describe, expect, it } from "vitest";
import { Pacer } from "../src/pacer.js";
import { seededRng } from "../src/jitter.js";
import type {
  BlockedEvent,
  Clock,
  ExecFn,
  FinishedEvent,
  StartedEvent,
  Task,
} from "../src/types.js";

class FakeClock implements Clock {
  private mono = 0;
  private epoch: number;
  private sleepers: Array<{ resolve: () => void; targetMono: number }> = [];
  private ticker: NodeJS.Immediate | null = null;

  constructor(initialEpoch = Date.UTC(2025, 5, 15, 10, 0, 0)) {
    this.epoch = initialEpoch;
  }

  now(): number {
    return this.epoch;
  }

  monotonicMs(): number {
    return this.mono;
  }

  sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return new Promise<void>((resolve) => setImmediate(resolve));
    }
    return new Promise<void>((resolve) => {
      this.sleepers.push({ resolve, targetMono: this.mono + ms });
      this.scheduleTick();
    });
  }

  advance(ms: number): void {
    if (ms > 0) {
      this.mono += ms;
      this.epoch += ms;
      this.fireResolved();
    }
  }

  private scheduleTick(): void {
    if (this.ticker) return;
    this.ticker = setImmediate(() => {
      this.ticker = null;
      this.advanceToNextSleeper();
    });
  }

  private advanceToNextSleeper(): void {
    if (this.sleepers.length === 0) return;
    let earliestTarget = Number.POSITIVE_INFINITY;
    for (const s of this.sleepers) {
      if (s.targetMono < earliestTarget) earliestTarget = s.targetMono;
    }
    const delta = earliestTarget - this.mono;
    if (delta > 0) {
      this.mono += delta;
      this.epoch += delta;
    }
    this.fireResolved();
    if (this.sleepers.length > 0) this.scheduleTick();
  }

  private fireResolved(): void {
    const fired: Array<() => void> = [];
    this.sleepers = this.sleepers.filter((s) => {
      if (this.mono >= s.targetMono) {
        fired.push(s.resolve);
        return false;
      }
      return true;
    });
    for (const r of fired) r();
  }
}

function makeMockExec(clock: FakeClock, simDurationMs: number): ExecFn {
  return async () => {
    clock.advance(simDurationMs);
    await Promise.resolve();
    return { stdout: "ok", stderr: "", exitCode: 0 };
  };
}

class ExecGate {
  private waiters: Array<() => void> = [];

  wait(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(n: number): void {
    for (let i = 0; i < n && this.waiters.length > 0; i++) {
      const w = this.waiters.shift();
      w?.();
    }
  }

  releaseAll(): void {
    this.release(this.waiters.length);
  }

  get pending(): number {
    return this.waiters.length;
  }
}

function makeGatedExec(clock: FakeClock, gate: ExecGate, simDurationMs: number): ExecFn {
  return async () => {
    await gate.wait();
    clock.advance(simDurationMs);
    return { stdout: "ok", stderr: "", exitCode: 0 };
  };
}

async function settle(cycles = 3): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

describe("Pacer — integration", () => {
  it("runs a single task to completion", async () => {
    const clock = new FakeClock();
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(1),
      runnerExec: makeMockExec(clock, 500),
    });
    const result = await pacer.run({ prompt: "hello", projectId: "alpha" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.projectId).toBe("alpha");
    expect(result.durationMs).toBe(500);
    await pacer.shutdown();
  }, 10_000);

  it("never exceeds global parallel cap of 5 across 20 tasks", async () => {
    const clock = new FakeClock();
    const peak = { global: 0 };
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(7),
      runnerExec: makeMockExec(clock, 500),
      hooks: {
        onStarted: (e: StartedEvent) => {
          if (e.globalActive > peak.global) peak.global = e.globalActive;
        },
      },
    });
    const tasks: Task[] = Array.from({ length: 20 }, (_, i) => ({
      prompt: `task-${i}`,
      projectId: `p-${i % 3}`,
    }));
    const results = await pacer.runBatch(tasks);
    expect(results).toHaveLength(20);
    for (const r of results) expect(r.exitCode).toBe(0);
    expect(peak.global).toBeLessThanOrEqual(5);
    await pacer.shutdown();
  }, 30_000);

  it("never exceeds 3 parallel per project", async () => {
    const clock = new FakeClock();
    const peakPerProject = new Map<string, number>();
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(13),
      runnerExec: makeMockExec(clock, 500),
      hooks: {
        onStarted: (e: StartedEvent) => {
          const cur = peakPerProject.get(e.projectId) ?? 0;
          if (e.projectActive > cur) peakPerProject.set(e.projectId, e.projectActive);
        },
      },
    });
    const tasks: Task[] = Array.from({ length: 15 }, (_, i) => ({
      prompt: `task-${i}`,
      projectId: `p-${i % 2}`,
    }));
    await pacer.runBatch(tasks);
    for (const [, peak] of peakPerProject) {
      expect(peak).toBeLessThanOrEqual(3);
    }
    await pacer.shutdown();
  }, 30_000);

  it("never exceeds 3 active projects simultaneously", async () => {
    const clock = new FakeClock();
    let peakProjects = 0;
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(21),
      runnerExec: makeMockExec(clock, 300),
      hooks: {
        onStarted: () => {
          const s = pacer.stats();
          if (s.activeProjects.length > peakProjects) peakProjects = s.activeProjects.length;
        },
      },
    });
    const tasks: Task[] = Array.from({ length: 10 }, (_, i) => ({
      prompt: `t-${i}`,
      projectId: `p-${i % 5}`,
    }));
    await pacer.runBatch(tasks);
    expect(peakProjects).toBeLessThanOrEqual(3);
    await pacer.shutdown();
  }, 30_000);

  it("enforces minimum spawn delay between started tasks", async () => {
    const clock = new FakeClock();
    const startTimes: number[] = [];
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(42),
      runnerExec: makeMockExec(clock, 100),
      hooks: {
        onStarted: () => startTimes.push(clock.monotonicMs()),
      },
    });
    const tasks: Task[] = Array.from({ length: 4 }, (_, i) => ({
      prompt: `t-${i}`,
      projectId: "alpha",
    }));
    await pacer.runBatch(tasks);
    for (let i = 1; i < startTimes.length; i++) {
      const curr = startTimes[i];
      const prev = startTimes[i - 1];
      if (curr === undefined || prev === undefined) continue;
      const delta = curr - prev;
      expect(delta).toBeGreaterThanOrEqual(15_000);
    }
    await pacer.shutdown();
  }, 30_000);

  it("enters wave cooldown after waveEveryN spawns", async () => {
    const clock = new FakeClock();
    const startTimes: number[] = [];
    const blockedReasons: string[] = [];
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(99),
      pacing: { waveEveryN: 3 },
      runnerExec: makeMockExec(clock, 100),
      hooks: {
        onStarted: () => startTimes.push(clock.monotonicMs()),
        onBlocked: (e: BlockedEvent) => blockedReasons.push(e.reason),
      },
    });
    const tasks: Task[] = Array.from({ length: 7 }, (_, i) => ({
      prompt: `t-${i}`,
      projectId: "alpha",
    }));
    await pacer.runBatch(tasks);
    expect(blockedReasons).toContain("wave-cooldown");
    const gap34 = (startTimes[3] ?? 0) - (startTimes[2] ?? 0);
    expect(gap34).toBeGreaterThanOrEqual(120_000);
    await pacer.shutdown();
  }, 30_000);

  it("blocks when window is closed and waits to open", async () => {
    const clock = new FakeClock(Date.UTC(2025, 5, 15, 5, 0, 0));
    const blockedReasons: string[] = [];
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(2),
      runnerExec: makeMockExec(clock, 100),
      hooks: {
        onBlocked: (e) => blockedReasons.push(e.reason),
      },
    });
    const result = await pacer.run({ prompt: "late", projectId: "alpha" });
    expect(result.exitCode).toBe(0);
    expect(blockedReasons).toContain("window-closed");
    expect(clock.now()).toBeGreaterThanOrEqual(Date.UTC(2025, 5, 15, 8, 0, 0));
    await pacer.shutdown();
  }, 15_000);

  it("rejects run() after shutdown", async () => {
    const clock = new FakeClock();
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(3),
      runnerExec: makeMockExec(clock, 100),
    });
    await pacer.shutdown();
    await expect(pacer.run({ prompt: "nope" })).rejects.toThrow(/shut down/);
  }, 10_000);

  it("drain resolves when queue is empty and no active tasks", async () => {
    const clock = new FakeClock();
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(4),
      runnerExec: makeMockExec(clock, 100),
    });
    const p1 = pacer.run({ prompt: "a", projectId: "alpha" });
    const p2 = pacer.run({ prompt: "b", projectId: "alpha" });
    await pacer.drain();
    await Promise.all([p1, p2]);
    expect(pacer.stats().queueDepth).toBe(0);
    expect(pacer.stats().globalActive).toBe(0);
    await pacer.shutdown();
  }, 15_000);

  it("actually reaches the 5-parallel ceiling under gated exec", async () => {
    const clock = new FakeClock();
    const gate = new ExecGate();
    let peakGlobal = 0;
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(100),
      runnerExec: makeGatedExec(clock, gate, 100),
      hooks: {
        onStarted: (e: StartedEvent) => {
          if (e.globalActive > peakGlobal) peakGlobal = e.globalActive;
        },
      },
    });
    const tasks: Task[] = Array.from({ length: 12 }, (_, i) => ({
      prompt: `t-${i}`,
      projectId: `p-${i % 3}`,
    }));
    const batch = pacer.runBatch(tasks);
    for (let cycle = 0; cycle < 100; cycle++) {
      await settle();
      if (pacer.stats().globalActive >= 5) break;
    }
    expect(pacer.stats().globalActive).toBe(5);
    expect(peakGlobal).toBe(5);
    while (pacer.stats().queueDepth > 0 || pacer.stats().globalActive > 0 || gate.pending > 0) {
      gate.releaseAll();
      await settle();
    }
    await batch;
    expect(peakGlobal).toBeLessThanOrEqual(5);
    await pacer.shutdown();
  }, 30_000);

  it("stats reflects runtime state", async () => {
    const clock = new FakeClock();
    const finishedIds: string[] = [];
    const pacer = new Pacer({
      workingWindow: { start: "08:00", end: "23:00", tz: "UTC" },
      clock,
      jitter: seededRng(5),
      runnerExec: makeMockExec(clock, 100),
      hooks: {
        onFinished: (e: FinishedEvent) => finishedIds.push(e.taskId),
      },
    });
    await pacer.runBatch([
      { prompt: "a", projectId: "alpha" },
      { prompt: "b", projectId: "beta" },
    ]);
    expect(finishedIds).toHaveLength(2);
    const stats = pacer.stats();
    expect(stats.queueDepth).toBe(0);
    expect(stats.globalActive).toBe(0);
    expect(stats.windowOpen).toBe(true);
    await pacer.shutdown();
  }, 15_000);
});
