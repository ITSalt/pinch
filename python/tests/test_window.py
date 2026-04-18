from __future__ import annotations

from datetime import UTC, datetime

from pinch.types import WorkingWindowConfig
from pinch.window import WorkingWindow, wall_clock_in_tz


class FakeClock:
    def __init__(self, epoch_seconds: float):
        self._epoch = epoch_seconds

    def now(self) -> float:
        return self._epoch

    def monotonic_ms(self) -> float:
        return 0

    async def sleep(self, ms: float) -> None:
        return None


def utc_at(h: int, m: int = 0, s: int = 0) -> float:
    return datetime(2025, 6, 15, h, m, s, tzinfo=UTC).timestamp()


UTC_WINDOW = WorkingWindowConfig(start="08:00", end="23:00", tz="UTC")


def test_closed_before_start():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(7, 59)))
    assert not w.is_open_now()


def test_open_exactly_at_start():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(8)))
    assert w.is_open_now()


def test_open_mid_window():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(15)))
    assert w.is_open_now()


def test_closed_exactly_at_end():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(23)))
    assert not w.is_open_now()


def test_closed_after_end():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(23, 30)))
    assert not w.is_open_now()


def test_ms_until_open_zero_when_open():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(10)))
    assert w.ms_until_next_open() == 0


def test_ms_until_open_one_hour_before():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(7)))
    assert w.ms_until_next_open() == 60 * 60 * 1000


def test_ms_until_open_accounts_for_seconds():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(7, 0, 30)))
    assert w.ms_until_next_open() == 60 * 60 * 1000 - 30_000


def test_ms_until_open_wraps_to_next_day():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(23)))
    assert w.ms_until_next_open() == (24 - 23 + 8) * 60 * 60 * 1000


def test_ms_until_close_zero_when_closed():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(5)))
    assert w.ms_until_close() == 0


def test_ms_until_close_full_duration_at_open():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(8)))
    assert w.ms_until_close() == 15 * 60 * 60 * 1000


def test_ms_until_close_decreases():
    w = WorkingWindow(UTC_WINDOW, FakeClock(utc_at(22, 55)))
    assert w.ms_until_close() == 5 * 60 * 1000


def test_24_00_end_means_all_day():
    cfg = WorkingWindowConfig(start="08:00", end="24:00", tz="UTC")
    w1 = WorkingWindow(cfg, FakeClock(utc_at(8)))
    assert w1.is_open_now()
    w2 = WorkingWindow(cfg, FakeClock(utc_at(23, 59)))
    assert w2.is_open_now()


def test_moscow_tz():
    cfg = WorkingWindowConfig(start="08:00", end="23:00", tz="Europe/Moscow")
    w = WorkingWindow(cfg, FakeClock(utc_at(5)))  # 08:00 Moscow
    assert w.is_open_now()


def test_moscow_closed():
    cfg = WorkingWindowConfig(start="08:00", end="23:00", tz="Europe/Moscow")
    w = WorkingWindow(cfg, FakeClock(utc_at(4)))
    assert not w.is_open_now()


def test_wall_clock_in_tz_utc():
    wc = wall_clock_in_tz(utc_at(10, 30, 45), "UTC")
    assert wc.hour == 10 and wc.minute == 30 and wc.second == 45


def test_wall_clock_in_tz_moscow():
    wc = wall_clock_in_tz(utc_at(10), "Europe/Moscow")
    assert wc.hour == 13


def test_describe():
    w = WorkingWindow(UTC_WINDOW, FakeClock(0))
    assert w.describe() == "08:00-23:00 UTC"
