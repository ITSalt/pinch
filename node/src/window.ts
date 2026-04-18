import { parseHHMMToMinutes } from "./invariants.js";
import type { Clock, WorkingWindowConfig } from "./types.js";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;

export class WorkingWindow {
  private readonly startMin: number;
  private readonly endMin: number;

  constructor(
    private readonly config: WorkingWindowConfig,
    private readonly clock: Clock,
  ) {
    this.startMin = parseHHMMToMinutes(config.start, "workingWindow.start");
    this.endMin = parseHHMMToMinutes(config.end, "workingWindow.end");
  }

  isOpenNow(): boolean {
    const nowMin = this.currentMinutesOfDay();
    return nowMin >= this.startMin && nowMin < this.endMin;
  }

  msUntilNextOpen(): number {
    if (this.isOpenNow()) return 0;
    const nowMin = this.currentMinutesOfDay();
    const nowSec = this.currentSecondsPastMinute();

    let offsetMin: number;
    if (nowMin < this.startMin) {
      offsetMin = this.startMin - nowMin;
    } else {
      offsetMin = MINUTES_PER_DAY - nowMin + this.startMin;
    }
    const ms = offsetMin * MS_PER_MINUTE - nowSec * 1000;
    return Math.max(ms, 0);
  }

  msUntilClose(): number {
    if (!this.isOpenNow()) return 0;
    const nowMin = this.currentMinutesOfDay();
    const nowSec = this.currentSecondsPastMinute();
    const ms = (this.endMin - nowMin) * MS_PER_MINUTE - nowSec * 1000;
    return Math.max(ms, 0);
  }

  describe(): string {
    return `${this.config.start}-${this.config.end} ${this.config.tz}`;
  }

  private currentMinutesOfDay(): number {
    const wc = wallClockInTz(this.clock.now(), this.config.tz);
    return wc.hour * 60 + wc.minute;
  }

  private currentSecondsPastMinute(): number {
    const wc = wallClockInTz(this.clock.now(), this.config.tz);
    return wc.second;
  }
}

export interface WallClock {
  hour: number;
  minute: number;
  second: number;
}

export function wallClockInTz(epochMs: number, tz: string): WallClock {
  const df = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const p of df.formatToParts(new Date(epochMs))) {
    if (p.type === "hour") hour = Number(p.value);
    else if (p.type === "minute") minute = Number(p.value);
    else if (p.type === "second") second = Number(p.value);
  }
  if (hour === 24) hour = 0;
  return { hour, minute, second };
}

export function systemClock(): Clock {
  const origin = performance.now();
  return {
    now: () => Date.now(),
    monotonicMs: () => performance.now() - origin,
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new AbortError());
          return;
        }
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(new AbortError());
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, Math.max(ms, 0));
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
  };
}

export class AbortError extends Error {
  constructor() {
    super("pinch: operation aborted");
    this.name = "AbortError";
  }
}
