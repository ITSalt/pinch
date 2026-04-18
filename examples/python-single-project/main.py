"""Minimal pinch usage: three prompts against one project."""

from __future__ import annotations

import asyncio
import os

from pinch import HookMap, Pacer, PacerOptions, Task


def _on_enqueued(e):
    print(f"queued     {e['task_id']} (depth={e['queue_depth']})")


def _on_started(e):
    print(f"▶ started  {e['task_id']} (active={e['global_active']})")


def _on_finished(e):
    print(
        f"✓ finished {e['task_id']} exit={e['exit_code']} "
        f"({e['duration_ms']}ms)"
    )


def _on_blocked(e):
    retry = e.get("ms_until_retry")
    print(f"⏸ blocked  {e['reason']} retry={retry if retry else '-'}ms")


async def main() -> None:
    pacer = Pacer(
        PacerOptions(
            working_window={"start": "09:00", "end": "21:00", "tz": "Europe/Moscow"},
            hooks=HookMap(
                on_enqueued=_on_enqueued,
                on_started=_on_started,
                on_finished=_on_finished,
                on_blocked=_on_blocked,
            ),
        )
    )

    prompts = [
        "Write a README for this project.",
        "Add docstrings to the main module.",
        "Summarise the top 3 security concerns in this codebase.",
    ]

    tasks = [Task(prompt=p, project_id="my-api", cwd=os.getcwd()) for p in prompts]
    results = await pacer.run_batch(tasks)

    for r in results:
        print(f"---\n{r.stdout}")

    await pacer.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
