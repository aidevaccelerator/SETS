# Verification

## Automated tests

`node --test tests/*.test.mjs` passes all 18 tests (Node 24):

- **Bundled data:** 2 399 candles (BTC, ETH, SOL), all exactly one hour apart, every row satisfies low ≤ open/close ≤ high.
- **Indicators:** rolling mean and breakout high are causal. A spike at bar 30 is invisible at bar 29, and the breakout high excludes the current bar.
- **Grid mechanics:** L1–L3 fill in order; the take-profit fills at exactly `avg × (1 + tp)` with fees applied; cash ends between the start and +2%.
- **Stop loss:** closes the whole position at `deepest level × (1 − stop)` and records one losing trade.
- **No look-ahead:** changing candle 501 does not change the signal computed at candle 500.
- **Genome bounds:** 500 heavy mutations never leave a gene's range; integer genes stay integers.
- **Determinism:** two runs with the same seed produce identical histories. All four species survive 12 generations, and best fitness never decreases.
- **Reproducibility:** re-running the leader's backtest gives exactly the stored out-of-sample metrics.
- **Snapshots:** each market's frozen cohort is well formed — genomes in bounds, unique ids, T0 = last bundled candle + 1 h.
- **Forward test:** empty before T0; curve matches per-runner equities and fee-adjusted buy & hold; bots never step warmup bars; fill events are collected with bar times and replay deterministically.

## Browser checks

- Served with `python -m http.server --directory dist`. All modules, data, fonts and icons return 200. The root `index.html` forwards to `dist/` for GitHub Pages.
- Desktop, 1280 × 900: all panels render — evolution, gene pool, genome/selection/Kelly, forward test with cohort inspector. Inspect-on-click (gene-pool node g12 → "GENOME · INSPECTING"), cohort-row click (order grid + forward fills), pause, step, speed and the BTC/ETH/SOL toggle were exercised. No console errors on any market.
- Phone, 390 × 844: panels stack and `scrollWidth` equals the viewport (390 px), so nothing scrolls sideways.
- The README screenshots and GIFs were captured from the running app (seed 2026, 40 generations warmed up) with headless Chrome. No page errors were reported during capture.

## Performance

One generation (88 new configs, each backtested on train and out-of-sample) takes about 10 ms in Node. Fifty generations take about 0.5 s.

## What is not claimed

- The results table in the README comes from one 30-day out-of-sample window. It is not evidence of a durable edge, and on that window buy & hold returned more.
- No live exchange connectivity exists or was tested. The app paper-trades frozen cohorts on public market data.
- Multitouch gestures on physical devices were not tested.
