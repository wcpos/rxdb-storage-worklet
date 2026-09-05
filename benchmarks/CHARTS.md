# benchmarks/render-charts.mjs — spec (Claude-owned design; implemented in T3)

Input: `benchmarks/ios.json`, `benchmarks/android.json` (from `example/scripts/collect-results.mjs`):
```json
{ platform, device, date, rxdb, worklets, modes: { [mode]: { medians: { steps: {...}, rnSendMs, lag: { totalBlockedMs, maxLagMs, ticksOver50Ms } }, series: number[] /* per-tick lag ms of the median sample */ } } }
```
Modes: `js-filesystem` (today's app: expo-opfs on the JS thread), `worklet-filesystem` (this library), `js-memory`, `worklet-memory`.

Output: static SVG, no script, self-contained fonts (system sans stack), two variants per chart
(`*-light.svg`, `*-dark.svg`), referenced from the README with
`<picture><source media="(prefers-color-scheme: dark)" srcset="…-dark.svg"><img src="…-light.svg" alt="…"></picture>`.
A Markdown table with the same numbers follows every chart (the accessible/text view).

Palette (validated with the dataviz validator, both modes pass all checks):
- light: surface `#fcfcfb`, text primary `#0b0b0b`, text secondary `#52514e`, grid `#e6e5e1`,
  series worklet (this library) `#2a78d6`, series JS thread (baseline) `#eb6834`
- dark: surface `#1a1a19`, text primary `#ffffff`, text secondary `#c3c2b7`, grid `#2e2e2c`,
  series worklet `#3987e5`, series JS thread `#d95926`
Text always uses text tokens, never the series colour. Legend always present (2 series) plus
direct labels on bars. Bars: thin, 4 px rounded data-end anchored to the baseline, 2 px surface
gap between adjacent bars, recessive grid (1 px, grid token), no chart border.

Charts:
1. `js-thread-stall.svg` — "How long the JS thread is blocked during the benchmark". Two panels
   (iOS, Android), each a grouped bar chart with categories `max lag`, `total blocked` and two
   series (JS thread baseline, worklet). Direct value labels in ms. Y axis ms, one axis, zero-based.
2. `operation-latency.svg` — "Per-operation latency (median)". Two panels; categories
   `insert 500`, `10 queries`, `reactive +200`; same two series; direct labels.
3. `lag-timeline.svg` — "JS-thread lag per 50 ms tick during one run". Two panels; x = tick,
   y = lag ms (log-free, linear, clipped at the max of both series); two lines 2 px, baseline
   orange, worklet blue; a dashed 16 ms reference line labelled "one frame (16 ms)" in the
   secondary text token. No markers (dense series).
Sizes: 920 × 360 per chart, panels side by side with a 24 px gutter, 12/13 px labels, title 14 px
in text primary at top-left, subtitle (device, date) in text secondary. `viewBox` set so GitHub
scales it.

Script contract: `node benchmarks/render-charts.mjs` reads both JSON files, writes six SVGs into
`benchmarks/charts/`, and prints the table markdown to stdout (used to refresh the README tables).
No dependencies. A vitest test renders from a fixture and asserts the SVG contains both series
labels, the legend, the 16 ms reference, and no `<script>`.
