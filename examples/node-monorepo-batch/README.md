# node-monorepo-batch

Runs 4 prompts × 3 projects = 12 tasks through a single `Pacer`. Shows
off the per-project cap (max 3 concurrent on any project) and the
global cap (max 5 concurrent across all projects).

## Run

Edit `PROJECTS` in `index.ts` to point at real directories on your
machine, then:

```bash
npm install
npm start
```

Watch the `▶` log lines: no project will ever exceed 3 concurrent
starts, and the `global=` counter will peak at 5 during the busiest
moments.

The run takes noticeably longer than 12 × task-duration because
`pinch` deliberately spaces starts by ≥ 15 s and throws in a wave
cooldown every 5 starts.
