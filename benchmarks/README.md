# Reproducing the benchmarks

The corrected results replace measurements of an incomplete workload: the old
find-by-ID queries were never executed, and sorted queries could hit RxDB's cache.
Do not compare the old and new throughput numbers as a library speedup/regression.
Each platform JSON retains all three raw samples for all six modes, including
request timings, lag observations and phase intervals in RN `performance.now()` ms.
Repeated sustained phases are arrays; unused phases are empty arrays.

Sorted queries vary `skip` on every iteration to force storage execution. ID queries
now call `.exec()` but may still use RxDB's document cache. Both RN and the worker
use the existing binary-capable Blob polyfill; no data-URL fetch is needed. The JS counter runs
continuously in every mode. Both samplers use 16 ms ticks and materialise missed
ticks. Short-run lag covers setup through persistence; sustained lag covers only
the loop. Final sampler-stop observations are retained and labelled separately
from timer callbacks. Synthetic ticks are not real observations.

Per-metric summaries are medians of three runs; timelines retain the selected run
(short: median operation elapsed time; sustained: median materialised-tick p95).
Timeline p95 is recomputed over that run's real observations, including terminal
stop observations, not synthetic ticks. Shaded spans mark overdue intervals, not
a descending recovery curve. Timer lateness does not isolate storage CPU time.
`totalBlockedMs` now sums real lateness only, avoiding overlapping synthetic delays.
Transport summaries are medians of the three per-run upper-middle request values;
all request timestamps remain available. RN serialization excludes cloning, and
round trip starts before serialization but after waiting in the RN send queue.
Baseline transport zeros mean no worklet channel, not zero RN serialization work.
Android sustained throughput drifts sharply within both recorded attempts; its
median gap is not a stable performance ratio. The completed workload from the
flow that failed only its final result-card scroll is retained in
`android-navigation-timeout.json`, separate from the successful flow's results.
These development simulator/emulator measurements are not physical-device release
benchmarks or a breakdown of percentage overhead by subsystem.

| Component | Version |
|---|---|
| Expo | 57.0.20 |
| React Native | 0.86.3 |
| RxDB / RxDB Premium | 17.4.0 |
| react-native-worklets | 0.11.4 |
| pnpm | 11.22.0 |

From the repository root, install dependencies and RxDB Premium as described in [`example/README.md`](../example/README.md), then build and launch one platform at a time:

```sh
cd example
npx expo prebuild --clean
npx expo run:ios
# or: npx expo run:android --device Pixel_Tablet_API_35
```

Use the Metro started by `expo run:*`, or stop it before starting the command
below. Never run two Metros. Shut Android down before iOS, and shut iOS down before
Android; disable any emulator auto-restart job during iOS measurement. Run smoke
first (exactly eight scenarios, ALL PASS), then all six modes, three samples each:

```sh
npx expo start --dev-client 2>&1 | tee /tmp/rxdb-benchmark.log
~/.maestro/bin/maestro test .maestro/conformance-smoke.yaml
~/.maestro/bin/maestro test .maestro/benchmark.yaml
node scripts/collect-results.mjs /tmp/rxdb-benchmark.log ios
# use `android` instead of `ios` for the Android run
```

Record the device and date in the generated platform JSON, then regenerate the static charts and Markdown tables:

```sh
cd ..
node benchmarks/render-charts.mjs
```
