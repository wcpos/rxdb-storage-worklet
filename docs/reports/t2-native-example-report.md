Implemented T2 in worktree:

`/Users/kilbot/Projects/.worktrees/rxdb-storage-worklet-t2`

No commit was created.

## Native package

Added:

- C++20 `WorkletFsModule` header/source pair.
- One plain `jsi::Object` per installation, with host functions assigned once.
- Guarded worklet-runtime installation through `WorkletRuntime::runSync`.
- iOS document-directory lookup using `NSSearchPathForDirectoriesInDomains`.
- Android `documentDirectory()` returning `""`.
- TurboModule Codegen spec and configuration.
- iOS ObjC++ registration.
- Android Gradle/codegen integration without the spike’s Gradle-plugin patch.
- `installWorkletFs(runtime?: WorkletRuntime)`.
- Android root-directory documentation.
- Required `react-native-worklets >=0.11` peer dependency.

## iOS — PASS

Native build passed on the first build. Maestro completed all four modes and collected 12 `BENCH_RESULT` samples into `benchmarks/ios.json`.

| Mode | Insert 500 | 10 queries | Find 200 | Reactive 200 | RN send | Blocked | Max lag | >50 ms | Persistence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JS filesystem | 47.10 ms | 13.19 ms | 0.10 ms | 16.90 ms | 0 | 201.20 ms | 148.58 ms | 1 | 50/50 |
| JS memory | 3.09 ms | 1.61 ms | 0.09 ms | 1.46 ms | 0 | 49.28 ms | 17.59 ms | 0 | 50/50 |
| Worklet filesystem | 99.84 ms | 11.20 ms | 0.10 ms | 34.86 ms | 19.17 ms | 66.64 ms | 16.80 ms | 0 | 50/50 |
| Worklet memory | 58.03 ms | 3.40 ms | 0.10 ms | 25.48 ms | 19.13 ms | 66.35 ms | 17.24 ms | 0 | 50/50 |

Screenshot: `/tmp/t2-ios-final.png`

## Android — FAIL

No Android benchmark results were fabricated; `benchmarks/android.json` is absent.

Three full build attempts were used: initial build plus two rebuilds.

1. **Missing `react_codegen_WorkletFsSpec` target.**  
   Codegen supplied `libraryName`, but the dependency was initially classified as pure-C++ and therefore had no Gradle codegen project. Added a minimal Android library project and build-only Java `ReactPackage`; no Kotlin module was added.

2. **Cached autolinking output retained the old classification.**  
   Regenerated autolinking and Codegen outputs. The generated provider now includes:
   - `react_codegen_WorkletFsSpec`
   - `worklet_fs`
   - `WorkletFsModule` in `autolinking_cxxModuleProvider`

3. **Generated Java spec lacked the React Android compile dependency.**  
   Added `implementation 'com.facebook.react:react-android'`. The targeted `compileDebugJavaWithJavac` task subsequently passed, but the full native build was not rerun because the two-rebuild limit had been reached.

Thus, Android autolinking **does pick up the C++ provider without an RN patch**, but the final full Android build remains unverified after the last fix.

## Final Metro/Babel configuration

- Metro uses `withUniwindConfig(getBundleModeMetroConfig(config), …)`, with Uniwind outermost.
- Workspace source resolution uses:
  - `watchFolders`
  - example and workspace `nodeModulesPaths`
  - package exports enabled
  - `source` condition
- Babel Worklets plugin uses:
  - `bundleMode: true`
  - `strictGlobal: true`
  - `relativePaths: ['src']`
  - forwarding for `rxdb`, `rxjs`, used RxDB plugins, premium abstract filesystem, and all three workspace packages.
- Only the three requested patches are present; no Gradle-plugin patch.

## Verification

- `pnpm install`: PASS
- Premium installer scripts: PASS; abstract-filesystem plugin directory exists.
- Expo prebuild: PASS
- `pnpm typecheck`: PASS
- iOS native build: PASS
- iOS Maestro flow: PASS
- Collector: PASS
- Android autolinking/codegen generation: PASS
- Android targeted Java compilation after final fix: PASS
- Android full build: FAIL/unverified after final fix
- `.spike-reference/`: removed
- Changed source volume: approximately 1,575 lines under the 1,800-line budget

## Behavior changes / regressions

- Android callers must now provide an explicit filesystem root.
- `rxdb-storage-worklet`’s global accessor was marked as a worklet so forwarded channel delivery can execute in worker runtimes.
- No known iOS regression was observed.
- Android runtime behavior was not evaluated because the final APK build was not completed.