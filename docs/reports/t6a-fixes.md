# T6a — fixes for review items 1–18

Branch: `feat/t2-native-example`. No commits or device runs. Items 19–21 and benchmark result/claim files were not changed. The shared example transport changed only for the public-channel integration required by item 13.

**Observed** means command/test output or diff inspection. Native execution and hosted CI are **Unverified**. Code changes address 1–18, but item 4's Community CLI loader proof remains **Blocked**.

## Verification totals

Final commands, each exited 0:

```sh
pnpm_config_verify_deps_before_run=warn pnpm test
pnpm_config_verify_deps_before_run=warn pnpm typecheck
pnpm_config_verify_deps_before_run=warn pnpm conformance
```

- **Observed:** unit tests **47 passed, 0 failed**: benchmark-chart test 1, native-fs Node tests 16, public-channel tests 13, OPFS/polyfill tests 17. Vitest used the configured/explicit two-worker cap; suites ran sequentially.
- **Observed:** typecheck passed for **all 4 workspace projects** (three packages plus example).
- **Observed:** conformance **memory 57/57**, **worklet-filesystem 57/57**, no failures or pending tests. Both use the public JSON channel and fake schedulers. Mocha backends ran one at a time.
- **Observed:** all three package packlists include LICENSE, `lib/index.js`, and `lib/index.d.ts`; prepack rebuilt each temporarily absent `lib/`. The dry-run packlists contained 20, 5, and 6 files respectively (native-fs, OPFS, storage).
- **Observed:** CI YAML structure and peer/dev dependency placement passed a Node assertion probe. Hosted jobs were not run.
- **Observed:** `git diff --check` passed. Two independent review rounds were used; the three reported issues were corrected.

The command prefix keeps dependency verification in warning mode instead of triggering automatic installation. `pnpm install --lockfile-only --offline --ignore-scripts` succeeded, moving the existing RxDB resolution from dependencies to devDependencies without changing versions. Full installation could not update the existing pnpm store under the read-only sandbox; pnpm's alternative store would have purged/reinstalled modules, which was declined. Tests therefore used already-installed dependencies, **not a fresh installation**. No permissions or sandbox boundaries were expanded.

## Per-item changes and evidence

Test names below are exact. Native-fs tests are in `packages/react-native-worklet-fs/test/contract.test.ts`; OPFS tests in `packages/worklet-opfs/test/index.test.ts`; channel tests in `packages/rxdb-storage-worklet/test/index.test.ts`.

| Item | Change (file:line) | Covering test / verification |
| --- | --- | --- |
| 1 (T) | Full-range positioned IO loops, EOF handling, zero-write-progress rejection: `packages/react-native-worklet-fs/cpp/WorkletFsModule.cpp:210`, `packages/react-native-worklet-fs/src/node.ts:48`; adapter also completes short backend IO at `packages/worklet-opfs/src/index.ts:357`. | `completes short positioned IO and stops reads at EOF`; `rejects zero-progress writes`; `completes short adapter IO and rejects zero write progress`. Native compilation deferred. |
| 2 (T) | Arity guard before argument indexing; typed numeric/buffer arguments; integer, finite, descriptor, buffer, JS-safe and native `off_t` bounds: `packages/react-native-worklet-fs/cpp/WorkletFsModule.cpp:80,183`; Node mirror at `packages/react-native-worklet-fs/src/node.ts:3`. | `checks required arity for every host function`; `rejects missing trailing arguments before truncation or reads`; parameterized `rejects invalid numeric argument %s before IO`; `rejects wrong types, descriptors and overflowing ranges`. Native destination-type bounds unexecuted. |
| 3 (T) | Reject NUL before path lookup/removal: `packages/worklet-opfs/src/index.ts:10`, `packages/react-native-worklet-fs/cpp/WorkletFsModule.cpp:71`, `packages/react-native-worklet-fs/src/node.ts:11`. Text encoding still permits NUL bytes. | `rejects NUL names before invoking the backend`; `rejects embedded NUL in every path argument but allows it in text`; invalid-name cases cover file, directory, and removal. |
| 4 | ESM default export: `packages/react-native-worklet-fs/react-native.config.js:1`. | Native ESM import and Expo's actual `loadConfigAsync` passed. Community CLI loader proof **blocked**, detailed below. No permanent test added. |
| 5 | Inherited crash/power-loss limitation documented, without changing flush behavior: `packages/rxdb-storage-worklet/README.md:20`. | Documentation/source inspection; no durability guarantee asserted or tested. |
| 6 (T) | Worker attachment decoding uses `new Blob([base64ToArrayBuffer(data)], { type })`; decoding errors answer the request instead of terminating its Subject: `packages/rxdb-storage-worklet/src/index.ts:62,106,178`. RN's buffer-incompatible Blob retains its existing native reply decoder. | `round trips arbitrary binary attachments without fetch through the public channel`; `answers attachment decoding failure and keeps the next request alive`; `decodes attachment replies with the RN Blob implementation` (Node shim, not a device). |
| 7 (T) | Paired explicit receive names and identifier-derived defaults: `packages/rxdb-storage-worklet/src/index.ts:91,138,157`. | `isolates two storages on two runtimes with distinct receive bindings`; `derives matching receive bindings from identifier`; `pairs the default channel creator with the default exposure`. |
| 8 (T) | Fresh RN channel on each creator invocation; connection shutdown retains exposure: `packages/rxdb-storage-worklet/src/index.ts:95,124`. | `opens closes and reopens through the same RxStorage`; `closes the RN channel without destroying the exposure`. |
| 9 (T) | Channel close drains accepted sends and answers. Exposure disposer drains received requests and closes `instanceByFullName` storage instances: `packages/rxdb-storage-worklet/src/index.ts:124,185`. Owner shutdown sequence documented at README:12. | `drains a queued send and its answer before closing the channel`; `disposal closes actual exposed instances after pending requests finish` asserts the underlying instance's closed state. |
| 10 (T) | Private Blob bytes, copied output buffers/Blob parts, ASCII MIME normalization: `packages/worklet-opfs/src/index.ts:221`. | `keeps Blob bytes immutable, copies Blob parts and normalizes MIME`. |
| 11 (T) | Fatal UTF-8 rejects byte-changing decode, default strips BOM, explicit ignoreBOM supported, unsupported encoding/streaming rejected: `packages/worklet-opfs/src/index.ts:271`. | `honors UTF-8 fatal and BOM semantics and rejects unsupported options`. |
| 12 (T) | Add missing digest without replacing crypto/subtle objects or members: `packages/worklet-opfs/src/index.ts:301`. | `adds digest without replacing existing crypto or subtle members`. |
| 13 (T) | Both conformance backends use public get/expose and shared fake schedulers: `conformance/storage-entry.ts:37`, `conformance/run.mjs:48`. Native example uses public exposure: `example/src/storage-runtime.ts:61`. | `round trips all binary byte values without fetch` in `conformance/binary-attachments.ts:6` covers 32 KiB of arbitrary bytes; channel unit tests assert string-only messages. Native example typechecked; device verification deferred. |
| 14 | Initial opening failure becomes a failure result, and ALL PASS requires exactly eight successes: `example/src/conformance-smoke.ts:78`, `example/App.tsx:89`, `example/.maestro/conformance-smoke.yaml:13`. | Example typecheck and source inspection. Native smoke execution deferred as requested. |
| 15 | Secret-free unit job checks only public packages; premium-dependent checks consistently gated and premium installed before full typecheck: `.github/workflows/ci.yml:20,26,41`. | Node YAML assertion probe; hosted CI unverified. |
| 16 | Explicit pod installation after prebuild/cache restore; Android emulator x86_64: `.github/workflows/ci.yml:88,149`. | Node YAML assertion probe; native jobs unexecuted. |
| 17 | Build-before-pack and package-local copies of MIT LICENSE: `packages/react-native-worklet-fs/package.json:40,46`, `packages/worklet-opfs/package.json:21,27`, `packages/rxdb-storage-worklet/package.json:21,27`. | Each package's `npm pack --dry-run --json --ignore-scripts=false` rebuilt absent lib and included license/exports. Cache/output scratch stayed in temporary storage and was removed. Script execution was enabled only for these known package prepack hooks; no dependency installation. |
| 18 | RxDB peer `^17.4.0`, existing development pin retained, runtime dependency removed: `packages/rxdb-storage-worklet/package.json:34,42`; corresponding importer changed in `pnpm-lock.yaml:111`. | Node manifest assertions; unit/conformance run against installed RxDB. Broader peer-range compatibility and fresh install unverified. |

**Observed red/green evidence:** targeted regressions failed before their fixes and passed after. The original backend was also rerun against the missing-trailing-argument test (it silently truncated instead of throwing); the original harness failed the added binary conformance test because memory bypassed the remote channel. Native C++ was not executed. These results do not establish broad old/new equivalence or performance.

## Item 4 — reproducible loader probe

Run from the repository root. The Community CLI branch uses its [actual dependency loader entry point](https://github.com/react-native-community/cli/blob/main/packages/cli-config/src/readConfigFromDisk.ts), not a substitute evaluator.

```sh
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const app = createRequire(path.resolve('example/package.json'));
const expo = createRequire(app.resolve('expo/package.json'));
const root = path.resolve('packages/react-native-worklet-fs');
const config = (await import(path.join(root, 'react-native.config.js'))).default;
const expoRoot = path.dirname(expo.resolve('expo-modules-autolinking/package.json'));
const { loadConfigAsync } = expo(path.join(expoRoot, 'build/reactNativeConfig/config.js'));
assert.deepEqual((await loadConfigAsync(root)).dependency.platforms.android, config.dependency.platforms.android);
console.log('PASS ESM import and Expo loader');
try {
  const cliRoot = path.dirname(app.resolve('@react-native-community/cli-config/package.json'));
  const { readDependencyConfigFromDiskAsync } = app(path.join(cliRoot, 'build/readConfigFromDisk.js'));
  const loaded = await readDependencyConfigFromDiskAsync(root, 'react-native-worklet-fs');
  assert.deepEqual(loaded.dependency.platforms.android, config.dependency.platforms.android);
  console.log('PASS Community CLI loader');
} catch (error) {
  console.error('BLOCKED/FAIL Community CLI loader:', error.code ?? error.message);
  process.exitCode = 1;
}
JS
```

**Observed output:** `PASS ESM import and Expo loader`, then `BLOCKED/FAIL Community CLI loader: MODULE_NOT_FOUND` (exit 1). The CLI package was unavailable locally; `npm view @react-native-community/cli-config version` failed with `ENOTFOUND registry.npmjs.org`. Therefore the required Community CLI execution proof is **not closed**. Install/provision that loader in an environment with permitted registry access and rerun the probe. No loader compatibility claim is made from the Expo result alone.

## Behavior changes / regressions

- Invalid native/Node calls now reject predictably; incomplete writes no longer report success. C++ behavior remains unverified until the next task compiles/runs it.
- Channel names derive from identifier unless explicit; independently exposed endpoints need distinct matching names. Channel close drains requests, throws on new sends, and does not dispose the worker exposure. Exposure owners must drain senders before disposal.
- Worker attachments no longer require fetch. RN's existing native reply decoding is retained where ArrayBuffer Blob parts are unavailable; device behavior remains unverified.
- Blob buffers are immutable copies; decoding/crypto installation now follows the corrected contracts above.
- The example now uses the public transport and retains initialized exposures. No benchmark workload, result, attribution, or performance claims were changed or evaluated.
- Crash/power-loss durability is still not guaranteed. No retries, cross-runtime locks, or durability subsystem were added.
- No known remaining Node regression was observed in the exercised tests. Broad compatibility, fresh-install behavior, native builds/devices, and hosted CI were not established.
