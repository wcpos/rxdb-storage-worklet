import { Paths } from 'expo-file-system';
import {
  createWorkletRuntime,
  scheduleOnRN,
  scheduleOnRuntime,
  type WorkletRuntime,
} from 'react-native-worklets';
import { Subject } from 'rxjs';
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
    messages$.next(JSON.parse(message));
  };
  exposeRxStorageRemote({
    storage,
    messages$,
    send: (message) => scheduleOnRN(deliverFromWorklet, JSON.stringify(message)),
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
