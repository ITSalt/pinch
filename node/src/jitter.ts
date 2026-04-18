import type { JitterSource, RangeMs } from "./types.js";

export class JitteredDelay {
  constructor(
    private readonly spawnRange: RangeMs,
    private readonly waveRange: RangeMs,
    private readonly rng: JitterSource = Math.random,
  ) {}

  spawnDelayMs(): number {
    return this.pickInRange(this.spawnRange);
  }

  waveCooldownMs(): number {
    return this.pickInRange(this.waveRange);
  }

  startupJitterMs(maxMs: number): number {
    if (maxMs <= 0) return 0;
    return Math.floor(this.rng() * maxMs);
  }

  private pickInRange(range: RangeMs): number {
    if (range.max === range.min) return range.min;
    const span = range.max - range.min;
    return range.min + Math.floor(this.rng() * (span + 1));
  }
}

export function seededRng(seed: number): JitterSource {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

export function constantRng(value: number): JitterSource {
  if (value < 0 || value >= 1) {
    throw new RangeError(`constantRng expects [0, 1); got ${value}`);
  }
  return () => value;
}
