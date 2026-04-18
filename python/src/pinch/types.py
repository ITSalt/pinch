from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, TypedDict


@dataclass(frozen=True, slots=True)
class RangeMs:
    min: int
    max: int


@dataclass(frozen=True, slots=True)
class WorkingWindowConfig:
    start: str
    end: str
    tz: str


@dataclass(frozen=True, slots=True)
class PacingConfig:
    spawn_delay_ms: RangeMs
    wave_cooldown_ms: RangeMs
    wave_every_n: int


@dataclass(frozen=True, slots=True)
class LimitsConfig:
    max_global_parallel_sessions: int
    max_parallel_per_project: int
    max_active_projects: int


@dataclass(frozen=True, slots=True)
class RunnerConfig:
    claude_binary: str
    task_timeout_ms: int
    args: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ResolvedConfig:
    working_window: WorkingWindowConfig
    pacing: PacingConfig
    limits: LimitsConfig
    runner: RunnerConfig


@dataclass(frozen=True, slots=True)
class Task:
    prompt: str
    project_id: str | None = None
    cwd: str | None = None
    args: tuple[str, ...] | None = None
    timeout_ms: int | None = None
    metadata: Mapping[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class TaskResult:
    task_id: str
    project_id: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    waited_ms: int
    started_at: float
    finished_at: float


BlockReason = Literal[
    "window-closed",
    "global-limit",
    "project-limit",
    "active-projects",
    "wave-cooldown",
    "upstream",
    "overrun",
]


class EnqueuedEvent(TypedDict):
    task_id: str
    project_id: str
    queue_depth: int


class StartedEvent(TypedDict):
    task_id: str
    project_id: str
    waited_ms: int
    global_active: int
    project_active: int


class FinishedEvent(TypedDict):
    task_id: str
    project_id: str
    waited_ms: int
    global_active: int
    project_active: int
    exit_code: int
    duration_ms: int


class BlockedEvent(TypedDict, total=False):
    reason: BlockReason
    ms_until_retry: int
    detail: str


@dataclass(frozen=True, slots=True)
class HookMap:
    on_enqueued: Callable[[EnqueuedEvent], None] | None = None
    on_started: Callable[[StartedEvent], None] | None = None
    on_finished: Callable[[FinishedEvent], None] | None = None
    on_blocked: Callable[[BlockedEvent], None] | None = None


class Clock(Protocol):
    def now(self) -> float:  # wall-clock epoch seconds (float)
        ...

    def monotonic_ms(self) -> float:  # monotonic milliseconds (float)
        ...

    async def sleep(self, ms: float) -> None:
        ...


JitterSource = Callable[[], float]


class ExecResult(TypedDict):
    stdout: str
    stderr: str
    exit_code: int


class ExecOptions(TypedDict, total=False):
    cwd: str
    timeout_ms: float


ExecFn = Callable[[str, Sequence[str], ExecOptions], Awaitable[ExecResult]]


@dataclass(frozen=True, slots=True)
class PacerStats:
    queue_depth: int
    global_active: int
    active_projects: tuple[str, ...]
    spawns_since_last_wave: int
    in_wave_cooldown: bool
    window_open: bool


@dataclass(slots=True)
class PacerOptions:
    working_window: Mapping[str, str] | None = None
    pacing: Mapping[str, Any] | None = None
    limits: Mapping[str, int] | None = None
    runner: Mapping[str, Any] | None = None
    hooks: HookMap | None = None
    clock: Clock | None = None
    jitter: JitterSource | None = None
    runner_exec: ExecFn | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
