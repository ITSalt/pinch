import { describe, expect, it } from "vitest";
import { ProjectSemaphore, Semaphore } from "../src/semaphore.js";
import type { Clock } from "../src/types.js";

function fakeClock(initialMono = 0): Clock & { advance: (ms: number) => void } {
  let mono = initialMono;
  return {
    now: () => 0,
    monotonicMs: () => mono,
    sleep: async () => undefined,
    advance: (ms: number) => {
      mono += ms;
    },
  };
}

describe("Semaphore", () => {
  it("rejects invalid capacity", () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(-1)).toThrow(RangeError);
    expect(() => new Semaphore(1.5)).toThrow(RangeError);
  });

  it("grants immediately when available", async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    expect(sem.inUse).toBe(1);
    expect(sem.available).toBe(1);
    r1();
    expect(sem.inUse).toBe(0);
    expect(sem.available).toBe(2);
  });

  it("enforces FIFO for waiters", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const r1 = await sem.acquire();
    const p2 = sem.acquire().then((r) => {
      order.push(2);
      return r;
    });
    const p3 = sem.acquire().then((r) => {
      order.push(3);
      return r;
    });
    expect(sem.pending).toBe(2);
    r1();
    const r2 = await p2;
    r2();
    const r3 = await p3;
    r3();
    expect(order).toEqual([2, 3]);
  });

  it("release is idempotent", async () => {
    const sem = new Semaphore(1);
    const r = await sem.acquire();
    r();
    r();
    expect(sem.inUse).toBe(0);
    expect(sem.available).toBe(1);
  });

  it("tryAcquire returns null when full", () => {
    const sem = new Semaphore(1);
    const r = sem.tryAcquire();
    expect(r).not.toBeNull();
    expect(sem.tryAcquire()).toBeNull();
    r?.();
    expect(sem.tryAcquire()).not.toBeNull();
  });

  it("never exceeds capacity under contention", async () => {
    const sem = new Semaphore(3);
    let peak = 0;
    const run = async (): Promise<void> => {
      const r = await sem.acquire();
      peak = Math.max(peak, sem.inUse);
      await new Promise((res) => setTimeout(res, 1));
      r();
    };
    await Promise.all(Array.from({ length: 20 }, run));
    expect(peak).toBeLessThanOrEqual(3);
    expect(sem.inUse).toBe(0);
  });
});

describe("ProjectSemaphore", () => {
  it("enforces per-project capacity", () => {
    const clock = fakeClock();
    const ps = new ProjectSemaphore(2, 3, clock);
    const r1 = ps.tryAcquire("a");
    const r2 = ps.tryAcquire("a");
    const r3 = ps.tryAcquire("a");
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).toBeNull();
    r1?.();
    expect(ps.tryAcquire("a")).not.toBeNull();
  });

  it("enforces maxActiveProjects", () => {
    const clock = fakeClock();
    const ps = new ProjectSemaphore(2, 2, clock);
    const r1 = ps.tryAcquire("a");
    const r2 = ps.tryAcquire("b");
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(ps.tryAcquire("c")).toBeNull();
  });

  it("project remains 'active' during the activity window after release", () => {
    const clock = fakeClock();
    const ps = new ProjectSemaphore(1, 2, clock, 10 * 60 * 1000);
    const r1 = ps.tryAcquire("a");
    const r2 = ps.tryAcquire("b");
    r1?.();
    r2?.();
    expect(ps.activeProjectIds().sort()).toEqual(["a", "b"]);
    expect(ps.tryAcquire("c")).toBeNull();
  });

  it("project drops out of active set after activity window", () => {
    const clock = fakeClock();
    const ps = new ProjectSemaphore(1, 2, clock, 10 * 60 * 1000);
    const r1 = ps.tryAcquire("a");
    r1?.();
    clock.advance(11 * 60 * 1000);
    expect(ps.activeProjectIds()).toEqual([]);
    const r2 = ps.tryAcquire("b");
    const r3 = ps.tryAcquire("c");
    expect(r2).not.toBeNull();
    expect(r3).not.toBeNull();
  });

  it("inUseFor reports running count", () => {
    const clock = fakeClock();
    const ps = new ProjectSemaphore(3, 3, clock);
    const r1 = ps.tryAcquire("a");
    const r2 = ps.tryAcquire("a");
    expect(ps.inUseFor("a")).toBe(2);
    expect(ps.inUseFor("unseen")).toBe(0);
    r1?.();
    r2?.();
    expect(ps.inUseFor("a")).toBe(0);
  });

  it("existing project with active tasks always admits", () => {
    const clock = fakeClock();
    const ps = new ProjectSemaphore(3, 1, clock);
    const r1 = ps.tryAcquire("a");
    expect(r1).not.toBeNull();
    const r2 = ps.tryAcquire("a");
    expect(r2).not.toBeNull();
  });
});
