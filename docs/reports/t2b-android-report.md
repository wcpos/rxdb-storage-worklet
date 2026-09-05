*Historical snapshot as of 2026-09-05; later commits changed this state—see [t6a-fixes.md](t6a-fixes.md) and [t6b-honest-benchmarks.md](t6b-honest-benchmarks.md). The Android packaging omission was fixed in e8153aa.*

## Build — **PASS** (Observed)

- `Pixel_Tablet_API_35` was already running; boot verified and emulator left running.
- Port `8081` was occupied, so Expo used `8083`.
- Configured `adb reverse tcp:8083 tcp:8083`.
- `npx expo run:android --port 8083`:
  - `BUILD SUCCESSFUL in 10s`
  - APK installed and opened successfully.
- **Attempts:** 1
- **Errors/fixes this run:** none.
- Clean prebuild was unnecessary because the generated project and autolinking output were current.

## Android medians

| Mode | Insert 500 | 10 queries | Find 200 | Reactive 200 | RN send | Blocked | Max lag | >50 ms | Persistence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JS filesystem | 38.79 ms | 17.72 ms | 0.09 ms | 12.21 ms | 0 | 176.01 ms | 123.87 ms | 1 | 50/50 PASS |
| JS memory | 2.97 ms | 3.24 ms | 0.09 ms | 1.44 ms | 0 | 67.21 ms | 30.78 ms | 0 | 50/50 PASS |
| Worklet filesystem | 115.70 ms | 12.37 ms | 0.10 ms | 42.10 ms | 14.76 ms | 139.70 ms | 31.40 ms | 0 | 50/50 PASS |
| Worklet memory | 67.61 ms | 5.23 ms | 0.10 ms | 21.15 ms | 16.29 ms | 119.61 ms | 29.66 ms | 0 | 50/50 PASS |

Maestro completed all four testID-driven modes. The Metro log contained exactly 12 Android results—three per mode.

`example/scripts/collect-results.mjs` wrote:

`benchmarks/android.json`

Its structure matches `benchmarks/ios.json`; the retained lag series was verified against each mode’s median-duration sample.

## Android integration

- **No `@react-native/gradle-plugin` patch exists.**
- Generated `autolinking.cpp` contains:
  - `WorkletFsSpec_ModuleProvider(...)`
  - `std::make_shared<WorkletFsModule>(jsInvoker)`
- Android codegen requires the library’s Gradle project, build-only Java `ReactPackage`, React Gradle plugin, and `implementation 'com.facebook.react:react-android'`.
- Android callers must supply an explicit filesystem root.

### Consumer packaging warning

Observed via `npm pack --dry-run`: `packages/react-native-worklet-fs/package.json` currently omits `"android"` from its `files` list. Therefore a published tarball would exclude the required Gradle project. I left this unchanged because it was not a workspace build error; it must be addressed before publishing for external Android consumers.

## Working tree

Only the requested benchmark artifact is new:

```text
?? benchmarks/android.json
```

No commit was created. Screenshot: `/tmp/t2-android-final.png`.

## Behavior changes / regressions

No source behavior changed during this run. External package consumption remains unverified and is blocked by the packaging omission described above.