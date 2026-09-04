import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Subject } from 'rxjs';
import { getRxStorageMemory } from '../../plugins/storage-memory/index.mjs';
import { exposeRxStorageRemote, getRxStorageRemote } from '../../plugins/storage-remote/index.mjs';
import { getRxStorageAbstractFilesystem } from 'rxdb-premium/plugins/storage-abstract-filesystem';
import { createNodeWorkletFs } from '../../../../packages/react-native-worklet-fs/lib/node.js';
import {
  createAbstractFilesystemAdapter,
  createPromiseQueueLock,
  createWorkletOpfs,
} from '../../../../packages/worklet-opfs/lib/index.js';

const tempDirectory = mkdtempSync(path.join(tmpdir(), 'rxdb-worklet-conformance-'));
const fs = createNodeWorkletFs(tempDirectory);
const rootDirectory = path.join(tempDirectory, 'opfs');
const lock = createPromiseQueueLock();
let channelId = 0;

function getFilesystemStorage() {
  return getRxStorageAbstractFilesystem({
    name: 'worklet-opfs',
    abstractFilesystem: createAbstractFilesystemAdapter(createWorkletOpfs({ fs, rootDirectory })),
    abstractLock: lock,
    inWorker: true,
    settings: {
      decoder: {
        decode(data) {
          return fs.utf8Decode(data.buffer as ArrayBuffer, data.byteOffset, data.byteOffset + data.byteLength);
        },
      },
    },
  });
}

function throughRemoteChannel() {
  const requests = new Subject<any>();
  const responses = new Subject<any>();
  exposeRxStorageRemote({
    storage: getFilesystemStorage(),
    messages$: requests,
    send: (message) => responses.next(message),
  });
  return getRxStorageRemote({
    identifier: `worklet-opfs-conformance-${channelId++}`,
    mode: 'storage',
    messageChannelCreator: async () => ({
      messages$: responses,
      send: (message) => requests.next(message),
      async close() {
        requests.complete();
        responses.complete();
      },
    }),
  });
}

const storage = () => process.env.WORKLET_STORAGE_BACKEND === 'memory'
  ? getRxStorageMemory()
  // inWorker deliberately returns serialized payloads; the public storage receives them via storage-remote.
  : throughRemoteChannel();

export const WORKLET_STORAGE = {
  name: 'worklet-opfs',
  getStorage: storage,
  getPerformanceStorage: () => ({ description: 'worklet-opfs', storage: storage() }),
  hasPersistence: true,
  // The queue lock coordinates this runtime only; there is no cross-runtime lock or broadcast channel.
  hasMultiInstance: false,
  hasAttachments: true,
  hasReplication: true,
};
