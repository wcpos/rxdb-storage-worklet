import { afterEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ queries: [] as number[], ids: 0 }));
vi.mock('../example/node_modules/react-native', () => ({ Platform: { OS: 'test' } }));
vi.mock('../example/node_modules/expo-opfs', () => ({ opfs: {} }));
// These workload tests never create a premium filesystem storage.
vi.mock('rxdb-premium/plugins/storage-abstract-filesystem', () => ({
  getRxStorageAbstractFilesystem: () => { throw new Error('Unexpected premium storage use'); },
}));
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
import { medianResult, runBenchmarkSample } from '../example/src/benchmark';
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

afterEach(() => vi.restoreAllMocks());
it.each([['js-memory'], ['sustained-worklet-filesystem']] as const)('selects upper-middle medians for any sample count in %s', async (mode) => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now += 100);
  const base = await runBenchmarkSample(mode, 1);
  for (const [values, expected] of [[[7], 7], [[9, 1], 9], [[9, 1, 5], 5], [[9, 1, 7, 3], 7], [[9, 1, 7, 3, 5], 5]] as const) {
    const samples = values.map(value => 'steps' in base
      ? { ...base, sample: value, rnSerializeMs: value, steps: { bulkInsert500Ms: value, tenQueriesMs: value, findByIds200Ms: value, reactiveInsert200Ms: value } }
      : { ...base, sample: value, iterations: value, lag: { ...base.lag, p95LagMs: value } });
    const result = medianResult(samples);
    expect(result.medianSample).toBe(expected);
    if ('steps' in result) {
      expect(result.steps.bulkInsert500Ms).toBe(expected);
      expect(result.rnSerializeMs).toBe(expected);
    } else {
      expect(result.iterations).toBe(expected);
      expect(result.lag.p95LagMs).toBe(expected);
    }
  }
});
it('rejects an empty median result explicitly', () => {
  expect(() => medianResult([])).toThrow('Cannot calculate median without samples');
});
