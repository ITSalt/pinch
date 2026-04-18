from __future__ import annotations

import asyncio

import pytest

from pinch.semaphore import AsyncSemaphore, ProjectSemaphore


class FakeClock:
    def __init__(self):
        self._mono = 0.0

    def now(self) -> float:
        return 0.0

    def monotonic_ms(self) -> float:
        return self._mono

    async def sleep(self, ms: float) -> None:
        return None

    def advance(self, ms: float) -> None:
        self._mono += ms


def test_rejects_invalid_capacity():
    with pytest.raises(ValueError):
        AsyncSemaphore(0)
    with pytest.raises(ValueError):
        AsyncSemaphore(-1)


async def test_grants_immediately_when_available():
    sem = AsyncSemaphore(2)
    r1 = await sem.acquire()
    assert sem.in_use == 1
    assert sem.available == 1
    r1()
    assert sem.in_use == 0
    assert sem.available == 2


async def test_fifo_waiters():
    sem = AsyncSemaphore(1)
    order: list[int] = []
    r1 = await sem.acquire()

    async def take(n: int):
        r = await sem.acquire()
        order.append(n)
        r()

    t2 = asyncio.create_task(take(2))
    t3 = asyncio.create_task(take(3))
    await asyncio.sleep(0)
    assert sem.pending == 2
    r1()
    await asyncio.gather(t2, t3)
    assert order == [2, 3]


async def test_release_idempotent():
    sem = AsyncSemaphore(1)
    r = await sem.acquire()
    r()
    r()
    assert sem.in_use == 0
    assert sem.available == 1


def test_try_acquire_returns_none_when_full():
    sem = AsyncSemaphore(1)
    r = sem.try_acquire()
    assert r is not None
    assert sem.try_acquire() is None
    r()
    assert sem.try_acquire() is not None


async def test_project_semaphore_per_project_cap():
    clock = FakeClock()
    ps = ProjectSemaphore(2, 3, clock)
    r1 = ps.try_acquire("a")
    r2 = ps.try_acquire("a")
    r3 = ps.try_acquire("a")
    assert r1 is not None and r2 is not None
    assert r3 is None
    r1()
    assert ps.try_acquire("a") is not None


async def test_project_semaphore_max_active_projects():
    clock = FakeClock()
    ps = ProjectSemaphore(2, 2, clock)
    assert ps.try_acquire("a") is not None
    assert ps.try_acquire("b") is not None
    assert ps.try_acquire("c") is None


async def test_project_stays_active_in_window_after_release():
    clock = FakeClock()
    ps = ProjectSemaphore(1, 2, clock, activity_window_ms=10 * 60 * 1000)
    r1 = ps.try_acquire("a")
    r2 = ps.try_acquire("b")
    assert r1 is not None and r2 is not None
    r1()
    r2()
    assert sorted(ps.active_project_ids()) == ["a", "b"]
    assert ps.try_acquire("c") is None


async def test_project_drops_out_after_window():
    clock = FakeClock()
    ps = ProjectSemaphore(1, 2, clock, activity_window_ms=10 * 60 * 1000)
    r1 = ps.try_acquire("a")
    assert r1 is not None
    r1()
    clock.advance(11 * 60 * 1000)
    assert ps.active_project_ids() == []
    assert ps.try_acquire("b") is not None
    assert ps.try_acquire("c") is not None


def test_in_use_for():
    clock = FakeClock()
    ps = ProjectSemaphore(3, 3, clock)
    r1 = ps.try_acquire("a")
    r2 = ps.try_acquire("a")
    assert ps.in_use_for("a") == 2
    assert ps.in_use_for("unseen") == 0
    r1 and r1()
    r2 and r2()
    assert ps.in_use_for("a") == 0


def test_existing_active_project_always_admits():
    clock = FakeClock()
    ps = ProjectSemaphore(3, 1, clock)
    r1 = ps.try_acquire("a")
    assert r1 is not None
    r2 = ps.try_acquire("a")
    assert r2 is not None
