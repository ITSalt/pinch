"""pinch — Architecturally-capped pacing for parallel claude -p calls."""

from .config import DEFAULT_CONFIG, resolve_config
from .invariants import HARD_INVARIANTS, HardInvariants, InvariantViolation
from .jitter import JitteredDelay, constant_rng, seeded_rng
from .pacer import Pacer, resolve_project_id
from .runner import detect_upstream_failure
from .types import (
    BlockedEvent,
    BlockReason,
    Clock,
    EnqueuedEvent,
    ExecFn,
    ExecOptions,
    ExecResult,
    FinishedEvent,
    HookMap,
    JitterSource,
    LimitsConfig,
    PacerOptions,
    PacerStats,
    PacingConfig,
    RangeMs,
    ResolvedConfig,
    RunnerConfig,
    StartedEvent,
    Task,
    TaskResult,
    WorkingWindowConfig,
)
from .window import WorkingWindow, system_clock, wall_clock_in_tz

__all__ = [
    "DEFAULT_CONFIG",
    "HARD_INVARIANTS",
    "BlockReason",
    "BlockedEvent",
    "Clock",
    "EnqueuedEvent",
    "ExecFn",
    "ExecOptions",
    "ExecResult",
    "FinishedEvent",
    "HardInvariants",
    "HookMap",
    "InvariantViolation",
    "JitterSource",
    "JitteredDelay",
    "LimitsConfig",
    "Pacer",
    "PacerOptions",
    "PacerStats",
    "PacingConfig",
    "RangeMs",
    "ResolvedConfig",
    "RunnerConfig",
    "StartedEvent",
    "Task",
    "TaskResult",
    "WorkingWindow",
    "WorkingWindowConfig",
    "constant_rng",
    "detect_upstream_failure",
    "resolve_config",
    "resolve_project_id",
    "seeded_rng",
    "system_clock",
    "wall_clock_in_tz",
]

__version__ = "0.0.0"
