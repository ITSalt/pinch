# python-ci-nightly

Shape of a nightly CI job driven by `pinch`. Reads tasks from
`jobs.json`, runs them across three projects, prints a summary.

## Run locally

```bash
pip install pinch
python main.py
```

## Run in GitHub Actions

```yaml
name: nightly-pinch
on:
  schedule:
    - cron: "0 2 * * *"   # 02:00 UTC daily
jobs:
  pinch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install pinch
      - run: python examples/python-ci-nightly/main.py
        env:
          PINCH_WINDOW_START: "00:00"
          PINCH_WINDOW_END:   "16:00"
          PINCH_WINDOW_TZ:    "UTC"
          ANTHROPIC_API_KEY:  ${{ secrets.ANTHROPIC_API_KEY }}
```

A 16-hour window covers most CI start times; outside it, the pacer
blocks and logs `[wait] window-closed` until the window reopens. If
your cron falls outside the window, either widen it or adjust the
schedule — don't disable the window check.
