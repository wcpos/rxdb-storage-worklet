import {
  createWorkletRuntime,
  scheduleOnRN,
  scheduleOnRuntime,
} from 'react-native-worklets';
import { Subject } from 'rxjs';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { getRxStorageAbstractFilesystem } from 'rxdb-premium/plugins/storage-abstract-filesystem';
import {
  exposeRxStorageRemote,
  getRxStorageRemote,
} from 'rxdb/plugins/storage-remote';
import { installWorkletFs } from '../modules/worklet-fs/src';
import { installWorkletPolyfills, WorkletFilesystem } from './worklet-opfs';

declare global {
  var __rxdbReceive: (message: any) => void;
  var __rxdbReceiveString: (message: string) => void;
  var __rxdbReceiveFilesystemString: (message: string) => void;
}

const rnSubject = new Subject<any>();
const rnStringSubject = new Subject<any>();
const rnFilesystemStringSubject = new Subject<any>();
const CHANNEL_ENCODING: 'object' | 'string' = 'object';
const rnSendMs = { object: 0, string: 0, filesystem: 0 };

function onStorageMessage(message: any) {
  rnSubject.next(message);
}

function onStorageMessageString(message: string) {
  rnStringSubject.next(JSON.parse(message));
}
function onFilesystemMessageString(message: string) { rnFilesystemStringSubject.next(JSON.parse(message)); }
function logWorkletFs(polyfills: string) { console.log(`WORKLET_FS_READY polyfills=${polyfills || 'none'}`); }

export const storageRuntime = createWorkletRuntime({ name: 'rxdb-storage' });
installWorkletFs(storageRuntime);

function startStorage() {
  'worklet';
  const needed = installWorkletPolyfills();
  const fs = globalThis.__workletFs;
  const smokePath = fs.documentDirectory() + '/.worklet-fs-smoke';
  const smokeFd = fs.open(smokePath, 'create'); fs.truncate(smokeFd, 0);
  const encoded = fs.utf8Encode('worklet-fs'); fs.writeAt(smokeFd, encoded, 0); const decoded = new ArrayBuffer(encoded.byteLength);
  fs.readAt(smokeFd, decoded, 0, decoded.byteLength); fs.truncate(smokeFd, 4);
  if (fs.utf8Decode(decoded, 0, decoded.byteLength) !== 'worklet-fs' || fs.size(smokeFd) !== 4) throw new Error('worklet-fs primitive round trip failed');
  fs.close(smokeFd); fs.remove(smokePath, false); scheduleOnRN(logWorkletFs, needed.join(','));
  const messages$ = new Subject<any>();
  const stringMessages$ = new Subject<any>();
  const filesystemMessages$ = new Subject<any>();
  globalThis.__rxdbReceive = (message) => messages$.next(message);
  globalThis.__rxdbReceiveString = (message) =>
    stringMessages$.next(JSON.parse(message));
  globalThis.__rxdbReceiveFilesystemString = (message) =>
    filesystemMessages$.next(JSON.parse(message));
  exposeRxStorageRemote({
    storage: getRxStorageMemory(),
    messages$,
    send: (message) => scheduleOnRN(onStorageMessage, message),
  });
  exposeRxStorageRemote({
    storage: getRxStorageMemory(),
    messages$: stringMessages$,
    send: (message) =>
      scheduleOnRN(onStorageMessageString, JSON.stringify(message)),
  });
  const queues = new Map<string, Promise<any>>();
  exposeRxStorageRemote({
    storage: getRxStorageAbstractFilesystem({ name: 'worklet-fs', abstractFilesystem: new WorkletFilesystem(false), abstractLock: { request(id, task) { const next = (queues.get(id) ?? Promise.resolve()).then(task); queues.set(id, next); return next; } }, inWorker: true, settings: { decoder: { decode: (data) => new TextDecoder().decode(data) } } }),
    messages$: filesystemMessages$,
    send: (message) => scheduleOnRN(onFilesystemMessageString, JSON.stringify(message)),
  });
}

scheduleOnRuntime(storageRuntime, startStorage);

function createWorkletMemoryStorage(encoding: 'object' | 'string') {
  return getRxStorageRemote({
    identifier: `worklet-${encoding}`,
    mode: 'storage',
    messageChannelCreator: async () => ({
      messages$: encoding === 'string' ? rnStringSubject : rnSubject,
      send: (message) => {
        const started = performance.now();
        if (encoding === 'string') {
          scheduleOnRuntime(
            storageRuntime,
            (nextMessage) => globalThis.__rxdbReceiveString(nextMessage),
            JSON.stringify(message),
          );
        } else {
          scheduleOnRuntime(
            storageRuntime,
            (nextMessage) => globalThis.__rxdbReceive(nextMessage),
            message,
          );
        }
        rnSendMs[encoding] += performance.now() - started;
      },
      close: async () => {},
    }),
  });
}

export function resetRnSendMs(encoding: 'object' | 'string' | 'filesystem') {
  rnSendMs[encoding] = 0;
}

export function getRnSendMs(encoding: 'object' | 'string' | 'filesystem') {
  return rnSendMs[encoding];
}

function createWorkletFilesystemStorage() {
  return getRxStorageRemote({ identifier: 'worklet-filesystem-string', mode: 'storage', messageChannelCreator: async () => ({
    messages$: rnFilesystemStringSubject,
    send: (message) => { const started = performance.now(); scheduleOnRuntime(storageRuntime, (next) => globalThis.__rxdbReceiveFilesystemString(next), JSON.stringify(message)); rnSendMs.filesystem += performance.now() - started; },
    close: async () => {},
  }) });
}

export const workletMemoryStorage = createWorkletMemoryStorage(CHANNEL_ENCODING);
export const workletMemoryStringStorage = createWorkletMemoryStorage('string');
export const workletFilesystemStorage = createWorkletFilesystemStorage();
