import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ attempts: 0, scheduleOnRuntime: vi.fn() }));

vi.mock('../example/node_modules/expo-file-system', () => ({ Paths: { document: { uri: 'file:///tmp/documents/' } } }));
vi.mock('../example/node_modules/react-native', () => ({}));
vi.mock('../example/node_modules/react-native-worklets', () => ({
  createWorkletRuntime: ({ name }: { name: string }) => ({ name }),
  scheduleOnRN: vi.fn(),
  scheduleOnRuntime: mocks.scheduleOnRuntime,
}));
vi.mock('../example/node_modules/rxdb/plugins/storage-memory', () => ({ getRxStorageMemory: vi.fn() }));
vi.mock('rxdb-premium/plugins/storage-abstract-filesystem', () => ({ getRxStorageAbstractFilesystem: vi.fn() }));
vi.mock('../example/node_modules/rxdb-premium/plugins/storage-abstract-filesystem', () => ({ getRxStorageAbstractFilesystem: vi.fn() }));
vi.mock('../example/node_modules/@wcpos/rxdb-storage-worklet', () => ({
  exposeWorkletRxStorage: vi.fn(),
  getRxStorageWorklet: ({ runtime }: { runtime: unknown }) => ({ runtime }),
  receiveWorkletMessage: vi.fn(),
}));
vi.mock('../example/node_modules/@wcpos/react-native-worklet-fs', () => ({ getWorkletFs: vi.fn(), installWorkletFs: vi.fn() }));
vi.mock('../example/node_modules/@wcpos/worklet-opfs', () => ({
  createAbstractFilesystemAdapter: vi.fn(),
  createPromiseQueueLock: vi.fn(),
  createWorkletOpfs: vi.fn(),
  installWorkletRuntimePolyfills: vi.fn(),
}));

import { createWorkletStorage } from '../example/src/storage-runtime';

it('retries worklet exposure after an initialization rejection', async () => {
  mocks.scheduleOnRuntime.mockImplementation((runtime, task, mode, root, ready) => {
    void runtime; void task; void mode; void root;
    mocks.attempts += 1;
    ready(mocks.attempts === 1 ? 'startup failed' : undefined);
  });

  await expect(createWorkletStorage('worklet-memory')).rejects.toThrow('startup failed');
  await expect(createWorkletStorage('worklet-memory')).resolves.toMatchObject({
    runtime: { name: 'rxdb-memory' },
  });
  expect(mocks.scheduleOnRuntime).toHaveBeenCalledTimes(2);
});
