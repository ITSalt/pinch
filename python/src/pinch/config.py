from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from .invariants import validate_invariants
from .types import (
    LimitsConfig,
    PacingConfig,
    RangeMs,
    ResolvedConfig,
    RunnerConfig,
    WorkingWindowConfig,
)


def _system_tz() -> str:
    tz = os.environ.get("TZ")
    if tz:
        return tz
    try:
        from datetime import datetime

        name = datetime.now().astimezone().tzname()
        if name and "/" in name:
            return name
    except Exception:
        pass
    return "UTC"


DEFAULT_CONFIG: ResolvedConfig = ResolvedConfig(
    working_window=WorkingWindowConfig(start="08:00", end="23:00", tz=_system_tz()),
    pacing=PacingConfig(
        spawn_delay_ms=RangeMs(min=15_000, max=30_000),
        wave_cooldown_ms=RangeMs(min=120_000, max=300_000),
        wave_every_n=5,
    ),
    limits=LimitsConfig(
        max_global_parallel_sessions=5,
        max_parallel_per_project=3,
        max_active_projects=3,
    ),
    runner=RunnerConfig(claude_binary="claude", task_timeout_ms=600_000, args=("--print",)),
)


def resolve_config(
    options: Mapping[str, Any] | None = None,
    env: Mapping[str, str] | None = None,
) -> ResolvedConfig:
    if env is None:
        env = os.environ
    env_overlay = _read_env_overlay(env)
    user = options or {}

    def deep_get(src: Mapping[str, Any] | None, *path: str) -> Any:
        cur: Any = src
        for p in path:
            if cur is None:
                return None
            if isinstance(cur, Mapping):
                cur = cur.get(p)
            else:
                return None
        return cur

    def pick(*values: Any) -> Any:
        for v in values:
            if v is not None:
                return v
        raise RuntimeError("pinch: no default for config field")

    window = WorkingWindowConfig(
        start=pick(
            deep_get(user, "working_window", "start"),
            deep_get(env_overlay, "working_window", "start"),
            DEFAULT_CONFIG.working_window.start,
        ),
        end=pick(
            deep_get(user, "working_window", "end"),
            deep_get(env_overlay, "working_window", "end"),
            DEFAULT_CONFIG.working_window.end,
        ),
        tz=pick(
            deep_get(user, "working_window", "tz"),
            deep_get(env_overlay, "working_window", "tz"),
            DEFAULT_CONFIG.working_window.tz,
        ),
    )
    pacing = PacingConfig(
        spawn_delay_ms=RangeMs(
            min=pick(
                deep_get(user, "pacing", "spawn_delay_ms", "min"),
                deep_get(env_overlay, "pacing", "spawn_delay_ms", "min"),
                DEFAULT_CONFIG.pacing.spawn_delay_ms.min,
            ),
            max=pick(
                deep_get(user, "pacing", "spawn_delay_ms", "max"),
                deep_get(env_overlay, "pacing", "spawn_delay_ms", "max"),
                DEFAULT_CONFIG.pacing.spawn_delay_ms.max,
            ),
        ),
        wave_cooldown_ms=RangeMs(
            min=pick(
                deep_get(user, "pacing", "wave_cooldown_ms", "min"),
                deep_get(env_overlay, "pacing", "wave_cooldown_ms", "min"),
                DEFAULT_CONFIG.pacing.wave_cooldown_ms.min,
            ),
            max=pick(
                deep_get(user, "pacing", "wave_cooldown_ms", "max"),
                deep_get(env_overlay, "pacing", "wave_cooldown_ms", "max"),
                DEFAULT_CONFIG.pacing.wave_cooldown_ms.max,
            ),
        ),
        wave_every_n=pick(
            deep_get(user, "pacing", "wave_every_n"),
            deep_get(env_overlay, "pacing", "wave_every_n"),
            DEFAULT_CONFIG.pacing.wave_every_n,
        ),
    )
    limits = LimitsConfig(
        max_global_parallel_sessions=pick(
            deep_get(user, "limits", "max_global_parallel_sessions"),
            deep_get(env_overlay, "limits", "max_global_parallel_sessions"),
            DEFAULT_CONFIG.limits.max_global_parallel_sessions,
        ),
        max_parallel_per_project=pick(
            deep_get(user, "limits", "max_parallel_per_project"),
            deep_get(env_overlay, "limits", "max_parallel_per_project"),
            DEFAULT_CONFIG.limits.max_parallel_per_project,
        ),
        max_active_projects=pick(
            deep_get(user, "limits", "max_active_projects"),
            deep_get(env_overlay, "limits", "max_active_projects"),
            DEFAULT_CONFIG.limits.max_active_projects,
        ),
    )
    runner_args = deep_get(user, "runner", "args")
    if runner_args is None:
        runner_args = deep_get(env_overlay, "runner", "args")
    if runner_args is None:
        runner_args = DEFAULT_CONFIG.runner.args
    runner = RunnerConfig(
        claude_binary=pick(
            deep_get(user, "runner", "claude_binary"),
            deep_get(env_overlay, "runner", "claude_binary"),
            DEFAULT_CONFIG.runner.claude_binary,
        ),
        task_timeout_ms=pick(
            deep_get(user, "runner", "task_timeout_ms"),
            deep_get(env_overlay, "runner", "task_timeout_ms"),
            DEFAULT_CONFIG.runner.task_timeout_ms,
        ),
        args=tuple(runner_args),
    )

    merged = ResolvedConfig(
        working_window=window, pacing=pacing, limits=limits, runner=runner
    )
    validate_invariants(merged)
    return replace(merged)


def _read_env_overlay(env: Mapping[str, str]) -> dict[str, Any]:
    overlay: dict[str, Any] = {}

    def num(key: str) -> int | None:
        raw = env.get(key)
        if not raw:
            return None
        try:
            return int(raw)
        except ValueError:
            return None

    def s(key: str) -> str | None:
        raw = env.get(key)
        return raw if raw else None

    window: dict[str, Any] = {}
    if (vs := s("PINCH_WINDOW_START")) is not None:
        window["start"] = vs
    if (vs := s("PINCH_WINDOW_END")) is not None:
        window["end"] = vs
    if (vs := s("PINCH_WINDOW_TZ")) is not None:
        window["tz"] = vs
    if window:
        overlay["working_window"] = window

    pacing: dict[str, Any] = {}
    spawn: dict[str, Any] = {}
    if (vn := num("PINCH_SPAWN_DELAY_MIN_MS")) is not None:
        spawn["min"] = vn
    if (vn := num("PINCH_SPAWN_DELAY_MAX_MS")) is not None:
        spawn["max"] = vn
    if spawn:
        pacing["spawn_delay_ms"] = spawn
    wave: dict[str, Any] = {}
    if (vn := num("PINCH_WAVE_COOLDOWN_MIN_MS")) is not None:
        wave["min"] = vn
    if (vn := num("PINCH_WAVE_COOLDOWN_MAX_MS")) is not None:
        wave["max"] = vn
    if wave:
        pacing["wave_cooldown_ms"] = wave
    if (vn := num("PINCH_WAVE_EVERY_N")) is not None:
        pacing["wave_every_n"] = vn
    if pacing:
        overlay["pacing"] = pacing

    limits: dict[str, Any] = {}
    if (vn := num("PINCH_MAX_GLOBAL_PARALLEL")) is not None:
        limits["max_global_parallel_sessions"] = vn
    if (vn := num("PINCH_MAX_PER_PROJECT")) is not None:
        limits["max_parallel_per_project"] = vn
    if (vn := num("PINCH_MAX_ACTIVE_PROJECTS")) is not None:
        limits["max_active_projects"] = vn
    if limits:
        overlay["limits"] = limits

    runner: dict[str, Any] = {}
    if (vs := s("PINCH_CLAUDE_BINARY")) is not None:
        runner["claude_binary"] = vs
    if (vn := num("PINCH_TASK_TIMEOUT_MS")) is not None:
        runner["task_timeout_ms"] = vn
    if runner:
        overlay["runner"] = runner

    return overlay
