import { JitteredDelay } from "./jitter.js";
import { Notifier } from "./notifier.js";
import { TaskQueue, type PendingTask } from "./queue.js";
import { ClaudeRunner } from "./runner.js";
import { ProjectSemaphore, Semaphore } from "./semaphore.js";
import type {
  BlockReason,
  Clock,
  FinishedEvent,
  HookMap,
  ResolvedConfig,
  StartedEvent,
  Task,
  TaskResult,
} from "./types.js";
import { WorkingWindow } from "./window.js";

const UPSTREAM_PAUSE_MS = 60 * 60 * 1000;
const STARTUP_JITTER_MAX_MS = 5 * 60 * 1000;
const IDLE_POLL_MS = 10 * 60 * 1000;
const SHORT_POLL_MS = 10_000;
const FAST_FAIL_THRESHOLD_MS = 2_000;

export interface DispatcherStats {
  readonly queueDepth: number;
  readonly globalActive: number;
  readonly activeProjects: readonly string[];
  readonly spawnsSinceLastWave: number;
  readonly inWaveCooldown: boolean;
  readonly windowOpen: boolean;
}

export interface DispatcherDeps {
  readonly config: ResolvedConfig;
  readonly queue: TaskQueue<TaskResult>;
  readonly globalSem: Semaphore;
  readonly projectSem: ProjectSemaphore;
  readonly window: WorkingWindow;
  readonly jitter: JitteredDelay;
  readonly runner: ClaudeRunner;
  readonly clock: Clock;
  readonly hooks: HookMap;
}

export class Dispatcher {
  private readonly notifier = new Notifier();
  private running = false;
  private draining = false;
  private shuttingDown = false;
  private active = 0;
  private spawnsSinceLastWave = 0;
  private cooldownEndsMono = 0;
  private upstreamPauseEndsMono = 0;
  private nextSpawnReadyMono = 0;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly deps: DispatcherDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextSpawnReadyMono =
      this.deps.clock.monotonicMs() + this.deps.jitter.spawnDelayMs();
    this.loopPromise = this.loop();
  }

  enqueue(item: PendingTask<TaskResult>): void {
    if (this.shuttingDown) {
      item.reject(new Error("pinch: pacer is shutting down"));
      return;
    }
    this.deps.queue.enqueue(item);
    this.deps.hooks.onEnqueued?.({
      taskId: item.id,
      projectId: item.projectId,
      queueDepth: this.deps.queue.length,
    });
    this.notifier.notify();
  }

  stats(): DispatcherStats {
    return {
      queueDepth: this.deps.queue.length,
      globalActive: this.deps.globalSem.inUse,
      activeProjects: this.deps.projectSem.activeProjectIds(),
      spawnsSinceLastWave: this.spawnsSinceLastWave,
      inWaveCooldown: this.deps.clock.monotonicMs() < this.cooldownEndsMono,
      windowOpen: this.deps.window.isOpenNow(),
    };
  }

  async drain(): Promise<void> {
    this.draining = true;
    this.notifier.notify();
    while (this.deps.queue.length > 0 || this.active > 0) {
      await this.notifier.wait();
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.draining = true;
    this.notifier.notify();
    await this.drain();
    this.running = false;
    this.notifier.notify();
    if (this.loopPromise) await this.loopPromise;
  }

  private async loop(): Promise<void> {
    try {
      while (this.running) {
        if (this.shuttingDown && this.deps.queue.length === 0 && this.active === 0) {
          this.running = false;
          break;
        }

        if (this.deps.queue.length === 0) {
          await this.waitForSignal(IDLE_POLL_MS);
          continue;
        }

        if (!this.deps.window.isOpenNow()) {
          const waitMs =
            this.deps.window.msUntilNextOpen() +
            this.deps.jitter.startupJitterMs(STARTUP_JITTER_MAX_MS);
          this.emitBlocked("window-closed", waitMs);
          await this.waitForSignal(waitMs);
          continue;
        }

        const nowMono = this.deps.clock.monotonicMs();

        if (nowMono < this.upstreamPauseEndsMono) {
          const waitMs = this.upstreamPauseEndsMono - nowMono;
          this.emitBlocked("upstream", waitMs);
          await this.waitForSignal(waitMs);
          continue;
        }

        if (nowMono < this.cooldownEndsMono) {
          const waitMs = this.cooldownEndsMono - nowMono;
          this.emitBlocked("wave-cooldown", waitMs);
          await this.waitForSignal(waitMs);
          continue;
        }

        if (nowMono < this.nextSpawnReadyMono) {
          const waitMs = this.nextSpawnReadyMono - nowMono;
          await this.waitForSignal(waitMs);
          continue;
        }

        const pick = this.findAdmissible();
        if (!pick) {
          this.emitBlocked(this.diagnoseBlock());
          await this.waitForSignal(SHORT_POLL_MS);
          continue;
        }

        this.removeFromQueue(pick.item.id);
        this.active++;
        const spawnMono = this.deps.clock.monotonicMs();
        this.nextSpawnReadyMono = spawnMono + this.deps.jitter.spawnDelayMs();
        this.spawnsSinceLastWave++;
        if (this.spawnsSinceLastWave >= this.deps.config.pacing.waveEveryN) {
          this.cooldownEndsMono =
            this.deps.clock.monotonicMs() + this.deps.jitter.waveCooldownMs();
          this.spawnsSinceLastWave = 0;
        }
        void this.runTask(pick);
      }
    } finally {
      this.running = false;
      this.notifier.notify();
    }
  }

  private async runTask(pick: Admission): Promise<void> {
    const { item, globalRelease, projectRelease } = pick;
    const startedAt = this.deps.clock.now();
    const startMono = this.deps.clock.monotonicMs();
    const waitedMs = Math.max(startMono - item.enqueuedAtMonoMs, 0);

    const startedEvent: StartedEvent = {
      taskId: item.id,
      projectId: item.projectId,
      waitedMs,
      globalActive: this.deps.globalSem.inUse,
      projectActive: this.deps.projectSem.inUseFor(item.projectId),
    };
    this.deps.hooks.onStarted?.(startedEvent);

    try {
      const timeoutMs = item.task.timeoutMs ?? this.deps.config.runner.taskTimeoutMs;
      const out = await this.deps.runner.execute({
        prompt: item.task.prompt,
        ...(item.task.cwd !== undefined ? { cwd: item.task.cwd } : {}),
        ...(item.task.args !== undefined ? { extraArgs: item.task.args } : {}),
        timeoutMs,
      });
      const finishedAt = this.deps.clock.now();
      const durationMs = Math.max(this.deps.clock.monotonicMs() - startMono, 0);
      const result: TaskResult = {
        taskId: item.id,
        projectId: item.projectId,
        exitCode: out.exitCode,
        stdout: out.stdout,
        stderr: out.stderr,
        durationMs,
        waitedMs,
        startedAt,
        finishedAt,
      };
      item.resolve(result);
      const finishedEvent: FinishedEvent = {
        ...startedEvent,
        exitCode: out.exitCode,
        durationMs,
      };
      this.deps.hooks.onFinished?.(finishedEvent);

      if (out.exitCode !== 0 && durationMs < FAST_FAIL_THRESHOLD_MS) {
        this.nextSpawnReadyMono = this.deps.clock.monotonicMs();
      }

      if (out.upstream) {
        this.upstreamPauseEndsMono = this.deps.clock.monotonicMs() + UPSTREAM_PAUSE_MS;
      }
    } catch (err) {
      item.reject(err);
    } finally {
      projectRelease();
      globalRelease();
      this.active--;
      this.notifier.notify();
    }
  }

  private findAdmissible(): Admission | null {
    if (this.deps.globalSem.available <= 0) return null;
    for (const item of this.deps.queue.snapshot()) {
      const globalRelease = this.deps.globalSem.tryAcquire();
      if (!globalRelease) return null;
      const projectRelease = this.deps.projectSem.tryAcquire(item.projectId);
      if (projectRelease) {
        return { item, globalRelease, projectRelease };
      }
      globalRelease();
    }
    return null;
  }

  private diagnoseBlock(): BlockReason {
    if (this.deps.globalSem.available <= 0) return "global-limit";
    if (this.deps.projectSem.activeProjectIds().length >= this.deps.config.limits.maxActiveProjects) {
      return "active-projects";
    }
    return "project-limit";
  }

  private emitBlocked(reason: BlockReason, msUntilRetry?: number): void {
    if (!this.deps.hooks.onBlocked) return;
    this.deps.hooks.onBlocked({
      reason,
      ...(msUntilRetry !== undefined ? { msUntilRetry } : {}),
    });
  }

  private removeFromQueue(id: string): void {
    this.deps.queue.removeById(id);
  }

  private async waitForSignal(maxMs: number): Promise<void> {
    if (maxMs <= 0) return;
    await Promise.race([
      this.deps.clock.sleep(maxMs).catch(() => undefined),
      this.notifier.wait(),
    ]);
  }
}

interface Admission {
  readonly item: PendingTask<TaskResult>;
  readonly globalRelease: () => void;
  readonly projectRelease: () => void;
}

export type { Task };
