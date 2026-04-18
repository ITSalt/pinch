"""Nightly CI pattern: run a list of prompts with explicit project ids.

In CI `os.getcwd()` is unpredictable and auto-derived project ids
collapse to 'root'. Always pass `project_id` explicitly when running
inside a pipeline.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

from pinch import HookMap, Pacer, PacerOptions, Task

JOBS_JSON = os.environ.get("PINCH_JOBS") or "jobs.json"


def load_jobs() -> list[Task]:
    with open(JOBS_JSON, encoding="utf-8") as f:
        raw = json.load(f)
    return [
        Task(
            prompt=j["prompt"],
            project_id=j["project_id"],
            cwd=j.get("cwd"),
        )
        for j in raw
    ]


async def main() -> int:
    pacer = Pacer(
        PacerOptions(
            working_window={
                "start": os.environ.get("PINCH_WINDOW_START", "00:00"),
                "end": os.environ.get("PINCH_WINDOW_END", "16:00"),
                "tz": os.environ.get("PINCH_WINDOW_TZ", "UTC"),
            },
            hooks=HookMap(
                on_started=lambda e: print(
                    f"[start] {e['project_id']}/{e['task_id']}",
                    flush=True,
                ),
                on_finished=lambda e: print(
                    f"[done]  {e['project_id']}/{e['task_id']} "
                    f"exit={e['exit_code']} {e['duration_ms']}ms",
                    flush=True,
                ),
                on_blocked=lambda e: print(
                    f"[wait]  {e['reason']}", flush=True
                ),
            ),
        )
    )

    tasks = load_jobs()
    results = await pacer.run_batch(tasks)

    failed = sum(1 for r in results if r.exit_code != 0)
    ok = len(results) - failed
    print(f"\nSummary: {ok} ok, {failed} failed")

    await pacer.shutdown()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
