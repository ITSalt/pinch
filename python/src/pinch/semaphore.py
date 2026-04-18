from __future__ import annotations

import asyncio
from collections.abc import Callable

from .types import Clock


class AsyncSemaphore:
    def __init__(self, capacity: int):
        if not isinstance(capacity, int) or capacity < 1:
            raise ValueError(f"Semaphore capacity must be integer >= 1; got {capacity}")
        self._capacity = capacity
        self._permits = capacity
        self._active = 0
        self._waiters: list[asyncio.Future[None]] = []

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def available(self) -> int:
        return self._permits

    @property
    def in_use(self) -> int:
        return self._active

    @property
    def pending(self) -> int:
        return len(self._waiters)

    async def acquire(self) -> Callable[[], None]:
        if self._permits > 0:
            return self._grant()
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[None] = loop.create_future()
        self._waiters.append(fut)
        await fut
        return self._grant()

    def try_acquire(self) -> Callable[[], None] | None:
        if self._permits <= 0:
            return None
        return self._grant()

    def _grant(self) -> Callable[[], None]:
        self._permits -= 1
        self._active += 1
        released = [False]

        def release() -> None:
            if released[0]:
                return
            released[0] = True
            self._active -= 1
            self._permits += 1
            self._drain_one()

        return release

    def _drain_one(self) -> None:
        while self._waiters:
            fut = self._waiters.pop(0)
            if not fut.done():
                fut.set_result(None)
                return


class ProjectSemaphore:
    def __init__(
        self,
        per_project_capacity: int,
        max_active_projects: int,
        clock: Clock,
        activity_window_ms: float = 10 * 60 * 1000,
    ):
        if not isinstance(per_project_capacity, int) or per_project_capacity < 1:
            raise ValueError(f"per_project_capacity must be integer >= 1; got {per_project_capacity}")
        if not isinstance(max_active_projects, int) or max_active_projects < 1:
            raise ValueError(f"max_active_projects must be integer >= 1; got {max_active_projects}")
        self._per_project_capacity = per_project_capacity
        self._max_active_projects = max_active_projects
        self._clock = clock
        self._activity_window_ms = activity_window_ms
        self._per_project: dict[str, AsyncSemaphore] = {}
        self._last_activity: dict[str, float] = {}

    def try_acquire(self, project_id: str) -> Callable[[], None] | None:
        if not self._can_admit_project(project_id):
            return None
        sem = self._get_semaphore(project_id)
        inner_release = sem.try_acquire()
        if inner_release is None:
            return None
        self._last_activity[project_id] = self._clock.monotonic_ms()
        released = [False]

        def release() -> None:
            if released[0]:
                return
            released[0] = True
            self._last_activity[project_id] = self._clock.monotonic_ms()
            inner_release()

        return release

    def _can_admit_project(self, project_id: str) -> bool:
        existing = self._per_project.get(project_id)
        if existing is not None and existing.in_use > 0:
            return True
        active = self.active_project_ids()
        return len(active) < self._max_active_projects

    def in_use_for(self, project_id: str) -> int:
        sem = self._per_project.get(project_id)
        return sem.in_use if sem else 0

    def active_project_ids(self) -> list[str]:
        now = self._clock.monotonic_ms()
        active: list[str] = []
        for pid, sem in self._per_project.items():
            if sem.in_use > 0:
                active.append(pid)
                continue
            last = self._last_activity.get(pid, 0.0)
            if now - last <= self._activity_window_ms:
                active.append(pid)
        return active

    def _get_semaphore(self, project_id: str) -> AsyncSemaphore:
        sem = self._per_project.get(project_id)
        if sem is None:
            sem = AsyncSemaphore(self._per_project_capacity)
            self._per_project[project_id] = sem
        return sem
