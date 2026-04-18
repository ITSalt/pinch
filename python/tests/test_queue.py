from __future__ import annotations

import asyncio

from pinch.queue import PendingTask, TaskQueue
from pinch.types import Task


def _item(id: str) -> PendingTask[str]:
    loop = asyncio.get_event_loop()
    fut: asyncio.Future[str] = loop.create_future()
    return PendingTask(id=id, project_id="p", task=Task(prompt=id), enqueued_at_mono_ms=0, future=fut)


async def test_fifo():
    q: TaskQueue[str] = TaskQueue()
    q.enqueue(_item("a"))
    q.enqueue(_item("b"))
    q.enqueue(_item("c"))
    assert q.length == 3
    assert q.dequeue() is not None and q.dequeue() is not None and q.dequeue() is not None
    assert q.dequeue() is None
    assert q.length == 0


async def test_peek():
    q: TaskQueue[str] = TaskQueue()
    q.enqueue(_item("a"))
    p = q.peek()
    assert p is not None and p.id == "a"
    assert q.length == 1


async def test_snapshot_is_copy():
    q: TaskQueue[str] = TaskQueue()
    q.enqueue(_item("a"))
    snap = q.snapshot()
    q.enqueue(_item("b"))
    assert len(snap) == 1


async def test_remove_by_id():
    q: TaskQueue[str] = TaskQueue()
    q.enqueue(_item("a"))
    q.enqueue(_item("b"))
    removed = q.remove_by_id("a")
    assert removed is not None and removed.id == "a"
    assert q.length == 1
    peek = q.peek()
    assert peek is not None and peek.id == "b"


async def test_drain_immediate_when_empty():
    q: TaskQueue[str] = TaskQueue()
    await q.drain()


async def test_drain_resolves_when_emptied():
    q: TaskQueue[str] = TaskQueue()
    q.enqueue(_item("a"))
    q.enqueue(_item("b"))
    task = asyncio.create_task(q.drain())
    await asyncio.sleep(0)
    assert not task.done()
    q.dequeue()
    q.dequeue()
    await task


async def test_multiple_drain_waiters():
    q: TaskQueue[str] = TaskQueue()
    q.enqueue(_item("a"))
    t1 = asyncio.create_task(q.drain())
    t2 = asyncio.create_task(q.drain())
    await asyncio.sleep(0)
    q.dequeue()
    await asyncio.gather(t1, t2)
