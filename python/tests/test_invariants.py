from __future__ import annotations

import pytest

from pinch.config import resolve_config
from pinch.invariants import (
    HARD_INVARIANTS,
    InvariantViolation,
    compute_window_duration_minutes,
    parse_hhmm_to_minutes,
    validate_invariants,
)


def test_hard_invariants_values():
    assert HARD_INVARIANTS.max_global_parallel_sessions == 5
    assert HARD_INVARIANTS.max_parallel_per_project == 3
    assert HARD_INVARIANTS.max_active_projects == 3
    assert HARD_INVARIANTS.min_downtime_hours_per_day == 8
    assert HARD_INVARIANTS.max_working_hours_per_day == 16
    assert HARD_INVARIANTS.min_spawn_delay_ms == 15_000
    assert HARD_INVARIANTS.min_wave_cooldown_ms == 120_000


def test_hard_invariants_is_frozen():
    with pytest.raises((AttributeError, TypeError)):
        HARD_INVARIANTS.max_global_parallel_sessions = 99  # type: ignore[misc]


def test_defaults_pass():
    validate_invariants(resolve_config(None, env={}))


@pytest.mark.parametrize(
    "overrides",
    [
        {"limits": {"max_global_parallel_sessions": 6}},
        {"limits": {"max_global_parallel_sessions": 0}},
        {"limits": {"max_parallel_per_project": 4}},
        {"limits": {"max_active_projects": 4}},
        {"limits": {"max_global_parallel_sessions": 2, "max_parallel_per_project": 3}},
        {"pacing": {"spawn_delay_ms": {"min": 14_999, "max": 20_000}}},
        {"pacing": {"spawn_delay_ms": {"min": 20_000, "max": 15_000}}},
        {"pacing": {"wave_cooldown_ms": {"min": 119_999, "max": 200_000}}},
        {"pacing": {"wave_every_n": 0}},
        {"working_window": {"start": "07:00", "end": "24:00"}},
        {"working_window": {"start": "00:00", "end": "23:59"}},
        {"working_window": {"start": "22:00", "end": "06:00"}},
        {"working_window": {"start": "08:00", "end": "08:00"}},
        {"working_window": {"start": "25:00", "end": "26:00"}},
    ],
)
def test_violations(overrides: dict):
    with pytest.raises(InvariantViolation):
        resolve_config(overrides, env={})


def test_per_project_eq_global_passes():
    resolve_config(
        {"limits": {"max_global_parallel_sessions": 3, "max_parallel_per_project": 3}},
        env={},
    )


def test_spawn_delay_min_boundary_passes():
    resolve_config({"pacing": {"spawn_delay_ms": {"min": 15_000, "max": 20_000}}}, env={})


def test_window_at_16h_boundary_passes():
    resolve_config({"working_window": {"start": "08:00", "end": "24:00"}}, env={})


def test_compute_window_duration_minutes():
    assert compute_window_duration_minutes("08:00", "23:00") == 15 * 60
    assert compute_window_duration_minutes("09:30", "10:15") == 45
    assert compute_window_duration_minutes("00:00", "16:00") == 16 * 60


def test_parse_hhmm_to_minutes():
    assert parse_hhmm_to_minutes("00:00", "x") == 0
    assert parse_hhmm_to_minutes("23:59", "x") == 23 * 60 + 59
    assert parse_hhmm_to_minutes("24:00", "x") == 24 * 60
    assert parse_hhmm_to_minutes("8:00", "x") == 8 * 60


def test_invariant_violation_carries_fields():
    try:
        resolve_config({"limits": {"max_global_parallel_sessions": 99}}, env={})
        pytest.fail("should have thrown")
    except InvariantViolation as v:
        assert v.invariant == "max_global_parallel_sessions"
        assert v.configured == 99
        assert v.bound == "<=5"
