# rxdb-storage-worklet

Run RxDB's filesystem storage engine on a `react-native-worklets` Worker Runtime so the React Native JavaScript thread never executes storage work.

**Status: pre-release**

| Package | Purpose |
| --- | --- |
| `react-native-worklet-fs` | Native synchronous filesystem primitives and a Node.js test implementation |
| `worklet-opfs` | OPFS-compatible handles and RxDB abstract-filesystem adapters |
| `rxdb-storage-worklet` | JSON-only RxDB remote-storage messaging across a Worker Runtime |

## Native filesystem setup

Call `installWorkletFs()` to install `globalThis.__workletFs` into the React
Native runtime, or pass a `WorkletRuntime` to install it there under that
runtime's lock.

On iOS, `documentDirectory()` returns the app document directory. On Android it
intentionally returns an empty string: callers must pass `rootDirectory` to
`createWorkletOpfs`, using a native path such as `expo-file-system`'s
`Paths.document` (with the `file://` prefix removed) or
`react-native-fs`'s `DocumentDirectoryPath`.

See [`example/`](example/) for the Expo 57 benchmark and clean-clone steps.
