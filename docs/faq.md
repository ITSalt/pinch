# FAQ

## "Can I raise the 5-parallel cap?"

No. That's the entire point of the library. Every number listed in
[invariants.md](./invariants.md) is frozen at construction time; the
validator throws `InvariantViolation` before you ever queue a task.
There is no flag, env var, monkey-patch hook, or debug mode that
relaxes it. If we added one, a user in a hurry would flip it, and the
"architectural ceiling" becomes a lie.

If you need more than 5 parallel sessions, move to Anthropic's API
billing. `pinch` is auth-agnostic — the same code works with an API
key in `ANTHROPIC_API_KEY`.

## "Can I run two Pacers in the same process?"

Nothing stops you, but they won't coordinate — so the aggregate can
exceed the invariants. Don't do it. In v1 `pinch` is single-process.
v1.1 will add a lockfile at `~/.pinch/global.json` so two instances on
the same machine coordinate.

## "Can I run pinch inside a CI pipeline?"

Yes, but with these caveats:

- Pass `projectId` explicitly — `cwd` in CI containers is unpredictable
  and the auto-derived project id may collapse everything into one
  "project".
- Consider overriding `workingWindow` to the pipeline's run window, or
  setting it to something like `"00:00"` → `"16:00"` UTC so it's open
  during scheduled jobs.
- Keep the default `minSpawnDelayMs` — CI-with-15s-delay still fits in
  a nightly job and the alternative is going back to the API.

## "What about rate-limit errors from claude?"

The runner checks the child's stderr for well-known upstream-failure
patterns (`401`, `rate-limit`, `quota`, `too many requests`,
`overloaded`, `unauthorized`). When detected, the dispatcher sets a
60-minute pause and emits `onBlocked({reason: "upstream"})`. This is
an implicit back-off on top of your explicit pacing.

## "A task failed with exit code 1 in half a second. Is the pacer stuck?"

No. If a task exits non-zero in under 2 s, `pinch` treats it as a fast
failure (probably a bad arg or broken config), does NOT apply
`spawnDelay` before the next task, and does NOT advance the
wave-cooldown counter. This prevents `pinch` from becoming unusable
when the user's first task is mis-configured.

## "What about tasks that take hours?"

`timeoutMs` (default 600 000 ms = 10 min) is an upper bound per task.
If you need longer, set it per-task: `pacer.run({..., timeoutMs: 3_600_000})`.
Windows closing before a long-running task finishes don't kill it —
the task runs to completion. New tasks, however, will not start until
the next window open.

## "Why does the first task wait 15+ seconds before starting?"

The dispatcher applies one spawn delay before the very first task. The
plan of record treats a fresh `Pacer` as equivalent to a human who
just sat down and hasn't yet fired off the first request — they still
wait "a moment". This also means the pacer never immediately hammers
`claude` after an import/startup.

If the delay is annoying during development, test with a shorter
`workingWindow` + a `FakeClock` in a unit test rather than altering
invariants.

## "Does pinch touch OAuth tokens?"

No. It runs `claude` as a subprocess with argv you configure. `claude`
reads its own auth however it does — subscription OAuth, API key, it's
all opaque to `pinch`. We never extract, cache, proxy, or rewrite any
credential.

## "Is pinch endorsed by Anthropic?"

No. This is an independent, good-faith interpretation of their public
terms. See [ETHICS.md](../ETHICS.md) for the policy references and the
rationale. Use at your own risk.

## "Can I add priorities? Deadlines? A persistent queue?"

Not in v1. Strict FIFO among admissible tasks, in-memory queue, no
scheduling-aware selection. These are on the v1.1 candidate list. Open
a GitHub issue with your concrete use case if you want to push them up
the priority.

## "Does pinch work on Windows?"

Yes. The Node package is cross-platform by construction. The Python
package pulls in `tzdata` on Windows (the stdlib `zoneinfo` lacks the
IANA database on that platform). Both are covered by CI.

## "Why two packages? Why not just Node (or just Python)?"

Different communities automate Claude Code differently — data-science
teams lean Python, platform-engineering teams lean Node. Rather than
force one, `pinch` ships both and keeps them in API lockstep. A single
SemVer tag releases both to npm and PyPI together.

## "I found a bug / I disagree with a constant."

Open an issue. Bugs get PRs; constants get a policy argument (see
[invariants.md](./invariants.md) — changing a cap is a major-version
concern tied to Anthropic's public guidance, not an internal taste
debate).

## "What's the relationship to NaCl?"

[NaCl](https://github.com/ITSalt/NaCl) is the BA/SA-framework project
by the same author. `pinch` was carved out because the pacing logic
there applied to any Claude Code automation, not just NaCl workflows.
Both are MIT-licensed and can be used independently.
