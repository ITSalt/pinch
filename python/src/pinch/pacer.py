from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .config import resolve_config
from .dispatcher import Dispatcher, DispatcherDeps
from .jitter import JitteredDelay
from .queue import PendingTask, TaskQueue
from .runner import ClaudeRunner, default_exec
from .semaphore import AsyncSemaphore, ProjectSemaphore
from .types import (
    Clock,
    ExecFn,
    HookMap,
    JitterSource,
    PacerOptions,
    PacerStats,
    Task,
    TaskResult,
)
from .window import WorkingWindow, system_clock

_PROJECT_ID_RE = re.compile(r"^[a-z0-9_-]{1,64}$")


class Pacer:
    def __init__(self, options: PacerOptions | Mapping[str, Any] | None = None):
        opts = _normalize_options(options)
        config_opts: dict[str, Any] = {}
        for key in ("working_window", "pacing", "limits", "runner"):
            value = getattr(opts, key, None)
            if value is not None:
                config_opts[key] = value
        self.config = resolve_config(config_opts)
        self._clock: Clock = opts.clock or system_clock()
        self._hooks: HookMap = opts.hooks or HookMap()
        jitter_source: JitterSource = opts.jitter or __import__("random").random
        jitter = JitteredDelay(
            self.config.pacing.spawn_delay_ms,
            self.config.pacing.wave_cooldown_ms,
            jitter_source,
        )
        global_sem = AsyncSemaphore(self.config.limits.max_global_parallel_sessions)
        project_sem = ProjectSemaphore(
            self.config.limits.max_parallel_per_project,
            self.config.limits.max_active_projects,
            self._clock,
        )
        window = WorkingWindow(self.config.working_window, self._clock)
        exec_fn: ExecFn = opts.runner_exec or default_exec
        runner = ClaudeRunner(
            self.config.runner.claude_binary,
            self.config.runner.args,
            exec_fn,
            self._clock.monotonic_ms,
        )
        self._queue: TaskQueue[TaskResult] = TaskQueue()
        self._dispatcher = Dispatcher(
            DispatcherDeps(
                config=self.config,
                queue=self._queue,
                global_sem=global_sem,
                project_sem=project_sem,
                window=window,
                jitter=jitter,
                runner=runner,
                clock=self._clock,
                hooks=self._hooks,
            )
        )
        self._id_counter = 0
        self._closed = False
        self._started = False

    def _ensure_started(self) -> None:
        if not self._started:
            self._dispatcher.start()
            self._started = True

    async def run(self, task: Task | Mapping[str, Any] | None = None, **kwargs: Any) -> TaskResult:
        if self._closed:
            raise RuntimeError("pinch: pacer is shut down")
        resolved_task = _to_task(task, kwargs)
        if not isinstance(resolved_task.prompt, str) or not resolved_task.prompt:
            raise ValueError("pinch: task.prompt must be a non-empty string")
        self._ensure_started()
        project_id = resolve_project_id(resolved_task)
        id = self._next_id()
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[TaskResult] = loop.create_future()
        item = PendingTask(
            id=id,
            project_id=project_id,
            task=resolved_task,
            enqueued_at_mono_ms=self._clock.monotonic_ms(),
            future=fut,
        )
        self._dispatcher.enqueue(item)
        return await fut

    async def run_batch(self, tasks: Sequence[Task | Mapping[str, Any]]) -> list[TaskResult]:
        return await asyncio.gather(*(self.run(t) for t in tasks))

    async def drain(self) -> None:
        self._ensure_started()
        await self._dispatcher.drain()

    async def shutdown(self) -> None:
        self._closed = True
        if self._started:
            await self._dispatcher.shutdown()

    def stats(self) -> PacerStats:
        return self._dispatcher.stats()

    def _next_id(self) -> str:
        self._id_counter += 1
        return f"t{self._id_counter:x}-{os.urandom(3).hex()}"


def resolve_project_id(task: Task) -> str:
    if task.project_id is not None:
        if not _PROJECT_ID_RE.match(task.project_id):
            raise ValueError(
                f'pinch: project_id must match {_PROJECT_ID_RE.pattern}; got "{task.project_id}"'
            )
        return task.project_id
    cwd_str = task.cwd or os.getcwd()
    cwd = Path(cwd_str).resolve() if not os.path.isabs(cwd_str) else Path(cwd_str)
    git_root = _find_git_root(cwd)
    base = git_root if git_root is not None else cwd.resolve()
    return _derive_project_id_from_path(base)


def _find_git_root(start: Path) -> Path | None:
    current = start
    for _ in range(64):
        if (current / ".git").exists():
            return current
        if current.parent == current:
            return None
        current = current.parent
    return None


def _derive_project_id_from_path(p: Path) -> str:
    last = p.name if p.name else "root"
    cleaned = re.sub(r"[^a-z0-9_-]+", "-", last.lower())
    cleaned = cleaned.strip("-")[:64]
    return cleaned if cleaned else "root"


def _normalize_options(options: PacerOptions | Mapping[str, Any] | None) -> PacerOptions:
    if options is None:
        return PacerOptions()
    if isinstance(options, PacerOptions):
        return options
    return PacerOptions(**dict(options))


def _to_task(task: Task | Mapping[str, Any] | None, kwargs: Mapping[str, Any]) -> Task:
    if isinstance(task, Task):
        return task
    data: dict[str, Any] = {}
    if isinstance(task, Mapping):
        data.update(task)
    data.update(kwargs)
    allowed = {"prompt", "project_id", "cwd", "args", "timeout_ms", "metadata"}
    filtered = {k: v for k, v in data.items() if k in allowed}
    if "args" in filtered and filtered["args"] is not None:
        filtered["args"] = tuple(filtered["args"])
    return Task(**filtered)
