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

export type Mode =
  | 'js-filesystem'
  | 'js-memory'
  | 'worklet-filesystem'
  | 'worklet-memory';

export const MODE_LABELS: Record<Mode, string> = {
  'js-filesystem': 'JS thread / filesystem (expo-opfs)',
  'js-memory': 'JS thread / memory',
  'worklet-filesystem': 'worklet / filesystem',
  'worklet-memory': 'worklet / memory',
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

export type BenchmarkResult = {
  platform: string;
  mode: Mode;
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

export type BenchmarkMedian = Omit<BenchmarkResult, 'sample'> & {
  medianSample: number;
};

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
  if (mode === 'js-filesystem') return jsFilesystemStorage();
  if (mode === 'js-memory') return getRxStorageMemory();
  return createWorkletStorage(mode);
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

function lagSampler() {
  const series: number[] = [];
  let expected = performance.now() + 50;
  const timer = setInterval(() => {
    const actual = performance.now();
    series.push(Math.max(0, actual - expected));
    expected = actual + 50;
  }, 50);
  return () => {
    clearInterval(timer);
    const trailingLag = Math.max(0, performance.now() - expected);
    series.push(trailingLag);
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

export async function runBenchmarkSample(
  mode: Mode,
  sample: number,
): Promise<BenchmarkResult> {
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

function elapsed(result: BenchmarkResult): number {
  return Object.values(result.steps).reduce((sum, value) => sum + value, 0);
}

export function medianResult(samples: BenchmarkResult[]): BenchmarkMedian {
  const medianSample = [...samples].sort((left, right) => elapsed(left) - elapsed(right))[1];
  return {
    platform: medianSample.platform,
    mode: medianSample.mode,
    medianSample: medianSample.sample,
    steps: {
      bulkInsert500Ms: median(samples.map(({ steps }) => steps.bulkInsert500Ms)),
      tenQueriesMs: median(samples.map(({ steps }) => steps.tenQueriesMs)),
      findByIds200Ms: median(samples.map(({ steps }) => steps.findByIds200Ms)),
      reactiveInsert200Ms: median(samples.map(({ steps }) => steps.reactiveInsert200Ms)),
    },
    rnSendMs: median(samples.map(({ rnSendMs }) => rnSendMs)),
    lag: {
      totalBlockedMs: median(samples.map(({ lag }) => lag.totalBlockedMs)),
      maxLagMs: median(samples.map(({ lag }) => lag.maxLagMs)),
      ticksOver50Ms: median(samples.map(({ lag }) => lag.ticksOver50Ms)),
      series: medianSample.lag.series,
    },
    persistence: {
      expected: 50,
      actual: median(samples.map(({ persistence }) => persistence.actual)),
      pass: samples.every(({ persistence }) => persistence.pass),
    },
  };
}
