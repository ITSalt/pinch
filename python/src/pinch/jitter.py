from __future__ import annotations

import random

from .types import JitterSource, RangeMs


class JitteredDelay:
    def __init__(
        self,
        spawn_range: RangeMs,
        wave_range: RangeMs,
        rng: JitterSource | None = None,
    ):
        self._spawn = spawn_range
        self._wave = wave_range
        self._rng: JitterSource = rng or random.random

    def spawn_delay_ms(self) -> int:
        return self._pick(self._spawn)

    def wave_cooldown_ms(self) -> int:
        return self._pick(self._wave)

    def startup_jitter_ms(self, max_ms: int) -> int:
        if max_ms <= 0:
            return 0
        return int(self._rng() * max_ms)

    def _pick(self, r: RangeMs) -> int:
        if r.max == r.min:
            return r.min
        span = r.max - r.min
        return r.min + int(self._rng() * (span + 1))


def seeded_rng(seed: int) -> JitterSource:
    state = [seed & 0xFFFFFFFF or 0x9E3779B9]

    def rng() -> float:
        s = state[0]
        s ^= (s << 13) & 0xFFFFFFFF
        s ^= s >> 17
        s ^= (s << 5) & 0xFFFFFFFF
        s &= 0xFFFFFFFF
        state[0] = s
        return s / 0x100000000

    return rng


def constant_rng(value: float) -> JitterSource:
    if value < 0 or value >= 1:
        raise ValueError(f"constant_rng expects [0, 1); got {value}")
    return lambda: value
