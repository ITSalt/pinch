from __future__ import annotations

import asyncio


class Notifier:
    def __init__(self) -> None:
        self._waiters: list[asyncio.Future[None]] = []

    def wait(self) -> asyncio.Future[None]:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[None] = loop.create_future()
        self._waiters.append(fut)
        return fut

    def notify(self) -> None:
        waiters = self._waiters
        self._waiters = []
        for w in waiters:
            if not w.done():
                w.set_result(None)

    @property
    def waiters(self) -> int:
        return len(self._waiters)
