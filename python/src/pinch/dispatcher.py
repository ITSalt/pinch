from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from dataclasses import dataclass

from .jitter import JitteredDelay
from .notifier import Notifier
from .queue import PendingTask, TaskQueue
from .runner import ClaudeRunner, RunnerInvocation
from .semaphore import AsyncSemaphore, ProjectSemaphore
from .types import (
    BlockReason,
    Clock,
    FinishedEvent,
    HookMap,
    PacerStats,
    ResolvedConfig,
    StartedEvent,
    TaskResult,
)
from .window import WorkingWindow

UPSTREAM_PAUSE_MS = 60 * 60 * 1000
STARTUP_JITTER_MAX_MS = 5 * 60 * 1000
IDLE_POLL_MS = 10 * 60 * 1000
SHORT_POLL_MS = 10_000
FAST_FAIL_THRESHOLD_MS = 2_000


@dataclass(slots=True)
class DispatcherDeps:
    config: ResolvedConfig
    queue: TaskQueue[TaskResult]
    global_sem: AsyncSemaphore
    project_sem: ProjectSemaphore
    window: WorkingWindow
    jitter: JitteredDelay
    runner: ClaudeRunner
    clock: Clock
    hooks: HookMap


@dataclass(slots=True)
class _Admission:
    item: PendingTask[TaskResult]
    global_release: Callable[[], None]
    project_release: Callable[[], None]


class Dispatcher:
    def __init__(self, deps: DispatcherDeps):
        self._deps = deps
        self._notifier = Notifier()
        self._running = False
        self._draining = False
        self._shutting_down = False
        self._active = 0
        self._spawns_since_last_wave = 0
        self._cooldown_ends_mono = 0.0
        self._upstream_pause_ends_mono = 0.0
        self._next_spawn_ready_mono = 0.0
        self._loop_task: asyncio.Task[None] | None = None
        self._active_tasks: set[asyncio.Task[None]] = set()

    def _spawn_task(self, pick: _Admission) -> None:
        task = asyncio.create_task(self._run_task(pick))
        self._active_tasks.add(task)
        task.add_done_callback(self._active_tasks.discard)

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._next_spawn_ready_mono = (
            self._deps.clock.monotonic_ms() + self._deps.jitter.spawn_delay_ms()
        )
        self._loop_task = asyncio.create_task(self._loop())

    def enqueue(self, item: PendingTask[TaskResult]) -> None:
        if self._shutting_down:
            if not item.future.done():
                item.future.set_exception(RuntimeError("pinch: pacer is shutting down"))
            return
        self._deps.queue.enqueue(item)
        hook = self._deps.hooks.on_enqueued
        if hook is not None:
            hook(
                {
                    "task_id": item.id,
                    "project_id": item.project_id,
                    "queue_depth": self._deps.queue.length,
                }
            )
        self._notifier.notify()

    def stats(self) -> PacerStats:
        return PacerStats(
            queue_depth=self._deps.queue.length,
            global_active=self._deps.global_sem.in_use,
            active_projects=tuple(self._deps.project_sem.active_project_ids()),
            spawns_since_last_wave=self._spawns_since_last_wave,
            in_wave_cooldown=self._deps.clock.monotonic_ms() < self._cooldown_ends_mono,
            window_open=self._deps.window.is_open_now(),
        )

    async def drain(self) -> None:
        self._draining = True
        self._notifier.notify()
        while self._deps.queue.length > 0 or self._active > 0:
            await self._notifier.wait()

    async def shutdown(self) -> None:
        self._shutting_down = True
        self._draining = True
        self._notifier.notify()
        await self.drain()
        self._running = False
        self._notifier.notify()
        if self._loop_task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task

    async def _loop(self) -> None:
        try:
            while self._running:
                if (
                    self._shutting_down
                    and self._deps.queue.length == 0
                    and self._active == 0
                ):
                    self._running = False
                    break

                if self._deps.queue.length == 0:
                    await self._wait_for_signal(IDLE_POLL_MS)
                    continue

                if not self._deps.window.is_open_now():
                    wait_ms = (
                        self._deps.window.ms_until_next_open()
                        + self._deps.jitter.startup_jitter_ms(STARTUP_JITTER_MAX_MS)
                    )
                    self._emit_blocked("window-closed", wait_ms)
                    await self._wait_for_signal(wait_ms)
                    continue

                now_mono = self._deps.clock.monotonic_ms()

                if now_mono < self._upstream_pause_ends_mono:
                    wait_ms = int(self._upstream_pause_ends_mono - now_mono)
                    self._emit_blocked("upstream", wait_ms)
                    await self._wait_for_signal(wait_ms)
                    continue

                if now_mono < self._cooldown_ends_mono:
                    wait_ms = int(self._cooldown_ends_mono - now_mono)
                    self._emit_blocked("wave-cooldown", wait_ms)
                    await self._wait_for_signal(wait_ms)
                    continue

                if now_mono < self._next_spawn_ready_mono:
                    wait_ms = int(self._next_spawn_ready_mono - now_mono)
                    await self._wait_for_signal(wait_ms)
                    continue

                pick = self._find_admissible()
                if pick is None:
                    self._emit_blocked(self._diagnose_block())
                    await self._wait_for_signal(SHORT_POLL_MS)
                    continue

                self._deps.queue.remove_by_id(pick.item.id)
                self._active += 1
                spawn_mono = self._deps.clock.monotonic_ms()
                self._next_spawn_ready_mono = spawn_mono + self._deps.jitter.spawn_delay_ms()
                self._spawns_since_last_wave += 1
                if self._spawns_since_last_wave >= self._deps.config.pacing.wave_every_n:
                    self._cooldown_ends_mono = (
                        self._deps.clock.monotonic_ms()
                        + self._deps.jitter.wave_cooldown_ms()
                    )
                    self._spawns_since_last_wave = 0
                self._spawn_task(pick)
        finally:
            self._running = False
            self._notifier.notify()

    async def _run_task(self, pick: _Admission) -> None:
        item = pick.item
        started_at = self._deps.clock.now()
        start_mono = self._deps.clock.monotonic_ms()
        waited_ms = max(int(start_mono - item.enqueued_at_mono_ms), 0)

        started_event: StartedEvent = {
            "task_id": item.id,
            "project_id": item.project_id,
            "waited_ms": waited_ms,
            "global_active": self._deps.global_sem.in_use,
            "project_active": self._deps.project_sem.in_use_for(item.project_id),
        }
        on_started = self._deps.hooks.on_started
        if on_started is not None:
            on_started(started_event)

        try:
            timeout_ms = item.task.timeout_ms or self._deps.config.runner.task_timeout_ms
            extra = tuple(item.task.args) if item.task.args else ()
            inv = RunnerInvocation(
                prompt=item.task.prompt,
                cwd=item.task.cwd,
                extra_args=extra,
                timeout_ms=float(timeout_ms),
            )
            out = await self._deps.runner.execute(inv)
            finished_at = self._deps.clock.now()
            duration_ms = max(int(self._deps.clock.monotonic_ms() - start_mono), 0)
            result = TaskResult(
                task_id=item.id,
                project_id=item.project_id,
                exit_code=out.exit_code,
                stdout=out.stdout,
                stderr=out.stderr,
                duration_ms=duration_ms,
                waited_ms=waited_ms,
                started_at=started_at,
                finished_at=finished_at,
            )
            if not item.future.done():
                item.future.set_result(result)
            finished_event: FinishedEvent = {
                "task_id": item.id,
                "project_id": item.project_id,
                "waited_ms": waited_ms,
                "global_active": started_event["global_active"],
                "project_active": started_event["project_active"],
                "exit_code": out.exit_code,
                "duration_ms": duration_ms,
            }
            on_finished = self._deps.hooks.on_finished
            if on_finished is not None:
                on_finished(finished_event)

            if out.exit_code != 0 and duration_ms < FAST_FAIL_THRESHOLD_MS:
                self._next_spawn_ready_mono = self._deps.clock.monotonic_ms()

            if out.upstream:
                self._upstream_pause_ends_mono = (
                    self._deps.clock.monotonic_ms() + UPSTREAM_PAUSE_MS
                )
        except Exception as err:
            if not item.future.done():
                item.future.set_exception(err)
        finally:
            pick.project_release()
            pick.global_release()
            self._active -= 1
            self._notifier.notify()

    def _find_admissible(self) -> _Admission | None:
        if self._deps.global_sem.available <= 0:
            return None
        for item in self._deps.queue.snapshot():
            global_release = self._deps.global_sem.try_acquire()
            if global_release is None:
                return None
            project_release = self._deps.project_sem.try_acquire(item.project_id)
            if project_release is not None:
                return _Admission(
                    item=item, global_release=global_release, project_release=project_release
                )
            global_release()
        return None

    def _diagnose_block(self) -> BlockReason:
        if self._deps.global_sem.available <= 0:
            return "global-limit"
        active = self._deps.project_sem.active_project_ids()
        if len(active) >= self._deps.config.limits.max_active_projects:
            return "active-projects"
        return "project-limit"

    def _emit_blocked(self, reason: BlockReason, ms_until_retry: int | None = None) -> None:
        hook = self._deps.hooks.on_blocked
        if hook is None:
            return
        payload = {"reason": reason}
        if ms_until_retry is not None:
            payload["ms_until_retry"] = ms_until_retry  # type: ignore[assignment]
        hook(payload)  # type: ignore[arg-type]

    async def _wait_for_signal(self, max_ms: float) -> None:
        if max_ms <= 0:
            return
        notifier_wait = self._notifier.wait()
        sleep_task = asyncio.create_task(self._deps.clock.sleep(max_ms))
        done, pending = await asyncio.wait(
            {notifier_wait, sleep_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for p in pending:
            p.cancel()
        for d in done:
            if d.cancelled():
                continue
            with contextlib.suppress(asyncio.CancelledError):
                d.exception()
