import type { Clock } from "./types.js";

type Waiter = () => void;

export class Semaphore {
  private permits: number;
  private readonly waiters: Waiter[] = [];

  constructor(
    public readonly capacity: number,
    private active = 0,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`Semaphore capacity must be an integer >= 1; got ${capacity}`);
    }
    this.permits = capacity;
  }

  get available(): number {
    return this.permits;
  }

  get inUse(): number {
    return this.active;
  }

  get pending(): number {
    return this.waiters.length;
  }

  acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const grant = (): void => {
        this.permits--;
        this.active++;
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          this.active--;
          this.permits++;
          this.drainOne();
        };
        resolve(release);
      };
      if (this.permits > 0) {
        grant();
      } else {
        this.waiters.push(grant);
      }
    });
  }

  tryAcquire(): (() => void) | null {
    if (this.permits <= 0) return null;
    this.permits--;
    this.active++;
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.active--;
      this.permits++;
      this.drainOne();
    };
  }

  private drainOne(): void {
    const next = this.waiters.shift();
    if (next) next();
  }
}

export interface ProjectActivity {
  readonly projectId: string;
  readonly lastActivityMs: number;
}

export class ProjectSemaphore {
  private readonly perProject = new Map<string, Semaphore>();
  private readonly lastActivity = new Map<string, number>();

  constructor(
    private readonly perProjectCapacity: number,
    private readonly maxActiveProjects: number,
    private readonly clock: Clock,
    private readonly activityWindowMs = 10 * 60 * 1000,
  ) {
    if (!Number.isInteger(perProjectCapacity) || perProjectCapacity < 1) {
      throw new RangeError(`perProjectCapacity must be integer >= 1; got ${perProjectCapacity}`);
    }
    if (!Number.isInteger(maxActiveProjects) || maxActiveProjects < 1) {
      throw new RangeError(`maxActiveProjects must be integer >= 1; got ${maxActiveProjects}`);
    }
  }

  tryAcquire(projectId: string): (() => void) | null {
    if (!this.canAdmitProject(projectId)) return null;
    const sem = this.getSemaphore(projectId);
    const innerRelease = sem.tryAcquire();
    if (!innerRelease) return null;
    this.lastActivity.set(projectId, this.clock.monotonicMs());
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.lastActivity.set(projectId, this.clock.monotonicMs());
      innerRelease();
    };
  }

  private canAdmitProject(projectId: string): boolean {
    if (this.perProject.has(projectId)) {
      const existing = this.perProject.get(projectId);
      if (existing && existing.inUse > 0) return true;
    }
    const activeCount = this.activeProjectIds().length;
    return activeCount < this.maxActiveProjects;
  }

  inUseFor(projectId: string): number {
    return this.perProject.get(projectId)?.inUse ?? 0;
  }

  activeProjectIds(): string[] {
    const now = this.clock.monotonicMs();
    const active: string[] = [];
    for (const [id, sem] of this.perProject.entries()) {
      if (sem.inUse > 0) {
        active.push(id);
        continue;
      }
      const last = this.lastActivity.get(id) ?? 0;
      if (now - last <= this.activityWindowMs) {
        active.push(id);
      }
    }
    return active;
  }

  private getSemaphore(projectId: string): Semaphore {
    let sem = this.perProject.get(projectId);
    if (!sem) {
      sem = new Semaphore(this.perProjectCapacity);
      this.perProject.set(projectId, sem);
    }
    return sem;
  }
}
