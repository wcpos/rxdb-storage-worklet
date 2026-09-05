## Observed result

Completed without committing: **551/700 non-generated changed lines**, including tests/docs, in about 70 minutes.

**These results replace numbers recorded for an incomplete workload.** Sorted queries now vary `skip`; ID queries execute `.exec()` but may use RxDB’s document cache. Full-precision samples and timestamps are retained.

### Corrected short benchmarks

Milliseconds; medians of three runs. **S/D/RTT** = RN serialization / dispatch / round trip, summarized from per-run request medians. “—” means no worklet transport.

**iOS**

| Mode | Insert 500 | 10 queries | 200 IDs | Reactive +200 | Median run-max lag | S / D / RTT |
|---|---:|---:|---:|---:|---:|---|
| `js-filesystem` | 48.219 | 89.905 | 20.844 | 13.755 | 281.006 | — |
| `js-memory` | 3.552 | 1.806 | 0.447 | 1.434 | 14.220 | — |
| `worklet-filesystem` | 132.571 | 161.721 | 18.206 | 46.460 | 29.650 | 0.006708 / 0.085625 / 11.807167 |
| `worklet-memory` | 132.518 | 107.520 | 22.564 | 54.368 | 42.740 | 0.006417 / 0.078125 / 9.561125 |

**Android**

| Mode | Insert 500 | 10 queries | 200 IDs | Reactive +200 | Median run-max lag | S / D / RTT |
|---|---:|---:|---:|---:|---:|---|
| `js-filesystem` | 93.760 | 93.506 | 20.984 | 17.383 | 327.618 | — |
| `js-memory` | 2.923 | 6.625 | 0.505 | 1.630 | 27.857 | — |
| `worklet-filesystem` | 169.754 | 172.204 | 23.584 | 59.561 | 33.369 | 0.007666 / 0.135917 / 18.053750 |
| `worklet-memory` | 155.719 | 164.836 | 30.875 | 67.831 | 99.072 | 0.007667 / 0.144625 / 16.642875 |

### Sustained throughput

Rates use each sample’s actual elapsed time, including overshoot.

| Platform / mode | Iterations, all three samples | Median documents | Median iterations/s | S / D / RTT, ms |
|---|---|---:|---:|---|
| iOS `sustained-js-filesystem` | 210, 205, 203 | 10,250 | 51.039 | — |
| iOS `sustained-worklet-filesystem` | 65, 72, 72 | 3,600 | 17.896 | 0.006125 / 0.094541 / 17.725125 |
| Android `sustained-js-filesystem` | 171, 78, 46 | 3,900 | 19.391 | — |
| Android `sustained-worklet-filesystem` | 46, 22, 12 | 1,100 | 5.308 | 0.010000 / 0.355875 / 29.451875 |

Observed worklet throughput was **64.94% lower on iOS** and **72.63% lower on Android**.

**Android is ambiguous:** substantial within-run drift repeated across both attempts. The median gap is not a stable performance ratio. The earlier completed workload is preserved in [android-navigation-timeout.json](benchmarks/android-navigation-timeout.json); its flow failed only during final result-card navigation.

### Short-lag attribution

| Platform / mode | Median run-max attribution | Largest observed run-max |
|---|---|---|
| iOS JS filesystem | 281.006 ms; spans setup through close | 422.567 ms; also multi-phase |
| iOS worklet filesystem | 29.650 ms; persistence | 29.979 ms; setup |
| Android JS filesystem | 327.618 ms; spans setup through close | 559.952 ms; also multi-phase |
| Android worklet filesystem | 33.369 ms; reactive | 59.492 ms; setup |

Memory-mode median maxima span inserts–close on iOS JS, queries–close on Android JS, and reactive work on both worklet runs.

These identify **benchmark phases, not isolated storage CPU causes**. Sustained baseline timelines each have only one real terminal observation; their p95 is not a robust distribution estimate.

## Verification

- **PASS:** native C++ rebuilt once per platform.
- **PASS:** both native smoke flows displayed exactly **8 scenarios · ALL PASS**, through public exposure.
- **PASS:** both full benchmark flows completed; **18 samples/platform**.
- **PASS:** `pnpm test` — **53 tests**.
- **PASS:** `pnpm typecheck`.
- **PASS:** conformance — **57/57 per backend**.
- **PASS:** all eight SVGs inspected in headless Chrome; corrected label occlusion, axis clipping/overlap, and compounded band opacity.
- **PASS:** raw sample, phase and matching-reply timestamp checks; `git diff --check`.

## Errors and fixes

- Worker-local reply dispatch hung native smoke. Added an RN-defined reply reference passed into public exposure, matching the [Worklets requirement](https://docs.swmansion.com/react-native-worklets/docs/guides/troubleshooting/#locally-defined-function-passed-to-scheduleonrn).
- Android rejected attachment `data:` URLs. A `Response` attempt also failed; the example now reuses the existing binary-capable Blob polyfill on RN and worker.
- An existing launchd job restarted Android during initial iOS startup. Unloaded it and repeated recordings with platform isolation.
- Increased the final Maestro scroll allowance to 60 seconds; preserved the preceding run.
- Corrected the scheduler’s runtime cast, pinned ADB to the emulator after a physical device appeared, and corrected a wrong-directory Metro launch to the existing example CLI.

## Behavior changes / regressions

- Historical workload/lag numbers are no longer comparable.
- Both samplers use 16 ms materialised ticks; the counter runs in every mode.
- `totalBlockedMs` now sums real lateness, excluding overlapping synthetic delays.
- Broader RN Blob interoperability and physical-device release performance were **not evaluated**.

### Artifacts

- [iOS data](benchmarks/ios.json), [Android data](benchmarks/android.json), [earlier Android run](benchmarks/android-navigation-timeout.json)
- Stall: [light](benchmarks/charts/js-thread-stall-light.svg) / [dark](benchmarks/charts/js-thread-stall-dark.svg)
- Operations: [light](benchmarks/charts/operation-latency-light.svg) / [dark](benchmarks/charts/operation-latency-dark.svg)
- Throughput: [light](benchmarks/charts/sustained-throughput-light.svg) / [dark](benchmarks/charts/sustained-throughput-dark.svg)
- Timeline: [light](benchmarks/charts/lag-timeline-light.svg) / [dark](benchmarks/charts/lag-timeline-dark.svg)

Task simulators/emulator, Metro and verification Chrome are shut down.