# pinch

> **Automate yourself, not around Anthropic.**
> Architecturally-capped pacing for parallel `claude -p` calls.

A tiny library (Node + Python) you drop into your own automation. It holds
the number of parallel `claude` invocations, the interval between them, and
the daily schedule **below the pattern a single human power-user could
plausibly sustain** — and it refuses to be configured any other way.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Ethics](https://img.shields.io/badge/ethics-documented-green.svg)](./ETHICS.md)

---

## Why this exists

In early 2026 Anthropic clarified that Claude Code Pro/Max subscriptions are
for *"ordinary, individual usage"* and that OAuth tokens from those
subscriptions must not be plugged into third-party tools, self-built
orchestrators, or the Agent SDK. The community reacted two ways:

1. Proxy servers that rewrap tokens to evade the policy — dishonest and
   against the spirit of the terms.
2. Migration to API-key billing — fair, but prohibitively expensive for
   one-person projects.

`pinch` is a third path. A solo developer legitimately opens 5–6 terminals
running `claude`, juggles 2–3 projects, and takes nights off. If your
automation **never exceeds any of those dimensions**, it is architecturally
indistinguishable from you using the tool by hand — both in letter and in
spirit. That's what `pinch` enforces.

See [ETHICS.md](./ETHICS.md) for the compliance rationale.

---

## The invariants you cannot override

These are hard-coded. The config validator throws `InvariantViolation` on
startup if any of these would be relaxed. There is no flag, no env var, no
monkey-patch hook. To change them you'd have to fork the project under a
different name.

| Invariant                                  | Cap   | Rationale                               |
|--------------------------------------------|-------|-----------------------------------------|
| `max_global_parallel_sessions`             | ≤ 5   | Physical ceiling for a live power-user  |
| `max_parallel_per_project`                 | ≤ 3   | Plan + dev + review = realistic max     |
| `max_active_projects`                      | ≤ 3   | Human context-switching limit           |
| `min_downtime_hours_per_day`               | ≥ 8   | Sleep. Non-negotiable                   |
| `max_working_hours_per_day`                | ≤ 16  | Derived from downtime                   |
| `min_spawn_delay_ms`                       | ≥ 15 000 | Humans read, think, switch windows   |
| `min_wave_cooldown_ms`                     | ≥ 120 000 | Pause between batches of starts     |

Everything else — exact delays, window times, wave size, timezones, runner
args — is configurable *within* these bounds.

---

## Install

```bash
# Node
npm install pinch

# Python
pip install pinch
```

Zero runtime dependencies on Node. On Python the only dep is `tzdata`
(pure-data package) and only on Windows, because Windows lacks the IANA
timezone database in stdlib.

---

## Quick start — Node

```ts
import { Pacer } from "pinch";

const pacer = new Pacer({
  workingWindow: { start: "08:00", end: "23:00", tz: "Europe/Moscow" },
  hooks: {
    onStarted:  (e) => console.log("▶", e.taskId, e.projectId),
    onFinished: (e) => console.log("✓", e.taskId, e.exitCode, `${e.durationMs}ms`),
    onBlocked:  (e) => console.log("⏸", e.reason, e.msUntilRetry),
  },
});

// Single task
const result = await pacer.run({
  prompt:    "refactor this file for readability",
  projectId: "api-gateway",
  cwd:       "/home/me/api-gateway",
});

// Batch
const results = await pacer.runBatch([
  { prompt: "write tests", projectId: "api-gateway" },
  { prompt: "add docstrings", projectId: "api-gateway" },
  { prompt: "review PR #42", projectId: "web-frontend" },
]);

await pacer.drain();
await pacer.shutdown();
```

---

## Quick start — Python

```python
import asyncio
from pinch import Pacer, Task, HookMap, PacerOptions

async def main():
    pacer = Pacer(PacerOptions(
        working_window={"start": "08:00", "end": "23:00", "tz": "Europe/Moscow"},
        hooks=HookMap(
            on_started=lambda e: print("▶", e["task_id"], e["project_id"]),
            on_finished=lambda e: print("✓", e["task_id"], e["exit_code"]),
            on_blocked=lambda e: print("⏸", e["reason"]),
        ),
    ))

    result = await pacer.run(Task(
        prompt="refactor this file for readability",
        project_id="api-gateway",
        cwd="/home/me/api-gateway",
    ))

    results = await pacer.run_batch([
        Task(prompt="write tests", project_id="api-gateway"),
        Task(prompt="add docstrings", project_id="api-gateway"),
        Task(prompt="review PR #42", project_id="web-frontend"),
    ])

    await pacer.drain()
    await pacer.shutdown()

asyncio.run(main())
```

---

## Configuration reference

Defaults (also the values above the hard floor):

```yaml
workingWindow:
  start: "08:00"
  end:   "23:00"
  tz:    "<system default>"
pacing:
  spawnDelayMs:   {min: 15000,  max: 30000}
  waveCooldownMs: {min: 120000, max: 300000}
  waveEveryN: 5
limits:
  maxGlobalParallelSessions: 5
  maxParallelPerProject:     3
  maxActiveProjects:         3
runner:
  claudeBinary:  "claude"
  taskTimeoutMs: 600000
  args: ["--print"]
```

All fields can also be set via environment variables (`PINCH_*`). Options
passed to the `Pacer` constructor win over env vars, which win over the
defaults. See [docs/invariants.md](./docs/invariants.md) for the floor of
each numeric field.

---

## Observability

`pinch` emits four events you can subscribe to via the `hooks` option:

- `onEnqueued` — task accepted into the queue
- `onStarted` — permit acquired, `claude` about to spawn
- `onFinished` — `claude` exited (successfully or not)
- `onBlocked` — dispatcher is waiting; includes `reason` (`window-closed`,
  `global-limit`, `project-limit`, `active-projects`, `wave-cooldown`,
  `upstream`, `overrun`) and `msUntilRetry`

That's the only surface. Send these wherever you want — a log file,
stdout, your Prometheus exporter, whatever. `pinch` doesn't ship its own
metrics.

---

## FAQ

**Can I raise a limit?** No, by design. If a flag could do it, the whole
premise of this library collapses — anyone staring at a "violation" could
just flip the flag. If you need more than 5 parallel sessions, you are
beyond the individual-use envelope and should be on the API.

**Two `Pacer` instances on one machine?** `pinch` is single-process in v1;
it does not know about other instances. Running two concurrently means
you can get 2×5 = 10 parallel sessions, which blows the invariant. Don't
do it. v1.1 will add cross-process coordination via a lockfile.

**Does it work with subscription *and* API key?** Yes, `pinch` is
auth-agnostic. It spawns `claude -p` as a subprocess and doesn't care how
that binary authenticates. Both groups benefit: subscribers from the
behavioural ceiling; API users from not accidentally running up a bill.

**Is this endorsed by Anthropic?** No. This is an independent,
good-faith interpretation of public terms. See [ETHICS.md](./ETHICS.md)
and use at your own risk.

**Is OAuth token handling involved?** No. `pinch` never touches tokens,
never reads configs, never rewrites endpoints. It runs `claude` with
arguments you provide — nothing more.

---

## Related projects

- [NaCl](https://github.com/ITSalt/NaCl) — the broader
  business-/systems-analysis framework this library was carved out of.

## Contributing

Issues and PRs welcome. Please read [ETHICS.md](./ETHICS.md) and
[docs/invariants.md](./docs/invariants.md) before proposing a change that
touches the hard caps — they are the reason this project exists.

## License

[MIT](./LICENSE)
