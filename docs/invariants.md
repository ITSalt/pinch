# Invariants

The seven numbers that make `pinch` what it is.

## The table

| Symbol (Node / Python)                                          | Value       | Meaning |
|-----------------------------------------------------------------|-------------|---------|
| `maxGlobalParallelSessions` / `max_global_parallel_sessions`     | **≤ 5**     | Peak concurrent `claude -p` invocations, all projects combined |
| `maxParallelPerProject` / `max_parallel_per_project`             | **≤ 3**     | Peak concurrent invocations for any single project |
| `maxActiveProjects` / `max_active_projects`                      | **≤ 3**     | Distinct projects with work-in-flight at any moment |
| `minDowntimeHoursPerDay` / `min_downtime_hours_per_day`          | **≥ 8 h**   | Hours per day during which no spawn happens |
| `maxWorkingHoursPerDay` / `max_working_hours_per_day`            | **≤ 16 h**  | Upper bound on window length (= 24 − downtime) |
| `minSpawnDelayMs` / `min_spawn_delay_ms`                         | **≥ 15 s**  | Lower bound on spawn interval's `min` field |
| `minWaveCooldownMs` / `min_wave_cooldown_ms`                     | **≥ 120 s** | Lower bound on wave cooldown's `min` field |

These live in `invariants.ts` and `invariants.py` as frozen
constants. `validateInvariants` / `validate_invariants` is called
inside the `Pacer` constructor. Violation raises `InvariantViolation`.

## Why these numbers, specifically

**5 parallel sessions.** In practice, a solo developer using Claude
Code physically opens terminals in a tiling window manager or tabbed
shell. Five is the comfortable ceiling; six is "too many tabs to read."
It is also the number that stayed consistent across every power-user
workflow we sampled before settling on this design.

**3 per project.** Observed pattern of solo work on a single codebase:
one session planning, one writing code, one reviewing / testing. Four
concurrent sessions on one codebase means the human is no longer reading
output — which is exactly what the policy wording objects to.

**3 active projects.** Matches the context-switching limit research
(e.g., Gloria Mark's work on interruption cost). Holding four distinct
codebases in working memory is not realistic; what actually happens is
the fourth project gets ignored until one of the three is done.

**8 hours of downtime.** This maps to sleep. Any library that allows
24/7 sustained activity is describing a bot, not a person. Anchoring on
sleep gives a hard, uncontroversial pause that no rule-bending can
remove.

**16 hours of working window.** Derived: 24 − 8 = 16. A window longer
than this violates the downtime invariant by definition.

**15 seconds between spawns.** The time it takes a human to skim
`claude`'s output, decide on the next move, and click into a new
terminal. Measured on a stopwatch; rounded up. Below 15 s the "human
at a keyboard" premise fails.

**2 minutes between waves.** After 5 rapid-fire starts, a person goes
and gets coffee. 2 minutes is the shortest honest "I'm away for a bit"
interval; the default (randomised 2–5 minutes) is closer to the real
behaviour.

## What happens if you try to raise them

You get `InvariantViolation` at `Pacer` construction time, before any
task is ever enqueued:

```
InvariantViolation: pinch invariant 'maxGlobalParallelSessions' violated:
  configured=6, bound=<=5
```

There is deliberately no escape hatch: no `allowUnsafe: true`, no
`debug: true`, no env var that toggles the check off. The reason is
the whole point of the library: if a flag could relax the ceiling, the
"architectural" in "architecturally capped" is a lie.

If you need higher concurrency — whether for legitimate reasons like a
large migration with a CI budget, or because your use case was never
"individual" in the first place — move to the API billing model, where
you pay per-token and Anthropic has explicitly said automation is
supported.

## Constants that are NOT hard invariants

The following values have sensible defaults but are freely
configurable within the bounds above:

- `workingWindow.start`, `workingWindow.end`, `workingWindow.tz`
- `spawnDelayMs.max` (only `min` has a floor)
- `waveCooldownMs.max` (only `min` has a floor)
- `waveEveryN` (anything ≥ 1)
- `runner.claudeBinary`, `runner.taskTimeoutMs`, `runner.args`

If your defaults should differ — say, 12-hour night-owl schedule,
25-second spawn delay — configure it. The validator only complains if
you cross one of the seven numbers in the table.

## When will these numbers change

- If Anthropic publishes stricter guidance, they will go *down* and
  `pinch` will release a new major version documenting the change.
- If Anthropic explicitly permits higher concurrency for subscriptions,
  they may go *up*, also in a major version.
- If neither happens, they stay put.

The values are not a matter of taste; they are a reading of external
policy. Treat changes to this table as a major-version concern.
