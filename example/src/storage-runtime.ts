import { Paths } from 'expo-file-system';
import {
  createWorkletRuntime,
  scheduleOnRN,
  scheduleOnRuntime,
  type WorkletRuntime,
} from 'react-native-worklets';
import { Subject } from 'rxjs';
import { base64ToArrayBuffer, blobToBase64String } from 'rxdb/plugins/core';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { getRxStorageAbstractFilesystem } from 'rxdb-premium/plugins/storage-abstract-filesystem';
import { exposeRxStorageRemote } from 'rxdb/plugins/storage-remote';
import { getRxStorageWorklet } from 'rxdb-storage-worklet';
import { getWorkletFs, installWorkletFs } from 'react-native-worklet-fs';
import {
  createAbstractFilesystemAdapter,
  createPromiseQueueLock,
  createWorkletOpfs,
  installWorkletRuntimePolyfills,
} from 'worklet-opfs';

type WorkletMode = 'worklet-filesystem' | 'worklet-memory';

const runtimes: Record<WorkletMode, WorkletRuntime> = {
  'worklet-filesystem': createWorkletRuntime({ name: 'rxdb-filesystem' }),
  'worklet-memory': createWorkletRuntime({ name: 'rxdb-memory' }),
};

for (const runtime of Object.values(runtimes)) installWorkletFs(runtime);

let rnSendMs = 0;

function deliverFromWorklet(message: string): void {
  const receive = (globalThis as Record<string, unknown>).__rxdbReceiveString;
  if (typeof receive === 'function') (receive as (value: string) => void)(message);
}

async function receiveSerialized(message: string): Promise<any> {
  'worklet';
  const parsed = JSON.parse(message);
  if (parsed.method === 'bulkWrite' && Array.isArray(parsed.params?.[0])) {
    for (const row of parsed.params[0]) for (const attachment of Object.values(row.document?._attachments ?? {}) as any[]) {
      if (typeof attachment.data === 'string') attachment.data = new Blob([base64ToArrayBuffer(attachment.data)], { type: attachment.type ?? '' });
    }
  }
  return parsed;
}

async function sendSerialized(message: any): Promise<string> {
  'worklet';
  if (message.method === 'getAttachmentData' && message.return instanceof Blob) {
    message = { ...message, return: await blobToBase64String(message.return) };
  }
  return JSON.stringify(message);
}

function measuredScheduleOnRuntime(
  runtime: unknown,
  task: (...args: any[]) => void,
  ...args: any[]
): void {
  const started = performance.now();
  scheduleOnRuntime(runtime as WorkletRuntime, task, ...args);
  rnSendMs += performance.now() - started;
}

function exposeStorage(
  mode: WorkletMode,
  rootDirectory: string,
  ready: () => void,
): void {
  'worklet';
  if (mode === 'worklet-filesystem') {
    installWorkletRuntimePolyfills({ fs: getWorkletFs() });
  }
  const storage = mode === 'worklet-memory'
    ? getRxStorageMemory()
    : getRxStorageAbstractFilesystem({
        name: 'worklet-filesystem',
        abstractFilesystem: createAbstractFilesystemAdapter(
          createWorkletOpfs({ rootDirectory }),
        ),
        abstractLock: createPromiseQueueLock(),
        inWorker: true,
        settings: {
          decoder: { decode: (data) => new TextDecoder().decode(data) },
        },
      });
  const messages$ = new Subject<any>();
  (globalThis as Record<string, unknown>).__rxdbReceiveString = (message: string) => {
    void receiveSerialized(message).then((parsed) => messages$.next(parsed));
  };
  exposeRxStorageRemote({
    storage,
    messages$,
    send: (message) => void sendSerialized(message).then((serialized) => scheduleOnRN(deliverFromWorklet, serialized)),
  });
  scheduleOnRN(ready);
}

async function prepareRuntime(mode: WorkletMode): Promise<WorkletRuntime> {
  const runtime = runtimes[mode];
  const rootDirectory = `${Paths.document.uri.replace(/^file:\/\//, '').replace(/\/$/, '')}/.worklet-opfs`;
  await new Promise<void>((resolve) => {
    scheduleOnRuntime(runtime, exposeStorage, mode, rootDirectory, resolve);
  });
  return runtime;
}

export function resetRnSendMs(): void {
  rnSendMs = 0;
}

export function getRnSendMs(): number {
  return rnSendMs;
}

export async function createWorkletStorage(mode: WorkletMode) {
  const runtime = await prepareRuntime(mode);
  return getRxStorageWorklet({
    runtime,
    scheduleOnRuntime: measuredScheduleOnRuntime,
    scheduleOnRN,
  });
}
