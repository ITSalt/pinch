import { validateInvariants } from "./invariants.js";
import type {
  LimitsConfig,
  PacerOptions,
  PacingConfig,
  ResolvedConfig,
  RunnerConfig,
  WorkingWindowConfig,
} from "./types.js";

export const DEFAULT_CONFIG: ResolvedConfig = Object.freeze({
  workingWindow: Object.freeze({
    start: "08:00",
    end: "23:00",
    tz: resolveSystemTimeZone(),
  }) as WorkingWindowConfig,
  pacing: Object.freeze({
    spawnDelayMs: Object.freeze({ min: 15_000, max: 30_000 }),
    waveCooldownMs: Object.freeze({ min: 120_000, max: 300_000 }),
    waveEveryN: 5,
  }) as PacingConfig,
  limits: Object.freeze({
    maxGlobalParallelSessions: 5,
    maxParallelPerProject: 3,
    maxActiveProjects: 3,
  }) as LimitsConfig,
  runner: Object.freeze({
    claudeBinary: "claude",
    taskTimeoutMs: 600_000,
    args: Object.freeze(["--print"]) as readonly string[],
  }) as RunnerConfig,
});

export interface ResolveContext {
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function resolveConfig(
  options: PacerOptions | undefined,
  ctx: ResolveContext = {},
): ResolvedConfig {
  const env = ctx.env ?? (typeof process !== "undefined" ? process.env : {});
  const envOverlay = readEnvOverlay(env);
  const user = options ?? {};

  const merged: ResolvedConfig = Object.freeze({
    workingWindow: Object.freeze({
      start: pick(user.workingWindow?.start, envOverlay.workingWindow?.start, DEFAULT_CONFIG.workingWindow.start),
      end: pick(user.workingWindow?.end, envOverlay.workingWindow?.end, DEFAULT_CONFIG.workingWindow.end),
      tz: pick(user.workingWindow?.tz, envOverlay.workingWindow?.tz, DEFAULT_CONFIG.workingWindow.tz),
    }),
    pacing: Object.freeze({
      spawnDelayMs: Object.freeze({
        min: pick(user.pacing?.spawnDelayMs?.min, envOverlay.pacing?.spawnDelayMs?.min, DEFAULT_CONFIG.pacing.spawnDelayMs.min),
        max: pick(user.pacing?.spawnDelayMs?.max, envOverlay.pacing?.spawnDelayMs?.max, DEFAULT_CONFIG.pacing.spawnDelayMs.max),
      }),
      waveCooldownMs: Object.freeze({
        min: pick(user.pacing?.waveCooldownMs?.min, envOverlay.pacing?.waveCooldownMs?.min, DEFAULT_CONFIG.pacing.waveCooldownMs.min),
        max: pick(user.pacing?.waveCooldownMs?.max, envOverlay.pacing?.waveCooldownMs?.max, DEFAULT_CONFIG.pacing.waveCooldownMs.max),
      }),
      waveEveryN: pick(user.pacing?.waveEveryN, envOverlay.pacing?.waveEveryN, DEFAULT_CONFIG.pacing.waveEveryN),
    }),
    limits: Object.freeze({
      maxGlobalParallelSessions: pick(user.limits?.maxGlobalParallelSessions, envOverlay.limits?.maxGlobalParallelSessions, DEFAULT_CONFIG.limits.maxGlobalParallelSessions),
      maxParallelPerProject: pick(user.limits?.maxParallelPerProject, envOverlay.limits?.maxParallelPerProject, DEFAULT_CONFIG.limits.maxParallelPerProject),
      maxActiveProjects: pick(user.limits?.maxActiveProjects, envOverlay.limits?.maxActiveProjects, DEFAULT_CONFIG.limits.maxActiveProjects),
    }),
    runner: Object.freeze({
      claudeBinary: pick(user.runner?.claudeBinary, envOverlay.runner?.claudeBinary, DEFAULT_CONFIG.runner.claudeBinary),
      taskTimeoutMs: pick(user.runner?.taskTimeoutMs, envOverlay.runner?.taskTimeoutMs, DEFAULT_CONFIG.runner.taskTimeoutMs),
      args: Object.freeze([...(user.runner?.args ?? envOverlay.runner?.args ?? DEFAULT_CONFIG.runner.args)]),
    }),
  });

  validateInvariants(merged);
  return merged;
}

function pick<T>(...values: (T | undefined)[]): T {
  for (const v of values) {
    if (v !== undefined) return v;
  }
  throw new Error("pinch: no default available for config field");
}

interface EnvOverlay {
  workingWindow?: { start?: string; end?: string; tz?: string };
  pacing?: {
    spawnDelayMs?: { min?: number; max?: number };
    waveCooldownMs?: { min?: number; max?: number };
    waveEveryN?: number;
  };
  limits?: {
    maxGlobalParallelSessions?: number;
    maxParallelPerProject?: number;
    maxActiveProjects?: number;
  };
  runner?: { claudeBinary?: string; taskTimeoutMs?: number; args?: readonly string[] };
}

function readEnvOverlay(env: Readonly<Record<string, string | undefined>>): EnvOverlay {
  const overlay: EnvOverlay = {};
  const num = (key: string): number | undefined => {
    const raw = env[key];
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return n;
  };
  const str = (key: string): string | undefined => {
    const raw = env[key];
    return raw === undefined || raw === "" ? undefined : raw;
  };

  const windowStart = str("PINCH_WINDOW_START");
  const windowEnd = str("PINCH_WINDOW_END");
  const windowTz = str("PINCH_WINDOW_TZ");
  if (windowStart || windowEnd || windowTz) {
    overlay.workingWindow = {};
    if (windowStart) overlay.workingWindow.start = windowStart;
    if (windowEnd) overlay.workingWindow.end = windowEnd;
    if (windowTz) overlay.workingWindow.tz = windowTz;
  }

  const spawnMin = num("PINCH_SPAWN_DELAY_MIN_MS");
  const spawnMax = num("PINCH_SPAWN_DELAY_MAX_MS");
  const waveMin = num("PINCH_WAVE_COOLDOWN_MIN_MS");
  const waveMax = num("PINCH_WAVE_COOLDOWN_MAX_MS");
  const waveEveryN = num("PINCH_WAVE_EVERY_N");
  if (spawnMin !== undefined || spawnMax !== undefined || waveMin !== undefined || waveMax !== undefined || waveEveryN !== undefined) {
    overlay.pacing = {};
    if (spawnMin !== undefined || spawnMax !== undefined) {
      overlay.pacing.spawnDelayMs = {};
      if (spawnMin !== undefined) overlay.pacing.spawnDelayMs.min = spawnMin;
      if (spawnMax !== undefined) overlay.pacing.spawnDelayMs.max = spawnMax;
    }
    if (waveMin !== undefined || waveMax !== undefined) {
      overlay.pacing.waveCooldownMs = {};
      if (waveMin !== undefined) overlay.pacing.waveCooldownMs.min = waveMin;
      if (waveMax !== undefined) overlay.pacing.waveCooldownMs.max = waveMax;
    }
    if (waveEveryN !== undefined) overlay.pacing.waveEveryN = waveEveryN;
  }

  const maxGlobal = num("PINCH_MAX_GLOBAL_PARALLEL");
  const maxPerProject = num("PINCH_MAX_PER_PROJECT");
  const maxActive = num("PINCH_MAX_ACTIVE_PROJECTS");
  if (maxGlobal !== undefined || maxPerProject !== undefined || maxActive !== undefined) {
    overlay.limits = {};
    if (maxGlobal !== undefined) overlay.limits.maxGlobalParallelSessions = maxGlobal;
    if (maxPerProject !== undefined) overlay.limits.maxParallelPerProject = maxPerProject;
    if (maxActive !== undefined) overlay.limits.maxActiveProjects = maxActive;
  }

  const claudeBin = str("PINCH_CLAUDE_BINARY");
  const taskTimeout = num("PINCH_TASK_TIMEOUT_MS");
  if (claudeBin !== undefined || taskTimeout !== undefined) {
    overlay.runner = {};
    if (claudeBin !== undefined) overlay.runner.claudeBinary = claudeBin;
    if (taskTimeout !== undefined) overlay.runner.taskTimeoutMs = taskTimeout;
  }

  return overlay;
}

function resolveSystemTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}
