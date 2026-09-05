import { expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ queries: [] as number[], ids: 0 }));
vi.mock('../example/node_modules/react-native', () => ({ Platform: { OS: 'test' } }));
vi.mock('../example/node_modules/expo-opfs', () => ({ opfs: {} }));
vi.mock('../example/src/storage-runtime', () => ({
  createWorkletStorage: () => ({}), resetRnSendMs() {}, getRnSendMs: () => 0,
  resetRnTimings() {}, getRnTimings: () => ({ rnSerializeMs: 0, rnDispatchMs: 0, roundTripMs: 0, rnRequests: [] }),
}));
vi.mock('../example/node_modules/rxdb', () => ({ createRxDatabase: async () => ({
  close: async () => {},
  addCollections: async () => ({ products: {
    bulkInsert: async () => ({ error: [] }),
    find: (query: any) => ({
      exec: async () => { calls.queries.push(query.skip); return []; },
      $: { subscribe: (callback: () => void) => {
        callback(); callback(); return { unsubscribe() {} };
      } },
    }),
    findByIds: () => ({ exec: async () => { calls.ids++; return new Map(); } }),
    count: () => ({ exec: async () => 50 }),
  } }),
}) }));
import { runBenchmarkSample } from '../example/src/benchmark';
it('executes ten distinct storage query shapes and the ID query, retaining every phase', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const result = await runBenchmarkSample('js-memory', 1);
  expect(calls.ids).toBe(1);
  expect(new Set(calls.queries).size).toBe(10);
  expect(Object.keys(result.phases)).toEqual(['setup', 'inserts', 'queries', 'findByIds', 'reactive', 'close', 'persistence']);
  vi.restoreAllMocks();
});
it('executes distinct sorted queries and ID lookups throughout the sustained loop', async () => {
  calls.queries = []; calls.ids = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now += 100);
  const result = await runBenchmarkSample('sustained-worklet-filesystem', 1);
  expect('iterations' in result && result.iterations).toBeGreaterThan(1);
  expect(calls.ids).toBe(calls.queries.length);
  expect(new Set(calls.queries).size).toBe(calls.queries.length);
  expect(result.phases.inserts).toHaveLength(calls.ids);
  vi.restoreAllMocks();
});
