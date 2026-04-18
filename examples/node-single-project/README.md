# node-single-project

Minimal `pinch` usage: three prompts against a single project, paced
through the default invariants.

## Run

```bash
npm install
npm start
```

Expected timeline:

- First prompt starts after ~15–30 s (spawn delay before the first task)
- Each subsequent prompt starts ≥ 15 s after the previous
- All three run inside the configured 09:00–21:00 window

Outside the window, the pacer blocks and logs `⏸ blocked window-closed ...`
until it reopens.
