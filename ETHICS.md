# Ethics of `pinch`

This file is the compliance rationale behind `pinch`. If you're auditing
before adoption, read to the end.

## The policy landscape (as of April 2026)

Anthropic tightened the rules around Claude Code subscriptions in two
public steps.

**19 February 2026 — Consumer Terms update.**
Anthropic updated the Consumer Terms of Service to clarify that Pro/Max
subscriptions are intended for *"ordinary, individual usage"* and that
OAuth tokens issued for those subscriptions must not be used with
third-party tools, self-built orchestrators, or the Agent SDK. API-based
billing is the supported path for automation scenarios.

**4 April 2026 — Enforcement announcement (Boris Cherny).**
Anthropic began actively enforcing the clause above: *"these subscriptions
weren't built for the usage patterns of these third-party tools."*
Accounts using OAuth tokens in external automation risked suspension.

Both statements are public at the time of writing. Links are intentionally
omitted from this file because URLs drift — search the Anthropic site or
the official Claude Code repository for the current references.

## Why `pinch` is compliant

`pinch` is not a way to route around that policy. It enforces an
**architectural ceiling** that is lower than what a single human with a
keyboard can sustain:

- **≤ 5 parallel `claude` sessions globally.** A real power-user tops out
  at 5–6 terminals before attention breaks down.
- **≤ 3 sessions per project, ≤ 3 active projects.** Beyond that nobody is
  actually context-switching; they are drifting.
- **≥ 8 hours of daily downtime.** Sleep is not optional for a human.
- **≥ 15 seconds between new spawns, ≥ 2 minutes between waves of 5.**
  This is the pace at which a human reads output, thinks, switches
  windows.

These are *hard invariants* — the config validator throws
`InvariantViolation` if anything in your config would relax them. The
numbers live in `invariants.ts` / `invariants.py` as frozen constants.

If your automation stays inside that envelope, it is not
distinguishable — by volume, by cadence, or by daily pattern — from a
human using Claude Code through the supported interface. That is the
definition of *"ordinary, individual usage"* we are relying on.

## Grey zones we explicitly acknowledge

**Two instances on the same machine.** `pinch` v1 is single-process. Run
two `Pacer`s in parallel and you can get 2×5 = 10 concurrent sessions,
which blows the invariant. Don't do it. v1.1 will add a lockfile.

**Sustained multi-day automation.** A human power-user does not typically
send 16 hours of batched tasks every day, every day. If your pattern is
"fire 80 tasks every 24h indefinitely," that's plausible for a few
weeks of migration work, but not indefinitely. Use judgment.

**Policy drift.** Anthropic can and does change their terms. We will
update this file and the invariants if the ceiling moves, but you should
re-check before relying on `pinch` for new automation.

## What `pinch` explicitly does NOT do

- It does **not** extract, cache, rewrap, or proxy OAuth tokens.
- It does **not** rewrite API endpoints or intercept network traffic.
- It does **not** try to mimic prompt-cache patterns to amortise costs.
- It does **not** hide the fact that automation is happening.

It's a subprocess runner with a queue, a semaphore, and a timer. That's
it. The whole thing audits in under an hour.

## Disclaimer

The authors of `pinch` are not lawyers. This file is a good-faith
reading of Anthropic's public policy as of April 2026. Use `pinch` at
your own risk. If Anthropic contacts you about your automation, cite
this file and the hard invariants — and if they tell you something
stricter, update your code accordingly.

This project is MIT-licensed. No warranty of any kind.
