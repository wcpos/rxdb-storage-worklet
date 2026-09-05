import { Paths } from 'expo-file-system';
import {
  createWorkletRuntime,
  scheduleOnRN,
  scheduleOnRuntime,
  type WorkletRuntime,
} from 'react-native-worklets';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { getRxStorageAbstractFilesystem } from 'rxdb-premium/plugins/storage-abstract-filesystem';
import { exposeWorkletRxStorage, getRxStorageWorklet } from 'rxdb-storage-worklet';
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
  ready: (error?: string) => void,
): void {
  'worklet';
  try {
    installWorkletRuntimePolyfills({ fs: getWorkletFs() });
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
    void exposeWorkletRxStorage({
      storage,
      receiveGlobalName: `__rxdbReceiveString_${mode}`,
      scheduleOnRN,
    }).then(() => scheduleOnRN(ready), (error) => scheduleOnRN(ready, String(error)));
  } catch (error) { scheduleOnRN(ready, String(error)); }
}

// Reuse the runtime exposure across storage close/reopen cycles.
const initialized: Partial<Record<WorkletMode, Promise<WorkletRuntime>>> = {};
function prepareRuntime(mode: WorkletMode): Promise<WorkletRuntime> {
  return initialized[mode] ??= new Promise<WorkletRuntime>((resolve, reject) => {
    const runtime = runtimes[mode];
    const rootDirectory = `${Paths.document.uri.replace(/^file:\/\//, '').replace(/\/$/, '')}/.worklet-opfs`;
    scheduleOnRuntime(runtime, exposeStorage, mode, rootDirectory, (error?: string) => {
      if (error) reject(new Error(error)); else resolve(runtime);
    });
  });
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
    identifier: mode,
    receiveGlobalName: `__rxdbReceiveString_${mode}`,
    scheduleOnRuntime: measuredScheduleOnRuntime,
    scheduleOnRN,
  });
}
