from __future__ import annotations

import pytest

from pinch.config import DEFAULT_CONFIG, resolve_config
from pinch.invariants import InvariantViolation


def test_defaults():
    cfg = resolve_config(None, env={})
    assert cfg.working_window.start == "08:00"
    assert cfg.working_window.end == "23:00"
    assert cfg.pacing.spawn_delay_ms.min == 15_000
    assert cfg.pacing.spawn_delay_ms.max == 30_000
    assert cfg.pacing.wave_cooldown_ms.min == 120_000
    assert cfg.pacing.wave_cooldown_ms.max == 300_000
    assert cfg.pacing.wave_every_n == 5
    assert cfg.limits.max_global_parallel_sessions == 5
    assert cfg.limits.max_parallel_per_project == 3
    assert cfg.limits.max_active_projects == 3
    assert cfg.runner.claude_binary == "claude"
    assert cfg.runner.task_timeout_ms == 600_000
    assert cfg.runner.args == ("--print",)


def test_default_config_frozen():
    with pytest.raises((AttributeError, TypeError)):
        DEFAULT_CONFIG.runner.claude_binary = "nope"  # type: ignore[misc]


def test_options_override_defaults():
    cfg = resolve_config(
        {"working_window": {"start": "09:00"}, "pacing": {"wave_every_n": 4}},
        env={},
    )
    assert cfg.working_window.start == "09:00"
    assert cfg.working_window.end == "23:00"
    assert cfg.pacing.wave_every_n == 4


def test_env_overrides_defaults():
    cfg = resolve_config(
        None,
        env={
            "PINCH_WINDOW_START": "10:00",
            "PINCH_SPAWN_DELAY_MIN_MS": "20000",
            "PINCH_SPAWN_DELAY_MAX_MS": "40000",
        },
    )
    assert cfg.working_window.start == "10:00"
    assert cfg.pacing.spawn_delay_ms.min == 20_000
    assert cfg.pacing.spawn_delay_ms.max == 40_000


def test_options_override_env():
    cfg = resolve_config(
        {"working_window": {"start": "11:00"}},
        env={"PINCH_WINDOW_START": "10:00"},
    )
    assert cfg.working_window.start == "11:00"


def test_env_violation_still_throws():
    with pytest.raises(InvariantViolation):
        resolve_config(None, env={"PINCH_MAX_GLOBAL_PARALLEL": "99"})


def test_empty_env_values_ignored():
    cfg = resolve_config(None, env={"PINCH_WINDOW_START": ""})
    assert cfg.working_window.start == "08:00"


def test_non_numeric_env_ignored():
    cfg = resolve_config(None, env={"PINCH_SPAWN_DELAY_MIN_MS": "not-a-number"})
    assert cfg.pacing.spawn_delay_ms.min == 15_000
