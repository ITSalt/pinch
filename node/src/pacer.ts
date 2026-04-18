import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath, sep } from "node:path";

import { resolveConfig } from "./config.js";
import { Dispatcher } from "./dispatcher.js";
import { JitteredDelay } from "./jitter.js";
import { TaskQueue, type PendingTask } from "./queue.js";
import { ClaudeRunner, defaultExec } from "./runner.js";
import { ProjectSemaphore, Semaphore } from "./semaphore.js";
import type {
  HookMap,
  JitterSource,
  PacerOptions,
  PacerStats,
  ResolvedConfig,
  Task,
  TaskResult,
  Clock,
  ExecFn,
} from "./types.js";
import { WorkingWindow, systemClock } from "./window.js";

const PROJECT_ID_RE = /^[a-z0-9_-]{1,64}$/;

export class Pacer {
  readonly config: ResolvedConfig;
  private readonly clock: Clock;
  private readonly hooks: HookMap;
  private readonly queue = new TaskQueue<TaskResult>();
  private readonly dispatcher: Dispatcher;
  private idCounter = 0;
  private closed = false;

  constructor(options: PacerOptions = {}) {
    this.config = resolveConfig(options);
    this.clock = options.clock ?? systemClock();
    this.hooks = options.hooks ?? {};
    const jitterSource: JitterSource = options.jitter ?? Math.random;
    const jitter = new JitteredDelay(
      this.config.pacing.spawnDelayMs,
      this.config.pacing.waveCooldownMs,
      jitterSource,
    );
    const globalSem = new Semaphore(this.config.limits.maxGlobalParallelSessions);
    const projectSem = new ProjectSemaphore(
      this.config.limits.maxParallelPerProject,
      this.config.limits.maxActiveProjects,
      this.clock,
    );
    const window = new WorkingWindow(this.config.workingWindow, this.clock);
    const exec: ExecFn = options.runnerExec ?? defaultExec();
    const runner = new ClaudeRunner(
      this.config.runner.claudeBinary,
      this.config.runner.args,
      exec,
      () => this.clock.monotonicMs(),
    );

    this.dispatcher = new Dispatcher({
      config: this.config,
      queue: this.queue,
      globalSem,
      projectSem,
      window,
      jitter,
      runner,
      clock: this.clock,
      hooks: this.hooks,
    });
    this.dispatcher.start();
  }

  run(task: Task): Promise<TaskResult> {
    if (this.closed) {
      return Promise.reject(new Error("pinch: pacer is shut down"));
    }
    if (typeof task?.prompt !== "string" || task.prompt.length === 0) {
      return Promise.reject(new Error("pinch: task.prompt must be a non-empty string"));
    }
    const projectId = resolveProjectId(task);
    const id = this.nextId();
    return new Promise<TaskResult>((resolve, reject) => {
      const item: PendingTask<TaskResult> = {
        id,
        projectId,
        task,
        enqueuedAtMonoMs: this.clock.monotonicMs(),
        resolve,
        reject,
      };
      this.dispatcher.enqueue(item);
    });
  }

  async runBatch(tasks: readonly Task[]): Promise<TaskResult[]> {
    const promises = tasks.map((t) => this.run(t));
    return Promise.all(promises);
  }

  drain(): Promise<void> {
    return this.dispatcher.drain();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await this.dispatcher.shutdown();
  }

  stats(): PacerStats {
    return this.dispatcher.stats();
  }

  private nextId(): string {
    this.idCounter++;
    return `t${this.idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function resolveProjectId(task: Task): string {
  if (task.projectId !== undefined) {
    if (!PROJECT_ID_RE.test(task.projectId)) {
      throw new Error(
        `pinch: projectId must match ${PROJECT_ID_RE}; got "${task.projectId}"`,
      );
    }
    return task.projectId;
  }
  const cwd = task.cwd ?? (typeof process !== "undefined" ? process.cwd() : "/");
  const absCwd = isAbsolute(cwd) ? cwd : resolvePath(cwd);
  const gitRoot = findGitRoot(absCwd);
  const base = gitRoot ?? safeRealpath(absCwd);
  return deriveProjectIdFromPath(base);
}

function findGitRoot(start: string): string | null {
  let current = start;
  for (let i = 0; i < 64; i++) {
    const gitDir = `${current}${sep}.git`;
    if (existsSync(gitDir)) {
      try {
        const st = statSync(gitDir);
        if (st.isDirectory() || st.isFile()) return current;
      } catch {
        // ignore
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function deriveProjectIdFromPath(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "root";
  const cleaned = last
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "root";
}
