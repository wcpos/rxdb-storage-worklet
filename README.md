# rxdb-storage-worklet

Run RxDB's filesystem storage engine on a `react-native-worklets` Worker Runtime so the React Native JavaScript thread never executes storage work.

**Status: pre-release**

| Package | Purpose |
| --- | --- |
| `react-native-worklet-fs` | Native host-object types and a Node.js test implementation |
| `worklet-opfs` | OPFS-compatible handles and RxDB abstract-filesystem adapters |
| `rxdb-storage-worklet` | JSON-only RxDB remote-storage messaging across a Worker Runtime |

The committed `.spike-reference/` directory is the spike input and will be deleted once the native package lands.
