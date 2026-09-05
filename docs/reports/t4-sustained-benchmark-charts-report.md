## Result

Implemented sustained benchmarking, collection, chart updates, and regenerated platform data/charts. No commit created.

### Sustained results

Scalar values are three-sample medians; each retained timeline is the median-by-p95 sample and contains 250 ticks.

| Platform | Storage | Iterations | Docs | p50 | p95 | Max | >16 ms | >50 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| iOS | JS baseline | 547 | 27,350 | 1,989.9 ms | 3,797.9 ms | 3,989.9 ms | 249 | 247 |
| iOS | Worklet | 239 | 11,950 | 6.2 ms | 15.7 ms | 29.5 ms | 12 | 0 |
| Android | JS baseline | 559 | 27,950 | 1,990.6 ms | 3,798.6 ms | 3,990.6 ms | 249 | 247 |
| Android | Worklet | 122 | 6,100 | 10.9 ms | 35.7 ms | 106.1 ms | 91 | 4 |

### Regenerated tables

| Platform | Metric | JS baseline | Worklet |
|---|---|---:|---:|
| iOS | max lag | 204 ms | 81.4 ms |
| iOS | total blocked | 823.6 ms | 325.9 ms |
| Android | max lag | 118.6 ms | 39.4 ms |
| Android | total blocked | 187.1 ms | 134.3 ms |

| Platform | Operation | JS baseline | Worklet |
|---|---|---:|---:|
| iOS | insert 500 | 42.7 ms | 107.8 ms |
| iOS | 10 queries | 16.3 ms | 13.2 ms |
| iOS | reactive +200 | 17.4 ms | 42.2 ms |
| Android | insert 500 | 43.9 ms | 115.2 ms |
| Android | 10 queries | 13.3 ms | 11 ms |
| Android | reactive +200 | 12.5 ms | 40.7 ms |

| Platform | Sustained metric | JS baseline | Worklet |
|---|---|---:|---:|
| iOS | documents written | 27,350 | 11,950 |
| iOS | iterations | 547 | 239 |
| Android | documents written | 27,950 | 6,100 |
| Android | iterations | 559 | 122 |

The complete 500-row timeline table was printed to `/tmp/rxdb-t4-tables.md`; full series are committed-ready in `benchmarks/ios.json` and `benchmarks/android.json`.

## Verification — Observed

- iOS full Maestro flow: PASS after simulator restart.
- iOS sustained rerun after sampler correction: PASS.
- Android full Maestro flow: PASS.
- Six enumerated modes × three samples = 18 samples/platform. The prompt’s “7 runs” conflicts arithmetically with “four existing + sustained × 2.”
- `pnpm test`: PASS, 20 tests, Vitest capped at two workers.
- `pnpm typecheck`: PASS.
- JSON invariants, 250-tick series, selected-series p95, and integral SVG ticks: PASS.
- `git diff --check`: PASS.
- All eight light/dark SVGs opened via Chrome headless. Labels, axes, casing, reference lines, and p95 annotations were visually checked.
- Device/date recorded as `2026-09-05`, iPhone simulator and Pixel Tablet API 35 emulator.
- All simulators and task Metro stopped afterward.

## Errors and fixes

- iOS XCTest initially returned `kAXErrorInvalidUIElement`, then its driver disconnected during retry. A cold simulator restart fixed it.
- Android’s installed build had no development-client deep-link handler. Setting React Native’s app-local debug host and reversing device port 8081 to Metro 8082 fixed loading without rebuilding.
- Initial sustained JS sampling produced one tick because the JS loop starved `setInterval`. The 16 ms sampler now materializes every missed scheduled tick; existing 50 ms sampling remains unchanged.
- Rendered near-equal bar labels initially collided/reversed visual ordering. Final labels retain value ordering with 16 px vertical separation.

## Behavior changes / regressions

- Added two sustained storage modes, on-screen JS counter, sustained metrics, collector support, and the new throughput chart.
- Observed worklet throughput was lower in these emulator/simulator runs: approximately 56% fewer iterations on iOS and 78% fewer on Android, while JS-thread lag improved substantially.
- Native compatibility was not re-evaluated because no native code changed and no rebuild was requested.

Non-generated implementation additions: 331 lines, within the 600-line budget.