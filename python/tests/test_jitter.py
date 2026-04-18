from __future__ import annotations

import pytest

from pinch.jitter import JitteredDelay, constant_rng, seeded_rng
from pinch.types import RangeMs

SPAWN = RangeMs(min=15_000, max=30_000)
WAVE = RangeMs(min=120_000, max=300_000)


def test_spawn_in_range():
    d = JitteredDelay(SPAWN, WAVE, seeded_rng(42))
    for _ in range(500):
        v = d.spawn_delay_ms()
        assert SPAWN.min <= v <= SPAWN.max


def test_wave_in_range():
    d = JitteredDelay(SPAWN, WAVE, seeded_rng(42))
    for _ in range(500):
        v = d.wave_cooldown_ms()
        assert WAVE.min <= v <= WAVE.max


def test_rng_zero_returns_min():
    d = JitteredDelay(SPAWN, WAVE, constant_rng(0.0))
    assert d.spawn_delay_ms() == SPAWN.min
    assert d.wave_cooldown_ms() == WAVE.min


def test_rng_high_returns_max():
    d = JitteredDelay(SPAWN, WAVE, constant_rng(0.9999999))
    assert d.spawn_delay_ms() == SPAWN.max
    assert d.wave_cooldown_ms() == WAVE.max


def test_degenerate_range():
    d = JitteredDelay(RangeMs(min=15_000, max=15_000), WAVE, seeded_rng(1))
    assert d.spawn_delay_ms() == 15_000


def test_startup_jitter_zero_max():
    d = JitteredDelay(SPAWN, WAVE, seeded_rng(1))
    assert d.startup_jitter_ms(0) == 0
    assert d.startup_jitter_ms(-100) == 0


def test_startup_jitter_in_range():
    d = JitteredDelay(SPAWN, WAVE, seeded_rng(1))
    for _ in range(500):
        v = d.startup_jitter_ms(5 * 60 * 1000)
        assert 0 <= v < 5 * 60 * 1000


def test_seeded_rng_deterministic():
    a = seeded_rng(42)
    b = seeded_rng(42)
    for _ in range(10):
        assert a() == b()


def test_seeded_rng_in_unit_interval():
    rng = seeded_rng(7)
    for _ in range(10_000):
        v = rng()
        assert 0.0 <= v < 1.0


def test_constant_rng_rejects_out_of_range():
    with pytest.raises(ValueError):
        constant_rng(1.0)
    with pytest.raises(ValueError):
        constant_rng(-0.1)
