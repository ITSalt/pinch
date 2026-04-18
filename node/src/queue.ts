import type { Task } from "./types.js";

export interface PendingTask<R> {
  readonly id: string;
  readonly projectId: string;
  readonly task: Task;
  readonly enqueuedAtMonoMs: number;
  readonly resolve: (result: R) => void;
  readonly reject: (err: unknown) => void;
}

export class TaskQueue<R> {
  private readonly items: PendingTask<R>[] = [];
  private readonly drainCallbacks: Array<() => void> = [];

  get length(): number {
    return this.items.length;
  }

  enqueue(item: PendingTask<R>): void {
    this.items.push(item);
  }

  dequeue(): PendingTask<R> | undefined {
    const item = this.items.shift();
    if (this.items.length === 0) {
      this.notifyDrained();
    }
    return item;
  }

  peek(): PendingTask<R> | undefined {
    return this.items[0];
  }

  snapshot(): readonly PendingTask<R>[] {
    return [...this.items];
  }

  removeById(id: string): PendingTask<R> | undefined {
    const idx = this.items.findIndex((x) => x.id === id);
    if (idx < 0) return undefined;
    const [removed] = this.items.splice(idx, 1);
    if (this.items.length === 0) this.notifyDrained();
    return removed;
  }

  drain(): Promise<void> {
    if (this.items.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.drainCallbacks.push(resolve);
    });
  }

  private notifyDrained(): void {
    const callbacks = this.drainCallbacks.splice(0, this.drainCallbacks.length);
    for (const cb of callbacks) cb();
  }
}
