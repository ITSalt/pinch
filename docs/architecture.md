# Architecture

A tour of how `pinch` is put together. Both runtimes mirror each other
module-for-module; where they differ the file names and Python/Node
idioms differ but the responsibilities don't.

## The big picture

```
            ┌──────────────────┐
 user code ─▶│     Pacer        │ ─ public facade
            └┬──┬──┬──┬──┬─────┘
             │  │  │  │  │
  ┌──────────▼┐ │  │  │ ┌▼──────────────┐
  │  Config   │ │  │  │ │ Observability │
  │  Loader   │ │  │  │ │   (hooks)     │
  └────┬──────┘ │  │  │ └───────────────┘
       │        │  │  │
  ┌────▼──────┐ │  │  │
  │ Invariant │ │  │  │
  │ Validator │ │  │  │
  └───────────┘ │  │  │
                │  │  │
          ┌─────▼┐ │  │
          │Queue │ │  │
          └───┬──┘ │  │
              │    │  │
       ┌──────▼────▼──▼──┐
       │   Dispatcher     │ ─ main async loop
       └─┬──────┬──────┬──┘
         │      │      │
 ┌───────▼┐ ┌───▼────┐ ┌▼─────────────┐
 │ Global │ │Project │ │ JitteredDelay│
 │Semaphr │ │Semaphr │ │              │
 └────────┘ └────────┘ └──────────────┘
                │
          ┌─────▼────────┐
          │WorkingWindow │ ─ "open now?"
          └──────────────┘
                │
          ┌─────▼────────┐
          │ClaudeRunner  │ ─ subprocess wrapper
          └──────────────┘
```

## Components

### Pacer — the facade

`Pacer` is the only type most callers need. Its constructor:

1. Takes user `PacerOptions`
2. Merges with env overlay and defaults to produce a `ResolvedConfig`
3. Passes that config through `validateInvariants`
4. Instantiates every lower-level component and wires them together
5. Calls `dispatcher.start()` to spin up the loop

Its public surface:

| Method             | Contract                                                                    |
|--------------------|-----------------------------------------------------------------------------|
| `run(task)`        | Enqueue, await completion, resolve with `TaskResult` or reject on error.    |
| `runBatch(tasks)`  | Same as `Promise.all(tasks.map(run))` — pure convenience.                   |
| `drain()`          | Resolve once queue is empty AND no active tasks.                            |
| `shutdown()`       | Reject new `run()`s, await `drain()`, exit the dispatcher loop.             |
| `stats()`          | Synchronous snapshot: queue depth, active count, cooldown flag, etc.        |

### InvariantValidator

A pure function. Never called anywhere except from `resolveConfig`
inside the `Pacer` constructor. Throws `InvariantViolation`. No escape
hatch — see [invariants.md](./invariants.md).

### ConfigLoader

Three-level merge: user options > env vars (`PINCH_*`) > defaults. The
return value is a deeply frozen `ResolvedConfig`. The env overlay is
defensive: empty strings are ignored, non-numeric values for numeric
fields are ignored.

### WorkingWindow

Answers three questions:

- `isOpenNow()` — boolean
- `msUntilNextOpen()` — 0 if open, else ms to next opening
- `msUntilClose()` — ms remaining if open, 0 if closed

Uses `Intl.DateTimeFormat` (Node) / `zoneinfo` (Python) to compute
wall-clock time in the configured IANA timezone. DST transitions are
handled by the underlying library; the window "08:00–23:00" stays in
local time across the shift, with up to ±1 hour of drift during the
transition itself (documented, not fixed).

### GlobalSemaphore, ProjectSemaphore

`GlobalSemaphore` enforces `maxGlobalParallelSessions`. Counting,
FIFO-fair, supports `acquire()` (async) and `tryAcquire()`
(synchronous).

`ProjectSemaphore` is a map of per-project semaphores plus an
"active-projects" sliding-window tracker. A project counts as active
while it has work in flight *or* had work in the last 10 minutes.
That keeps short back-to-back invocations from one project counted as
one project, not several — closer to the real experience of switching
between codebases.

### TaskQueue

In-memory FIFO. No persistence. Exposes `drain()` returning a Promise
that resolves when the queue empties (used by `Pacer.drain()`).

### JitteredDelay

Stateless helper producing randomised `spawnDelayMs()` and
`waveCooldownMs()` values in the configured ranges. Uses an injectable
RNG (`JitterSource`) for test determinism — the default is
`Math.random` / `random.random`.

### ClaudeRunner

Thin wrapper around `child_process.execFile` / `asyncio.create_subprocess_exec`:

- Never uses a shell (no `sh -c ...`)
- Closes stdin so the child can't block reading from it
- Honours `timeoutMs`
- Detects upstream failures (401, rate-limit, quota, overloaded) in stderr
  and flags the outcome so the dispatcher can pause

### Dispatcher

The main loop. Roughly:

```
while running:
    if shuttingDown and queue empty and active == 0: break
    if queue empty: wait for enqueue signal; continue
    if window closed: sleep until next open (+ startup jitter); continue
    if upstream pause active: sleep for remainder; continue
    if wave cooldown active: sleep for remainder; continue
    if nextSpawnReady not reached: sleep; continue

    pick = findAdmissible()  # first queue item whose project has capacity
    if pick is None: wait for release; continue

    acquire semaphores, remove from queue
    update nextSpawnReady = now + spawnDelay()
    increment spawnsSinceLastWave; if reached waveEveryN: set cooldown
    asynchronously: runner.execute; on finish, release permits, notify
```

The "find admissible" step is what prevents head-of-line blocking: if
the head of the queue is for a project already at cap, the dispatcher
scans past it to find a task whose project has room. FIFO is preserved
among admissible tasks.

### Notifier

Small primitive: any number of waiters await `notifier.wait()`; a
single `notifier.notify()` resolves them all. Used by the dispatcher
loop to wake on any state change (enqueue, release, shutdown).

## Clock abstraction

All sleeping and all wall-clock reads go through a `Clock` interface:

```ts
interface Clock {
  now(): number;          // epoch ms — window checks
  monotonicMs(): number;  // monotonic — pacing
  sleep(ms: number): Promise<void>;
}
```

In production, the `systemClock` implementation uses `Date.now()` +
`performance.now()` / `time.time()` + `time.monotonic()`. In tests, a
virtual `FakeClock` makes the entire thing run in <1 s real time while
exercising every pacing boundary.

## What's deliberately NOT in v1

- Cross-process coordination (lockfile). Two `Pacer` instances don't
  know about each other. v1.1.
- Persistent queue. Killing the process loses the queue. v1.1+.
- Priorities. Strict FIFO among admissible tasks.
- Schedule patterns beyond a single contiguous daily window. No
  weekends-off, no split schedules. v1.1+.
- `onBlocked(reason: "overrun")` for tasks that run long past window
  close. Documented but not implemented in v1.
- Dashboards, metrics exporters, UI. Hooks are the only surface.

Each of these is a conscious omission, not an oversight.

## File map

Node:

```
node/src/
├── pacer.ts          ── Pacer facade
├── invariants.ts     ── hard caps + validator
├── config.ts         ── loader + env overlay
├── types.ts          ── all public types
├── window.ts         ── WorkingWindow, wallClockInTz, systemClock
├── jitter.ts         ── JitteredDelay, seededRng, constantRng
├── semaphore.ts      ── Semaphore, ProjectSemaphore
├── queue.ts          ── TaskQueue
├── runner.ts         ── ClaudeRunner, detectUpstreamFailure
├── notifier.ts       ── Notifier primitive
├── dispatcher.ts     ── main async loop
└── index.ts          ── re-exports
```

Python mirrors this 1-for-1 under `python/src/pinch/`.
