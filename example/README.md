# Expo benchmark app

The app installs the existing worklet runtime polyfills on RN as well as the
worker. RN's built-in Blob cannot accept binary buffers, and Android's Expo fetch
rejects data URLs; the shared Blob polyfill keeps attachment decoding off fetch.
It is enabled identically in all benchmark modes.

This Expo 57 app compares RxDB on the React Native JavaScript thread and on a
`react-native-worklets` runtime, using memory and filesystem storage in each.

## Clean setup

From the repository root:

```sh
pnpm install
cd example
export $(grep RXDB_PREMIUM ../.env)
node node_modules/rxdb-premium/scripts/postinstall.js
node node_modules/rxdb-premium/scripts/installer.js
test -d node_modules/rxdb-premium/dist/esm/plugins/storage-abstract-filesystem
npx expo prebuild --clean
```

`RXDB_PREMIUM` is the only environment variable used. Never commit `.env` or
copy its value into generated native projects.

Run one native build at a time:

```sh
npx expo run:ios
npx expo run:android --device Pixel_Tablet_API_35
adb reverse tcp:8081 tcp:8081
```

Then run `.maestro/benchmark.yaml`, or tap each of the six modes manually. Save
Metro output and collect one platform at a time:

```sh
node scripts/collect-results.mjs /path/to/metro.log ios
node scripts/collect-results.mjs /path/to/metro.log android
```

The collector writes `benchmarks/<platform>.json` at the repository root. Metro
watches the workspace root and enables the `source` export condition so the
three `workspace:*` dependencies resolve directly from their TypeScript source.
