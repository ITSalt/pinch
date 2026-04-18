# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Node and Python packages are released lockstep under a single SemVer tag.

## [Unreleased]

### Added
- Initial MVP: Node and Python packages with architecturally-capped pacing
  for parallel `claude -p` invocations.
- Hard invariants (cannot be overridden): max 5 global parallel sessions,
  max 3 per project, max 3 active projects, min 8h daily downtime,
  min 15s spawn delay, min 2min wave cooldown.
- Public `Pacer` facade: `run`, `runBatch`, `drain`, `shutdown`, `stats`.
- Working window with IANA timezone support.
- Observability hooks: `onEnqueued`, `onStarted`, `onFinished`, `onBlocked`.
- Zero runtime dependencies.
