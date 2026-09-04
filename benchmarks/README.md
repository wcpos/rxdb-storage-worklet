# Reproducing the benchmarks

The checked-in results were recorded on 2026-09-04 with three samples per mode. The collector records per-metric medians and retains the median-by-elapsed-time sample's lag series. iOS used an iPhone simulator (model was not recorded) and Android used a `Pixel_Tablet_API_35` emulator.

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

Save Metro's output while running all four modes three times with Maestro:

```sh
npx expo start --dev-client 2>&1 | tee /tmp/rxdb-benchmark.log
~/.maestro/bin/maestro test .maestro/benchmark.yaml
node scripts/collect-results.mjs /tmp/rxdb-benchmark.log ios
# use `android` instead of `ios` for the Android run
```

Record the device and date in the generated platform JSON, then regenerate the static charts and Markdown tables:

```sh
cd ..
node benchmarks/render-charts.mjs
```
