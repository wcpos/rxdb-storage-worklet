import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getRxStorageMemory } from '../../plugins/storage-memory/index.mjs';
import { exposeWorkletRxStorage, getRxStorageWorklet } from '../../../../example/node_modules/@wcpos/rxdb-storage-worklet/lib/index.js';
import { createFakeSchedulers } from './worklet-fake-schedulers.js';
import { getRxStorageAbstractFilesystem } from 'rxdb-premium/plugins/storage-abstract-filesystem';
import { createNodeWorkletFs } from '../../../../example/node_modules/@wcpos/react-native-worklet-fs/lib/node.js';
import {
  createAbstractFilesystemAdapter,
  createPromiseQueueLock,
  createWorkletOpfs,
} from '../../../../example/node_modules/@wcpos/worklet-opfs/lib/index.js';

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

function storage() {
  const receiveGlobalName = `__rxdbConformance${channelId++}`;
  const fake = createFakeSchedulers(receiveGlobalName, true);
  const backend = process.env.WORKLET_STORAGE_BACKEND === 'memory'
    ? getRxStorageMemory() : getFilesystemStorage();
  void fake.worklet.run(() => exposeWorkletRxStorage({ storage: backend, receiveGlobalName, scheduleOnRN: fake.scheduleOnRN }));
  return getRxStorageWorklet({
    runtime: {},
    identifier: receiveGlobalName,
    receiveGlobalName,
    scheduleOnRuntime: fake.scheduleOnRuntime,
  });
}

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
