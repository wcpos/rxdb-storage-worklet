Implemented Parts A–E without committing.

## Observed verification

- `pnpm conformance`
  - Memory harness: **56 passed, 0 failed, 0 pending**
  - Worklet filesystem: **56 passed, 0 failed, 0 pending**
- `pnpm test`: **20 tests passed**
- `pnpm typecheck`: **passed**
- iOS Maestro using the existing simulator build:
  - **8/8 conformance scenarios passed**
  - JUnit artifact: `/tmp/conformance-smoke.xml`
- Charts: **6 static SVGs generated** under `benchmarks/charts/`
- iOS-only chart fallback: **passed**
- `actionlint`, YAML parsing, and `git diff --check`: **passed**
- Android JSON was present, so both iOS and Android panels were rendered.

CI jobs were statically validated but not executed locally because that would require new native builds/hosted runners.

## Benchmark tables

### How long the JS thread is blocked

| Platform | Metric | JS thread baseline | Worklet |
|---|---|---:|---:|
| iOS | max lag | 148.6 ms | 16.8 ms |
| iOS | total blocked | 201.2 ms | 66.6 ms |
| Android | max lag | 123.9 ms | 31.4 ms |
| Android | total blocked | 176 ms | 139.7 ms |

### Per-operation latency

| Platform | Metric | JS thread baseline | Worklet |
|---|---|---:|---:|
| iOS | insert 500 | 47.1 ms | 99.8 ms |
| iOS | 10 queries | 13.2 ms | 11.2 ms |
| iOS | reactive +200 | 16.9 ms | 34.9 ms |
| Android | insert 500 | 38.8 ms | 115.7 ms |
| Android | 10 queries | 17.7 ms | 12.4 ms |
| Android | reactive +200 | 12.2 ms | 42.1 ms |

### JS-thread lag per 50 ms tick

| Platform | Tick | JS thread baseline | Worklet |
|---|---:|---:|---:|
| iOS | 1 | 148.6 ms | 16 ms |
| iOS | 2 | 34.3 ms | 16.8 ms |
| iOS | 3 | 0 ms | 4.1 ms |
| iOS | 4 | 16.3 ms | 12.6 ms |
| iOS | 5 | 0 ms | 16.3 ms |
| iOS | 6 | — | 0.9 ms |
| Android | 1 | 123.9 ms | 79.7 ms |
| Android | 2 | 0 ms | 0 ms |
| Android | 3 | 0 ms | 16.3 ms |
| Android | 4 | 13.3 ms | 18.4 ms |
| Android | 5 | 20.7 ms | 31 ms |
| Android | 6 | 18.2 ms | 19.9 ms |
| Android | 7 | 0 ms | 36.5 ms |
| Android | 8 | — | 10.3 ms |
| Android | 9 | — | 21.1 ms |
| Android | 10 | — | 0 ms |

## Behavior changes / regressions

- `getRxStorageWorklet()` is now synchronous; schedulers load on first channel use.
- Attachments are transported through the JSON-only channel using base64.
- Worklet runtime polyfills now provide Blob operations and SHA-256 required by RxDB attachment storage.
- SHA-256 is the only digest algorithm provided by the worklet crypto polyfill; unsupported algorithms throw explicitly.
- Base64 attachment transport adds expected encoding/copy overhead.
- No other known regressions. No commit created.