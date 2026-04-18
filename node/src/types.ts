export interface WorkingWindowConfig {
  readonly start: string;
  readonly end: string;
  readonly tz: string;
}

export interface RangeMs {
  readonly min: number;
  readonly max: number;
}

export interface PacingConfig {
  readonly spawnDelayMs: RangeMs;
  readonly waveCooldownMs: RangeMs;
  readonly waveEveryN: number;
}

export interface LimitsConfig {
  readonly maxGlobalParallelSessions: number;
  readonly maxParallelPerProject: number;
  readonly maxActiveProjects: number;
}

export interface RunnerConfig {
  readonly claudeBinary: string;
  readonly taskTimeoutMs: number;
  readonly args: readonly string[];
}

export interface ResolvedConfig {
  readonly workingWindow: WorkingWindowConfig;
  readonly pacing: PacingConfig;
  readonly limits: LimitsConfig;
  readonly runner: RunnerConfig;
}

export interface PacerOptions {
  workingWindow?: Partial<WorkingWindowConfig>;
  pacing?: {
    spawnDelayMs?: Partial<RangeMs>;
    waveCooldownMs?: Partial<RangeMs>;
    waveEveryN?: number;
  };
  limits?: Partial<LimitsConfig>;
  runner?: Partial<RunnerConfig>;
  hooks?: HookMap;
  clock?: Clock;
  jitter?: JitterSource;
  runnerExec?: ExecFn;
}

export interface Task {
  readonly prompt: string;
  readonly projectId?: string;
  readonly cwd?: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TaskResult {
  readonly taskId: string;
  readonly projectId: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly waitedMs: number;
  readonly startedAt: number;
  readonly finishedAt: number;
}

export type BlockReason =
  | "window-closed"
  | "global-limit"
  | "project-limit"
  | "active-projects"
  | "wave-cooldown"
  | "upstream"
  | "overrun";

export interface EnqueuedEvent {
  readonly taskId: string;
  readonly projectId: string;
  readonly queueDepth: number;
}

export interface StartedEvent {
  readonly taskId: string;
  readonly projectId: string;
  readonly waitedMs: number;
  readonly globalActive: number;
  readonly projectActive: number;
}

export interface FinishedEvent extends StartedEvent {
  readonly exitCode: number;
  readonly durationMs: number;
}

export interface BlockedEvent {
  readonly reason: BlockReason;
  readonly msUntilRetry?: number;
  readonly detail?: string;
}

export interface HookMap {
  onEnqueued?: (e: EnqueuedEvent) => void;
  onStarted?: (e: StartedEvent) => void;
  onFinished?: (e: FinishedEvent) => void;
  onBlocked?: (e: BlockedEvent) => void;
}

export interface Clock {
  now(): number;
  monotonicMs(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export type JitterSource = () => number;

export interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type ExecFn = (
  binary: string,
  args: readonly string[],
  opts: ExecOptions,
) => Promise<ExecResult>;

export interface PacerStats {
  readonly queueDepth: number;
  readonly globalActive: number;
  readonly activeProjects: readonly string[];
  readonly spawnsSinceLastWave: number;
  readonly inWaveCooldown: boolean;
  readonly windowOpen: boolean;
}
