from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Final

from .types import ResolvedConfig


@dataclass(frozen=True, slots=True)
class HardInvariants:
    max_global_parallel_sessions: int
    max_parallel_per_project: int
    max_active_projects: int
    min_downtime_hours_per_day: int
    max_working_hours_per_day: int
    min_spawn_delay_ms: int
    min_wave_cooldown_ms: int


HARD_INVARIANTS: Final[HardInvariants] = HardInvariants(
    max_global_parallel_sessions=5,
    max_parallel_per_project=3,
    max_active_projects=3,
    min_downtime_hours_per_day=8,
    max_working_hours_per_day=16,
    min_spawn_delay_ms=15_000,
    min_wave_cooldown_ms=120_000,
)


class InvariantViolation(Exception):
    def __init__(self, invariant: str, configured: Any, bound: Any, message: str | None = None):
        self.invariant = invariant
        self.configured = configured
        self.bound = bound
        super().__init__(
            message
            or f"pinch invariant '{invariant}' violated: configured={configured!r}, bound={bound!r}"
        )


def validate_invariants(config: ResolvedConfig) -> None:
    _validate_limits(config)
    _validate_pacing(config)
    _validate_window(config)


def _validate_limits(config: ResolvedConfig) -> None:
    limits = config.limits
    _assert_range(
        "max_global_parallel_sessions",
        limits.max_global_parallel_sessions,
        1,
        HARD_INVARIANTS.max_global_parallel_sessions,
    )
    _assert_range(
        "max_parallel_per_project",
        limits.max_parallel_per_project,
        1,
        HARD_INVARIANTS.max_parallel_per_project,
    )
    _assert_range(
        "max_active_projects",
        limits.max_active_projects,
        1,
        HARD_INVARIANTS.max_active_projects,
    )
    if limits.max_parallel_per_project > limits.max_global_parallel_sessions:
        raise InvariantViolation(
            "max_parallel_per_project",
            limits.max_parallel_per_project,
            f"<=max_global_parallel_sessions({limits.max_global_parallel_sessions})",
        )


def _validate_pacing(config: ResolvedConfig) -> None:
    pacing = config.pacing
    if pacing.spawn_delay_ms.min < HARD_INVARIANTS.min_spawn_delay_ms:
        raise InvariantViolation(
            "pacing.spawn_delay_ms.min",
            pacing.spawn_delay_ms.min,
            f">={HARD_INVARIANTS.min_spawn_delay_ms}",
        )
    if pacing.spawn_delay_ms.max < pacing.spawn_delay_ms.min:
        raise InvariantViolation(
            "pacing.spawn_delay_ms.max",
            pacing.spawn_delay_ms.max,
            f">=min({pacing.spawn_delay_ms.min})",
        )
    if pacing.wave_cooldown_ms.min < HARD_INVARIANTS.min_wave_cooldown_ms:
        raise InvariantViolation(
            "pacing.wave_cooldown_ms.min",
            pacing.wave_cooldown_ms.min,
            f">={HARD_INVARIANTS.min_wave_cooldown_ms}",
        )
    if pacing.wave_cooldown_ms.max < pacing.wave_cooldown_ms.min:
        raise InvariantViolation(
            "pacing.wave_cooldown_ms.max",
            pacing.wave_cooldown_ms.max,
            f">=min({pacing.wave_cooldown_ms.min})",
        )
    if not isinstance(pacing.wave_every_n, int) or pacing.wave_every_n < 1:
        raise InvariantViolation("pacing.wave_every_n", pacing.wave_every_n, ">=1 integer")


def _validate_window(config: ResolvedConfig) -> None:
    window = config.working_window
    duration_minutes = compute_window_duration_minutes(window.start, window.end)
    duration_hours = duration_minutes / 60
    if duration_hours > HARD_INVARIANTS.max_working_hours_per_day:
        raise InvariantViolation(
            "working_window.duration",
            f"{duration_hours:.2f}h",
            f"<={HARD_INVARIANTS.max_working_hours_per_day}h",
        )
    downtime_hours = 24 - duration_hours
    if downtime_hours < HARD_INVARIANTS.min_downtime_hours_per_day:
        raise InvariantViolation(
            "working_window.downtime",
            f"{downtime_hours:.2f}h",
            f">={HARD_INVARIANTS.min_downtime_hours_per_day}h",
        )


def compute_window_duration_minutes(start: str, end: str) -> int:
    start_min = parse_hhmm_to_minutes(start, "working_window.start")
    end_min = parse_hhmm_to_minutes(end, "working_window.end")
    if end_min <= start_min:
        raise InvariantViolation(
            "working_window",
            f"{start}-{end}",
            "end must be strictly after start (no wrap-around in v1)",
        )
    return end_min - start_min


_HHMM_RE = re.compile(r"^(\d{1,2}):(\d{2})$")


def parse_hhmm_to_minutes(value: str, field_name: str) -> int:
    if not isinstance(value, str):
        raise InvariantViolation(field_name, value, 'string "HH:MM"')
    m = _HHMM_RE.match(value)
    if not m:
        raise InvariantViolation(field_name, value, '"HH:MM" format')
    hour, minute = int(m.group(1)), int(m.group(2))
    if hour < 0 or hour > 24 or minute < 0 or minute > 59:
        raise InvariantViolation(field_name, value, "00:00..24:00")
    if hour == 24 and minute != 0:
        raise InvariantViolation(field_name, value, "24:00 is the only valid 24-prefixed value")
    return hour * 60 + minute


def _assert_range(field_name: str, value: Any, min_v: int, max_v: int) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise InvariantViolation(field_name, value, "integer")
    if value < min_v:
        raise InvariantViolation(field_name, value, f">={min_v}")
    if value > max_v:
        raise InvariantViolation(field_name, value, f"<={max_v}")
