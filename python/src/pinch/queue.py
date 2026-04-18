from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Generic, TypeVar

from .types import Task

R = TypeVar("R")


@dataclass(slots=True)
class PendingTask(Generic[R]):
    id: str
    project_id: str
    task: Task
    enqueued_at_mono_ms: float
    future: asyncio.Future[R]


class TaskQueue(Generic[R]):
    def __init__(self) -> None:
        self._items: list[PendingTask[R]] = []
        self._drain_waiters: list[asyncio.Future[None]] = []

    @property
    def length(self) -> int:
        return len(self._items)

    def enqueue(self, item: PendingTask[R]) -> None:
        self._items.append(item)

    def dequeue(self) -> PendingTask[R] | None:
        if not self._items:
            return None
        item = self._items.pop(0)
        if not self._items:
            self._notify_drained()
        return item

    def peek(self) -> PendingTask[R] | None:
        return self._items[0] if self._items else None

    def snapshot(self) -> list[PendingTask[R]]:
        return list(self._items)

    def remove_by_id(self, id: str) -> PendingTask[R] | None:
        for i, item in enumerate(self._items):
            if item.id == id:
                removed = self._items.pop(i)
                if not self._items:
                    self._notify_drained()
                return removed
        return None

    async def drain(self) -> None:
        if not self._items:
            return
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[None] = loop.create_future()
        self._drain_waiters.append(fut)
        await fut

    def _notify_drained(self) -> None:
        waiters = self._drain_waiters
        self._drain_waiters = []
        for w in waiters:
            if not w.done():
                w.set_result(None)
