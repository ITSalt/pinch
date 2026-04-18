import type { ResolvedConfig } from "./types.js";

export const HARD_INVARIANTS = Object.freeze({
  maxGlobalParallelSessions: 5,
  maxParallelPerProject: 3,
  maxActiveProjects: 3,
  minDowntimeHoursPerDay: 8,
  maxWorkingHoursPerDay: 16,
  minSpawnDelayMs: 15_000,
  minWaveCooldownMs: 120_000,
} as const);

export class InvariantViolation extends Error {
  constructor(
    public readonly invariant: string,
    public readonly configured: unknown,
    public readonly bound: unknown,
    message?: string,
  ) {
    super(
      message ??
        `pinch invariant '${invariant}' violated: configured=${stringify(configured)}, bound=${stringify(bound)}`,
    );
    this.name = "InvariantViolation";
  }
}

export function validateInvariants(config: ResolvedConfig): void {
  validateLimits(config);
  validatePacing(config);
  validateWindow(config);
}

function validateLimits(config: ResolvedConfig): void {
  const { limits } = config;

  assertRange(
    "maxGlobalParallelSessions",
    limits.maxGlobalParallelSessions,
    1,
    HARD_INVARIANTS.maxGlobalParallelSessions,
  );
  assertRange(
    "maxParallelPerProject",
    limits.maxParallelPerProject,
    1,
    HARD_INVARIANTS.maxParallelPerProject,
  );
  assertRange(
    "maxActiveProjects",
    limits.maxActiveProjects,
    1,
    HARD_INVARIANTS.maxActiveProjects,
  );
  if (limits.maxParallelPerProject > limits.maxGlobalParallelSessions) {
    throw new InvariantViolation(
      "maxParallelPerProject",
      limits.maxParallelPerProject,
      `<=maxGlobalParallelSessions(${limits.maxGlobalParallelSessions})`,
    );
  }
}

function validatePacing(config: ResolvedConfig): void {
  const { pacing } = config;

  if (pacing.spawnDelayMs.min < HARD_INVARIANTS.minSpawnDelayMs) {
    throw new InvariantViolation(
      "pacing.spawnDelayMs.min",
      pacing.spawnDelayMs.min,
      `>=${HARD_INVARIANTS.minSpawnDelayMs}`,
    );
  }
  if (pacing.spawnDelayMs.max < pacing.spawnDelayMs.min) {
    throw new InvariantViolation(
      "pacing.spawnDelayMs.max",
      pacing.spawnDelayMs.max,
      `>=min(${pacing.spawnDelayMs.min})`,
    );
  }
  if (pacing.waveCooldownMs.min < HARD_INVARIANTS.minWaveCooldownMs) {
    throw new InvariantViolation(
      "pacing.waveCooldownMs.min",
      pacing.waveCooldownMs.min,
      `>=${HARD_INVARIANTS.minWaveCooldownMs}`,
    );
  }
  if (pacing.waveCooldownMs.max < pacing.waveCooldownMs.min) {
    throw new InvariantViolation(
      "pacing.waveCooldownMs.max",
      pacing.waveCooldownMs.max,
      `>=min(${pacing.waveCooldownMs.min})`,
    );
  }
  if (!Number.isInteger(pacing.waveEveryN) || pacing.waveEveryN < 1) {
    throw new InvariantViolation("pacing.waveEveryN", pacing.waveEveryN, ">=1 integer");
  }
}

function validateWindow(config: ResolvedConfig): void {
  const { workingWindow } = config;
  const durationMinutes = computeWindowDurationMinutes(workingWindow.start, workingWindow.end);
  const durationHours = durationMinutes / 60;

  if (durationHours > HARD_INVARIANTS.maxWorkingHoursPerDay) {
    throw new InvariantViolation(
      "workingWindow.duration",
      `${durationHours.toFixed(2)}h`,
      `<=${HARD_INVARIANTS.maxWorkingHoursPerDay}h`,
    );
  }
  const downtimeHours = 24 - durationHours;
  if (downtimeHours < HARD_INVARIANTS.minDowntimeHoursPerDay) {
    throw new InvariantViolation(
      "workingWindow.downtime",
      `${downtimeHours.toFixed(2)}h`,
      `>=${HARD_INVARIANTS.minDowntimeHoursPerDay}h`,
    );
  }
}

export function computeWindowDurationMinutes(start: string, end: string): number {
  const startMin = parseHHMMToMinutes(start, "workingWindow.start");
  const endMin = parseHHMMToMinutes(end, "workingWindow.end");
  if (endMin <= startMin) {
    throw new InvariantViolation(
      "workingWindow",
      `${start}-${end}`,
      "end must be strictly after start (no wrap-around in v1)",
    );
  }
  return endMin - startMin;
}

export function parseHHMMToMinutes(s: string, field: string): number {
  if (typeof s !== "string") {
    throw new InvariantViolation(field, s, 'string "HH:MM"');
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) {
    throw new InvariantViolation(field, s, '"HH:MM" format');
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) {
    throw new InvariantViolation(field, s, "00:00..24:00");
  }
  if (h === 24 && min !== 0) {
    throw new InvariantViolation(field, s, "24:00 is the only valid 24-prefixed value");
  }
  return h * 60 + min;
}

function assertRange(field: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value)) {
    throw new InvariantViolation(field, value, "integer");
  }
  if (value < min) {
    throw new InvariantViolation(field, value, `>=${min}`);
  }
  if (value > max) {
    throw new InvariantViolation(field, value, `<=${max}`);
  }
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
