# P1's original Python tools (reference)

- `dumb_filter.py` — the naive keyword filter. The app and `npm run eval` use the JavaScript
  port in [../index.js](../index.js) (same words, same matching).
- `benchmark.py` — head-to-head benchmark. It imports a Python `detector.analyze_message`, which
  doesn't exist in this repo (the engine is JavaScript), so use **`npm run eval`** instead: it runs
  the full TrustLens pipeline and this baseline on `data/messages.json` and prints accuracy,
  false alarms and missed scams.

Both expect `dataset/messages.csv`; in this repo the CSV lives at `data/messages.csv`
(`python dumb_filter.py` → change the path or run `evaluate_baseline("../../data/messages.csv")`).
