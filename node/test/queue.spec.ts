import { describe, expect, it } from "vitest";
import { TaskQueue, type PendingTask } from "../src/queue.js";

function makeItem(id: string): PendingTask<string> {
  return {
    id,
    projectId: "p",
    task: { prompt: id },
    enqueuedAtMonoMs: 0,
    resolve: () => undefined,
    reject: () => undefined,
  };
}

describe("TaskQueue", () => {
  it("is FIFO", () => {
    const q = new TaskQueue<string>();
    q.enqueue(makeItem("a"));
    q.enqueue(makeItem("b"));
    q.enqueue(makeItem("c"));
    expect(q.length).toBe(3);
    expect(q.dequeue()?.id).toBe("a");
    expect(q.dequeue()?.id).toBe("b");
    expect(q.dequeue()?.id).toBe("c");
    expect(q.dequeue()).toBeUndefined();
    expect(q.length).toBe(0);
  });

  it("peek does not remove", () => {
    const q = new TaskQueue<string>();
    q.enqueue(makeItem("a"));
    expect(q.peek()?.id).toBe("a");
    expect(q.length).toBe(1);
  });

  it("snapshot returns a copy", () => {
    const q = new TaskQueue<string>();
    q.enqueue(makeItem("a"));
    const snap = q.snapshot();
    q.enqueue(makeItem("b"));
    expect(snap.length).toBe(1);
  });

  it("drain resolves immediately when empty", async () => {
    const q = new TaskQueue<string>();
    await expect(q.drain()).resolves.toBeUndefined();
  });

  it("drain resolves when queue becomes empty", async () => {
    const q = new TaskQueue<string>();
    q.enqueue(makeItem("a"));
    q.enqueue(makeItem("b"));
    let resolved = false;
    const p = q.drain().then(() => {
      resolved = true;
    });
    q.dequeue();
    expect(resolved).toBe(false);
    q.dequeue();
    await p;
    expect(resolved).toBe(true);
  });

  it("multiple drain waiters all resolve", async () => {
    const q = new TaskQueue<string>();
    q.enqueue(makeItem("a"));
    const p1 = q.drain();
    const p2 = q.drain();
    q.dequeue();
    await Promise.all([p1, p2]);
  });
});
