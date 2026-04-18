from __future__ import annotations

import asyncio
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from .types import ExecFn, ExecOptions, ExecResult

_UPSTREAM_SIGNALS = [
    re.compile(r"\b401\b", re.IGNORECASE),
    re.compile(r"\brate[- ]?limit(?:ed|ing)?\b", re.IGNORECASE),
    re.compile(r"\bunauthori[sz]ed\b", re.IGNORECASE),
    re.compile(r"\bquota\b", re.IGNORECASE),
    re.compile(r"\btoo many requests\b", re.IGNORECASE),
    re.compile(r"\boverloaded\b", re.IGNORECASE),
]


def detect_upstream_failure(stderr: str) -> bool:
    if not stderr:
        return False
    return any(rx.search(stderr) for rx in _UPSTREAM_SIGNALS)


async def default_exec(binary: str, args: Sequence[str], opts: ExecOptions) -> ExecResult:
    timeout_ms = float(opts.get("timeout_ms", 600_000))
    cwd = opts.get("cwd")
    process = await asyncio.create_subprocess_exec(
        binary,
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            process.communicate(), timeout=timeout_ms / 1000.0
        )
    except TimeoutError:
        process.kill()
        await process.wait()
        raise
    return {
        "stdout": stdout_b.decode("utf-8", errors="replace"),
        "stderr": stderr_b.decode("utf-8", errors="replace"),
        "exit_code": process.returncode if process.returncode is not None else 1,
    }


@dataclass(frozen=True, slots=True)
class RunnerInvocation:
    prompt: str
    cwd: str | None
    extra_args: tuple[str, ...]
    timeout_ms: float


@dataclass(frozen=True, slots=True)
class RunnerOutcome:
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: float
    upstream: bool


class ClaudeRunner:
    def __init__(
        self,
        binary: str,
        base_args: tuple[str, ...],
        exec_fn: ExecFn | None = None,
        monotonic_ms: Callable[[], float] | None = None,
    ):
        self._binary = binary
        self._base_args = tuple(base_args)
        self._exec: ExecFn = exec_fn or default_exec
        self._monotonic: Callable[[], float] = monotonic_ms or (
            lambda: __import__("time").monotonic() * 1000.0
        )

    async def execute(self, inv: RunnerInvocation) -> RunnerOutcome:
        args: list[str] = [*self._base_args, *inv.extra_args, inv.prompt]
        opts: ExecOptions = {"timeout_ms": inv.timeout_ms}
        if inv.cwd is not None:
            opts["cwd"] = inv.cwd
        start = self._monotonic()
        result = await self._exec(self._binary, args, opts)
        duration_ms = max(self._monotonic() - start, 0.0)
        stderr = result.get("stderr", "")
        exit_code = result.get("exit_code", 0)
        upstream = exit_code != 0 and detect_upstream_failure(stderr)
        return RunnerOutcome(
            stdout=result.get("stdout", ""),
            stderr=stderr,
            exit_code=exit_code,
            duration_ms=duration_ms,
            upstream=upstream,
        )
