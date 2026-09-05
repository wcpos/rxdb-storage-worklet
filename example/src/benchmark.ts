import { Platform } from 'react-native';
import { opfs } from 'expo-opfs';
import {
  createRxDatabase,
  type RxCollection,
  type RxJsonSchema,
  type RxStorage,
} from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { getRxStorageAbstractFilesystem } from 'rxdb-premium/plugins/storage-abstract-filesystem';
import {
  createAbstractFilesystemAdapter,
  createPromiseQueueLock,
} from 'worklet-opfs';
import {
  createWorkletStorage,
  getRnSendMs,
  resetRnSendMs,
} from './storage-runtime';

export type StandardMode =
  | 'js-filesystem'
  | 'js-memory'
  | 'worklet-filesystem'
  | 'worklet-memory';

export type SustainedMode =
  | 'sustained-js-filesystem'
  | 'sustained-worklet-filesystem';

export type Mode = StandardMode | SustainedMode;

export const MODE_LABELS: Record<Mode, string> = {
  'js-filesystem': 'JS thread / filesystem (expo-opfs)',
  'js-memory': 'JS thread / memory',
  'worklet-filesystem': 'worklet / filesystem',
  'worklet-memory': 'worklet / memory',
  'sustained-js-filesystem': 'sustained · JS thread / filesystem',
  'sustained-worklet-filesystem': 'sustained · worklet / filesystem',
};

type Product = {
  id: string;
  name: string;
  sku: string;
  price: number;
  date_modified: string;
  description: string;
  categories: { id: string; name: string }[];
  meta_data: { key: string; value: string }[];
};

export type Steps = {
  bulkInsert500Ms: number;
  tenQueriesMs: number;
  findByIds200Ms: number;
  reactiveInsert200Ms: number;
};

type StandardBenchmarkResult = {
  platform: string;
  mode: StandardMode;
  sample: number;
  steps: Steps;
  rnSendMs: number;
  lag: {
    totalBlockedMs: number;
    maxLagMs: number;
    ticksOver50Ms: number;
    series: number[];
  };
  persistence: { expected: 50; actual: number; pass: boolean };
};

type SustainedBenchmarkResult = {
  platform: string;
  mode: SustainedMode;
  sample: number;
  iterations: number;
  documentsWritten: number;
  lag: {
    p50LagMs: number;
    p95LagMs: number;
    maxLagMs: number;
    ticksOver16Ms: number;
    ticksOver50Ms: number;
    series: number[];
  };
};

export type BenchmarkResult = StandardBenchmarkResult | SustainedBenchmarkResult;

export type BenchmarkMedian =
  | (Omit<StandardBenchmarkResult, 'sample'> & { medianSample: number })
  | (Omit<SustainedBenchmarkResult, 'sample'> & { medianSample: number });

const schema: RxJsonSchema<Product> = {
  title: 'product',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    name: { type: 'string', maxLength: 100 },
    sku: { type: 'string' },
    price: { type: 'number' },
    date_modified: { type: 'string', maxLength: 30 },
    description: { type: 'string' },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    },
    meta_data: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value'],
      },
    },
  },
  required: [
    'id',
    'name',
    'sku',
    'price',
    'date_modified',
    'description',
    'categories',
    'meta_data',
  ],
  indexes: [['name'], ['date_modified']],
};

const description =
  'A deliberately verbose product description used to create realistic data. '.repeat(48);

function makeProduct(index: number): Product {
  return {
    id: `product-${index}`,
    name: `Product ${String(index).padStart(4, '0')}`,
    sku: `SKU-${String(index).padStart(6, '0')}`,
    price: index + 0.99,
    date_modified: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    description,
    categories: Array.from({ length: 5 }, (_, id) => ({
      id: String(id),
      name: `Category ${id}`,
    })),
    meta_data: Array.from({ length: 20 }, (_, key) => ({
      key: `attribute-${key}`,
      value: `Value ${index}-${key} `.repeat(4),
    })),
  };
}

async function checkedBulkInsert(
  collection: RxCollection<Product>,
  documents: Product[],
): Promise<void> {
  const response = await collection.bulkInsert(documents);
  if (response.error.length) {
    throw new Error(`bulkInsert errors: ${JSON.stringify(response.error)}`);
  }
}

function jsFilesystemStorage() {
  return getRxStorageAbstractFilesystem({
    name: 'expo-opfs',
    abstractFilesystem: createAbstractFilesystemAdapter(opfs as never),
    abstractLock: createPromiseQueueLock(),
    settings: { decoder: { decode: (data) => new TextDecoder().decode(data) } },
  });
}

async function storageFor(mode: Mode): Promise<RxStorage<any, any>> {
  if (mode === 'js-filesystem' || mode === 'sustained-js-filesystem') {
    return jsFilesystemStorage();
  }
  if (mode === 'js-memory') return getRxStorageMemory();
  return createWorkletStorage(
    mode === 'sustained-worklet-filesystem' ? 'worklet-filesystem' : mode,
  );
}

async function database(
  name: string,
  mode: Mode,
) {
  const db = await createRxDatabase({
    name,
    multiInstance: false,
    storage: await storageFor(mode),
  });
  const collections = await db.addCollections({ products: { schema } });
  return { db, collection: collections.products as RxCollection<Product> };
}

function lagSampler(intervalMs = 50, recordEveryTick = false) {
  const series: number[] = [];
  let expected = performance.now() + intervalMs;
  const record = (actual: number) => {
    do {
      series.push(Math.max(0, actual - expected));
      expected += intervalMs;
    } while (recordEveryTick && actual >= expected);
    if (!recordEveryTick) expected = actual + intervalMs;
  };
  const timer = setInterval(() => record(performance.now()), intervalMs);
  return () => {
    clearInterval(timer);
    if (performance.now() >= expected) {
      record(performance.now());
    }
    return {
      totalBlockedMs: series.reduce((sum, lag) => sum + lag, 0),
      maxLagMs: Math.max(0, ...series),
      ticksOver50Ms: series.filter((lag) => lag > 50).length,
      series,
    };
  };
}

async function persistenceCheck(mode: Mode, name: string): Promise<number> {
  const first = await database(name, mode);
  await checkedBulkInsert(
    first.collection,
    Array.from({ length: 50 }, (_, index) => makeProduct(index)),
  );
  await first.db.close();

  const reopened = await database(name, mode);
  try {
    return await reopened.collection.count().exec();
  } finally {
    await reopened.db.close();
  }
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

async function runSustainedSample(
  mode: SustainedMode,
  sample: number,
): Promise<SustainedBenchmarkResult> {
  resetRnSendMs();
  const suffix = `${Date.now()}-${sample}`;
  const { db, collection } = await database(`bench-${mode}-${suffix}`, mode);
  const stopLagSampler = lagSampler(16, true);
  const ids: string[] = [];
  let iterations = 0;
  let nextDocument = 0;
  let sampled: ReturnType<ReturnType<typeof lagSampler>>;

  try {
    const started = performance.now();
    while (performance.now() - started < 4_000) {
      const documents = Array.from({ length: 50 }, () => makeProduct(nextDocument++));
      await checkedBulkInsert(collection, documents);
      ids.push(...documents.map(({ id }) => id));
      await collection
        .find({ selector: {}, sort: [{ name: 'asc' }], limit: 50 })
        .exec();
      await collection.findByIds(
        Array.from({ length: 50 }, () => ids[Math.floor(Math.random() * ids.length)]),
      );
      iterations += 1;
    }
    sampled = stopLagSampler();
  } catch (error) {
    stopLagSampler();
    throw error;
  } finally {
    await db.close();
  }

  const result: SustainedBenchmarkResult = {
    platform: Platform.OS,
    mode,
    sample,
    iterations,
    documentsWritten: iterations * 50,
    lag: {
      p50LagMs: percentile(sampled.series, 0.5),
      p95LagMs: percentile(sampled.series, 0.95),
      maxLagMs: sampled.maxLagMs,
      ticksOver16Ms: sampled.series.filter((lag) => lag > 16).length,
      ticksOver50Ms: sampled.ticksOver50Ms,
      series: sampled.series,
    },
  };
  console.log(`BENCH_RESULT ${JSON.stringify(result)}`);
  return result;
}

export async function runBenchmarkSample(
  mode: Mode,
  sample: number,
): Promise<BenchmarkResult> {
  if (mode === 'sustained-js-filesystem' || mode === 'sustained-worklet-filesystem') {
    return runSustainedSample(mode, sample);
  }
  resetRnSendMs();
  const stopLagSampler = lagSampler();
  const suffix = `${Date.now()}-${sample}`;
  const documents = Array.from({ length: 700 }, (_, index) => makeProduct(index));
  let steps: Steps;
  let persistenceActual: number;

  try {
    const { db, collection } = await database(`bench-${mode}-${suffix}`, mode);
    try {
      let started = performance.now();
      for (let batch = 0; batch < 5; batch += 1) {
        await checkedBulkInsert(
          collection,
          documents.slice(batch * 100, batch * 100 + 100),
        );
      }
      const bulkInsert500Ms = performance.now() - started;

      started = performance.now();
      for (let query = 0; query < 10; query += 1) {
        await collection
          .find({ selector: {}, sort: [{ name: 'asc' }], limit: 50 })
          .exec();
      }
      const tenQueriesMs = performance.now() - started;

      started = performance.now();
      await collection.findByIds(documents.slice(0, 200).map(({ id }) => id));
      const findByIds200Ms = performance.now() - started;

      const reactiveQuery = collection.find({
        selector: {},
        sort: [{ name: 'desc' }],
        limit: 50,
      });
      let emissions = 0;
      let initialResolve!: () => void;
      let changedResolve!: () => void;
      const initialEmission = new Promise<void>((resolve) => {
        initialResolve = resolve;
      });
      const changedEmission = new Promise<void>((resolve) => {
        changedResolve = resolve;
      });
      const subscription = reactiveQuery.$.subscribe(() => {
        emissions += 1;
        if (emissions === 1) initialResolve();
        if (emissions === 2) changedResolve();
      });
      await initialEmission;
      started = performance.now();
      await Promise.all([
        checkedBulkInsert(collection, documents.slice(500, 700)),
        changedEmission,
      ]);
      const reactiveInsert200Ms = performance.now() - started;
      subscription.unsubscribe();
      steps = {
        bulkInsert500Ms,
        tenQueriesMs,
        findByIds200Ms,
        reactiveInsert200Ms,
      };
    } finally {
      await db.close();
    }
    persistenceActual = await persistenceCheck(mode, `persist-${mode}-${suffix}`);
  } catch (error) {
    stopLagSampler();
    throw error;
  }

  const result: BenchmarkResult = {
    platform: Platform.OS,
    mode,
    sample,
    steps,
    rnSendMs: mode.startsWith('worklet') ? getRnSendMs() : 0,
    lag: stopLagSampler(),
    persistence: {
      expected: 50,
      actual: persistenceActual,
      pass: persistenceActual === 50,
    },
  };
  console.log(`BENCH_RESULT ${JSON.stringify(result)}`);
  return result;
}

function median(values: number[]): number {
  return [...values].sort((left, right) => left - right)[1];
}

function elapsed(result: StandardBenchmarkResult): number {
  return Object.values(result.steps).reduce((sum, value) => sum + value, 0);
}

export function medianResult(samples: BenchmarkResult[]): BenchmarkMedian {
  if (samples[0]?.mode.startsWith('sustained-')) {
    const sustained = samples as SustainedBenchmarkResult[];
    const medianSample = [...sustained].sort(
      (left, right) => left.lag.p95LagMs - right.lag.p95LagMs,
    )[1];
    return {
      platform: medianSample.platform,
      mode: medianSample.mode,
      medianSample: medianSample.sample,
      iterations: median(sustained.map(({ iterations }) => iterations)),
      documentsWritten: median(
        sustained.map(({ documentsWritten }) => documentsWritten),
      ),
      lag: {
        p50LagMs: median(sustained.map(({ lag }) => lag.p50LagMs)),
        p95LagMs: median(sustained.map(({ lag }) => lag.p95LagMs)),
        maxLagMs: median(sustained.map(({ lag }) => lag.maxLagMs)),
        ticksOver16Ms: median(sustained.map(({ lag }) => lag.ticksOver16Ms)),
        ticksOver50Ms: median(sustained.map(({ lag }) => lag.ticksOver50Ms)),
        series: medianSample.lag.series,
      },
    };
  }
  const standard = samples as StandardBenchmarkResult[];
  const medianSample = [...standard].sort((left, right) => elapsed(left) - elapsed(right))[1];
  return {
    platform: medianSample.platform,
    mode: medianSample.mode,
    medianSample: medianSample.sample,
    steps: {
      bulkInsert500Ms: median(standard.map(({ steps }) => steps.bulkInsert500Ms)),
      tenQueriesMs: median(standard.map(({ steps }) => steps.tenQueriesMs)),
      findByIds200Ms: median(standard.map(({ steps }) => steps.findByIds200Ms)),
      reactiveInsert200Ms: median(standard.map(({ steps }) => steps.reactiveInsert200Ms)),
    },
    rnSendMs: median(standard.map(({ rnSendMs }) => rnSendMs)),
    lag: {
      totalBlockedMs: median(standard.map(({ lag }) => lag.totalBlockedMs)),
      maxLagMs: median(standard.map(({ lag }) => lag.maxLagMs)),
      ticksOver50Ms: median(standard.map(({ lag }) => lag.ticksOver50Ms)),
      series: medianSample.lag.series,
    },
    persistence: {
      expected: 50,
      actual: median(standard.map(({ persistence }) => persistence.actual)),
      pass: standard.every(({ persistence }) => persistence.pass),
    },
  };
}
