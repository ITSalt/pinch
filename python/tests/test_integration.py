from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from pinch.jitter import seeded_rng
from pinch.pacer import Pacer
from pinch.types import Task


class FakeClock:
    def __init__(self, initial_epoch: float | None = None):
        self._mono = 0.0
        self._epoch = (
            initial_epoch
            if initial_epoch is not None
            else datetime(2025, 6, 15, 10, 0, 0, tzinfo=UTC).timestamp()
        )
        self._sleepers: list[tuple[asyncio.Future[None], float]] = []
        self._ticker_handle: asyncio.TimerHandle | None = None

    def now(self) -> float:
        return self._epoch

    def monotonic_ms(self) -> float:
        return self._mono

    async def sleep(self, ms: float) -> None:
        if ms <= 0:
            await asyncio.sleep(0)
            return
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[None] = loop.create_future()
        self._sleepers.append((fut, self._mono + ms))
        self._schedule_tick()
        await fut

    def advance(self, ms: float) -> None:
        if ms > 0:
            self._mono += ms
            self._epoch += ms / 1000.0
            self._fire_resolved()

    def _schedule_tick(self) -> None:
        if self._ticker_handle is not None:
            return
        loop = asyncio.get_running_loop()
        self._ticker_handle = loop.call_soon(self._tick)

    def _tick(self) -> None:
        self._ticker_handle = None
        if not self._sleepers:
            return
        earliest = min(s[1] for s in self._sleepers)
        delta = earliest - self._mono
        if delta > 0:
            self._mono += delta
            self._epoch += delta / 1000.0
        self._fire_resolved()
        if self._sleepers:
            self._schedule_tick()

    def _fire_resolved(self) -> None:
        remaining: list[tuple[asyncio.Future[None], float]] = []
        fired: list[asyncio.Future[None]] = []
        for fut, target in self._sleepers:
            if self._mono >= target:
                fired.append(fut)
            else:
                remaining.append((fut, target))
        self._sleepers = remaining
        for f in fired:
            if not f.done():
                f.set_result(None)


def _mock_exec(clock: FakeClock, sim_duration_ms: int):
    async def fn(binary, args, opts):
        clock.advance(sim_duration_ms)
        await asyncio.sleep(0)
        return {"stdout": "ok", "stderr": "", "exit_code": 0}
    return fn


class ExecGate:
    def __init__(self):
        self._waiters: list[asyncio.Future[None]] = []

    async def wait(self) -> None:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[None] = loop.create_future()
        self._waiters.append(fut)
        await fut

    def release_all(self) -> None:
        waiters = self._waiters
        self._waiters = []
        for w in waiters:
            if not w.done():
                w.set_result(None)

    @property
    def pending(self) -> int:
        return len(self._waiters)


def _gated_exec(clock: FakeClock, gate: ExecGate, sim_duration_ms: int):
    async def fn(binary, args, opts):
        await gate.wait()
        clock.advance(sim_duration_ms)
        return {"stdout": "ok", "stderr": "", "exit_code": 0}
    return fn


def _make_pacer(clock: FakeClock, *, jitter_seed=1, hooks=None, exec_fn=None, **overrides):
    from pinch.types import HookMap, PacerOptions

    opts = PacerOptions(
        working_window={"start": "08:00", "end": "23:00", "tz": "UTC"},
        clock=clock,
        jitter=seeded_rng(jitter_seed),
        runner_exec=exec_fn or _mock_exec(clock, 500),
        hooks=hooks if hooks is not None else HookMap(),
        **overrides,
    )
    return Pacer(opts)


async def test_runs_single_task():
    clock = FakeClock()
    pacer = _make_pacer(clock)
    r = await pacer.run(Task(prompt="hello", project_id="alpha"))
    assert r.exit_code == 0
    assert r.stdout == "ok"
    assert r.project_id == "alpha"
    assert r.duration_ms == 500
    await pacer.shutdown()


async def test_never_exceeds_global_cap_across_20():
    clock = FakeClock()
    peak = {"g": 0}
    from pinch.types import HookMap

    def on_started(e):
        if e["global_active"] > peak["g"]:
            peak["g"] = e["global_active"]

    pacer = _make_pacer(clock, jitter_seed=7, hooks=HookMap(on_started=on_started))
    tasks = [Task(prompt=f"t-{i}", project_id=f"p-{i % 3}") for i in range(20)]
    results = await pacer.run_batch(tasks)
    assert len(results) == 20
    for r in results:
        assert r.exit_code == 0
    assert peak["g"] <= 5
    await pacer.shutdown()


async def test_never_exceeds_per_project():
    clock = FakeClock()
    peaks: dict[str, int] = {}
    from pinch.types import HookMap

    def on_started(e):
        cur = peaks.get(e["project_id"], 0)
        if e["project_active"] > cur:
            peaks[e["project_id"]] = e["project_active"]

    pacer = _make_pacer(clock, jitter_seed=13, hooks=HookMap(on_started=on_started))
    tasks = [Task(prompt=f"t-{i}", project_id=f"p-{i % 2}") for i in range(15)]
    await pacer.run_batch(tasks)
    for v in peaks.values():
        assert v <= 3
    await pacer.shutdown()


async def test_never_exceeds_active_projects():
    clock = FakeClock()
    peak = {"v": 0}
    from pinch.types import HookMap

    pacer = None

    def on_started(e):
        if pacer is not None:
            v = len(pacer.stats().active_projects)
            if v > peak["v"]:
                peak["v"] = v

    pacer = _make_pacer(
        clock,
        jitter_seed=21,
        hooks=HookMap(on_started=on_started),
        exec_fn=_mock_exec(FakeClock(), 300),
    )
    # Recreate with shared clock for consistency
    peak["v"] = 0
    pacer = _make_pacer(clock, jitter_seed=21, hooks=HookMap(on_started=on_started))
    tasks = [Task(prompt=f"t-{i}", project_id=f"p-{i % 5}") for i in range(10)]
    await pacer.run_batch(tasks)
    assert peak["v"] <= 3
    await pacer.shutdown()


async def test_enforces_min_spawn_delay():
    clock = FakeClock()
    start_times: list[float] = []
    from pinch.types import HookMap

    def on_started(e):
        start_times.append(clock.monotonic_ms())

    pacer = _make_pacer(
        clock,
        jitter_seed=42,
        hooks=HookMap(on_started=on_started),
        exec_fn=_mock_exec(clock, 100),
    )
    tasks = [Task(prompt=f"t-{i}", project_id="alpha") for i in range(4)]
    await pacer.run_batch(tasks)
    for i in range(1, len(start_times)):
        delta = start_times[i] - start_times[i - 1]
        assert delta >= 15_000
    await pacer.shutdown()


async def test_wave_cooldown_kicks_in():
    clock = FakeClock()
    start_times: list[float] = []
    blocked: list[str] = []
    from pinch.types import HookMap

    def on_started(e):
        start_times.append(clock.monotonic_ms())

    def on_blocked(e):
        blocked.append(e["reason"])

    pacer = _make_pacer(
        clock,
        jitter_seed=99,
        hooks=HookMap(on_started=on_started, on_blocked=on_blocked),
        pacing={"wave_every_n": 3},
        exec_fn=_mock_exec(clock, 100),
    )
    tasks = [Task(prompt=f"t-{i}", project_id="alpha") for i in range(7)]
    await pacer.run_batch(tasks)
    assert "wave-cooldown" in blocked
    if len(start_times) >= 4:
        assert start_times[3] - start_times[2] >= 120_000
    await pacer.shutdown()


async def test_blocks_when_window_closed():
    closed_epoch = datetime(2025, 6, 15, 5, 0, 0, tzinfo=UTC).timestamp()
    clock = FakeClock(closed_epoch)
    blocked: list[str] = []
    from pinch.types import HookMap

    def on_blocked(e):
        blocked.append(e["reason"])

    pacer = _make_pacer(clock, jitter_seed=2, hooks=HookMap(on_blocked=on_blocked),
                       exec_fn=_mock_exec(clock, 100))
    r = await pacer.run(Task(prompt="late", project_id="alpha"))
    assert r.exit_code == 0
    assert "window-closed" in blocked
    assert clock.now() >= datetime(2025, 6, 15, 8, 0, 0, tzinfo=UTC).timestamp()
    await pacer.shutdown()


async def test_rejects_run_after_shutdown():
    clock = FakeClock()
    pacer = _make_pacer(clock, exec_fn=_mock_exec(clock, 100))
    await pacer.shutdown()
    import pytest

    with pytest.raises(RuntimeError, match="shut down"):
        await pacer.run(Task(prompt="nope"))


async def test_drain_resolves_when_done():
    clock = FakeClock()
    pacer = _make_pacer(clock, exec_fn=_mock_exec(clock, 100))
    p1 = asyncio.create_task(pacer.run(Task(prompt="a", project_id="alpha")))
    p2 = asyncio.create_task(pacer.run(Task(prompt="b", project_id="alpha")))
    await pacer.drain()
    await asyncio.gather(p1, p2)
    s = pacer.stats()
    assert s.queue_depth == 0
    assert s.global_active == 0
    await pacer.shutdown()


async def test_reaches_5_parallel_ceiling_with_gate():
    clock = FakeClock()
    gate = ExecGate()
    peak = {"g": 0}
    from pinch.types import HookMap

    def on_started(e):
        if e["global_active"] > peak["g"]:
            peak["g"] = e["global_active"]

    pacer = _make_pacer(
        clock,
        jitter_seed=100,
        hooks=HookMap(on_started=on_started),
        exec_fn=_gated_exec(clock, gate, 100),
    )
    tasks = [Task(prompt=f"t-{i}", project_id=f"p-{i % 3}") for i in range(12)]
    batch = asyncio.create_task(pacer.run_batch(tasks))
    for _ in range(200):
        await asyncio.sleep(0)
        if peak["g"] >= 5:
            break
    assert pacer.stats().global_active == 5
    assert peak["g"] == 5
    while pacer.stats().queue_depth > 0 or pacer.stats().global_active > 0 or gate.pending > 0:
        gate.release_all()
        await asyncio.sleep(0)
    await batch
    assert peak["g"] <= 5
    await pacer.shutdown()


async def test_stats_reflects_runtime_state():
    clock = FakeClock()
    finished: list[str] = []
    from pinch.types import HookMap

    def on_finished(e):
        finished.append(e["task_id"])

    pacer = _make_pacer(clock, exec_fn=_mock_exec(clock, 100),
                       hooks=HookMap(on_finished=on_finished))
    await pacer.run_batch(
        [Task(prompt="a", project_id="alpha"), Task(prompt="b", project_id="beta")]
    )
    assert len(finished) == 2
    s = pacer.stats()
    assert s.queue_depth == 0
    assert s.global_active == 0
    assert s.window_open is True
    await pacer.shutdown()
