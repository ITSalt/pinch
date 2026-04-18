from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from .invariants import parse_hhmm_to_minutes
from .types import Clock, WorkingWindowConfig

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment,misc]

MS_PER_MINUTE = 60_000
MINUTES_PER_DAY = 24 * 60


@dataclass(frozen=True, slots=True)
class WallClock:
    hour: int
    minute: int
    second: int


def wall_clock_in_tz(epoch_seconds: float, tz: str) -> WallClock:
    if ZoneInfo is None:
        raise RuntimeError("zoneinfo is required (Python 3.9+)")
    dt = datetime.fromtimestamp(epoch_seconds, tz=UTC).astimezone(ZoneInfo(tz))
    return WallClock(hour=dt.hour, minute=dt.minute, second=dt.second)


class WorkingWindow:
    def __init__(self, config: WorkingWindowConfig, clock: Clock):
        self._config = config
        self._clock = clock
        self._start_min = parse_hhmm_to_minutes(config.start, "working_window.start")
        self._end_min = parse_hhmm_to_minutes(config.end, "working_window.end")

    def is_open_now(self) -> bool:
        now_min = self._current_minutes_of_day()
        return self._start_min <= now_min < self._end_min

    def ms_until_next_open(self) -> int:
        if self.is_open_now():
            return 0
        now_min = self._current_minutes_of_day()
        now_sec = self._current_seconds_past_minute()
        if now_min < self._start_min:
            offset_min = self._start_min - now_min
        else:
            offset_min = MINUTES_PER_DAY - now_min + self._start_min
        ms = offset_min * MS_PER_MINUTE - now_sec * 1000
        return max(ms, 0)

    def ms_until_close(self) -> int:
        if not self.is_open_now():
            return 0
        now_min = self._current_minutes_of_day()
        now_sec = self._current_seconds_past_minute()
        ms = (self._end_min - now_min) * MS_PER_MINUTE - now_sec * 1000
        return max(ms, 0)

    def describe(self) -> str:
        return f"{self._config.start}-{self._config.end} {self._config.tz}"

    def _current_minutes_of_day(self) -> int:
        wc = wall_clock_in_tz(self._clock.now(), self._config.tz)
        return wc.hour * 60 + wc.minute

    def _current_seconds_past_minute(self) -> int:
        wc = wall_clock_in_tz(self._clock.now(), self._config.tz)
        return wc.second


class SystemClock:
    def __init__(self) -> None:
        self._origin = time.monotonic()

    def now(self) -> float:
        return time.time()

    def monotonic_ms(self) -> float:
        return (time.monotonic() - self._origin) * 1000.0

    async def sleep(self, ms: float) -> None:
        if ms <= 0:
            return
        await asyncio.sleep(ms / 1000.0)


def system_clock() -> Clock:
    return SystemClock()
