import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import './global.css';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createRxDatabase, type RxCollection, type RxJsonSchema } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { getRxStorageExpoAsync } from 'rxdb-premium/plugins/storage-filesystem-expo';
import {
  getRnSendMs,
  resetRnSendMs,
  workletMemoryStorage,
  workletMemoryStringStorage,
  workletFilesystemStorage,
} from './src/storage-runtime';

(globalThis as any).crypto ??= {};
(globalThis as any).crypto.subtle ??= { digest: Crypto.digest };

type Mode =
  | 'js-thread'
  | 'worklet-memory'
  | 'worklet-memory-string'
  | 'worklet-filesystem-string'
  | 'js-thread-memory';
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
type Result = {
  mode: Mode;
  steps: {
    bulkInsert500Ms: number;
    tenQueriesMs: number;
    findByIds200Ms: number;
    reactiveInsert200Ms: number;
  };
  rnSendMs: number;
  persistenceCount?: number;
  lag: { totalBlockedMs: number; maxLagMs: number; ticksOver50Ms: number };
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
    date_modified: new Date(1700000000000 + index * 1000).toISOString(),
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
) {
  const response = await collection.bulkInsert(documents);
  if (response.error.length) {
    throw new Error(`bulkInsert errors: ${JSON.stringify(response.error)}`);
  }
}

async function runBenchmark(mode: Mode): Promise<Result> {
  const documents = Array.from({ length: 700 }, (_, index) => makeProduct(index));
  const channelEncoding =
    mode === 'worklet-filesystem-string'
      ? 'filesystem'
      : mode === 'worklet-memory-string'
      ? 'string'
      : mode === 'worklet-memory'
        ? 'object'
        : null;
  if (channelEncoding) resetRnSendMs(channelEncoding);
  const storage: any =
    mode === 'worklet-memory'
      ? workletMemoryStorage
      : mode === 'worklet-memory-string'
        ? workletMemoryStringStorage
      : mode === 'worklet-filesystem-string'
        ? workletFilesystemStorage
      : mode === 'js-thread-memory'
        ? getRxStorageMemory()
        : getRxStorageExpoAsync();

  const lags: number[] = [];
  let expected = performance.now() + 50;
  const lagTimer = setInterval(() => {
    const actual = performance.now();
    lags.push(Math.max(0, actual - expected));
    expected = actual + 50;
  }, 50);

  const db = await Promise.race([
    createRxDatabase({ name: 'spike-' + Date.now(), multiInstance: false, storage }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('createRxDatabase timed out after 30 seconds')), 30000),
    ),
  ]);

  try {
    const collections = await db.addCollections({ products: { schema } });
    const collection = collections.products;

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
    await collection.findByIds(documents.slice(0, 200).map((doc) => doc.id));
    const findByIds200Ms = performance.now() - started;

    const reactiveQuery = collection.find({
      selector: {},
      sort: [{ name: 'desc' }],
      limit: 50,
    });
    let emissionCount = 0;
    let initialResolve!: () => void;
    let changedResolve!: () => void;
    const initialEmission = new Promise<void>((resolve) => (initialResolve = resolve));
    const changedEmission = new Promise<void>((resolve) => (changedResolve = resolve));
    const subscription = reactiveQuery.$.subscribe(() => {
      emissionCount += 1;
      if (emissionCount === 1) initialResolve();
      if (emissionCount === 2) changedResolve();
    });
    await initialEmission;
    started = performance.now();
    await Promise.all([
      checkedBulkInsert(collection, documents.slice(500, 700)),
      changedEmission,
    ]);
    const reactiveInsert200Ms = performance.now() - started;
    subscription.unsubscribe();

    const finished = performance.now();
    lags.push(Math.max(0, finished - expected));
    clearInterval(lagTimer);
    const result: Result = {
      mode,
      steps: {
        bulkInsert500Ms,
        tenQueriesMs,
        findByIds200Ms,
        reactiveInsert200Ms,
      },
      rnSendMs: channelEncoding ? getRnSendMs(channelEncoding) : 0,
      lag: {
        totalBlockedMs: lags.reduce((sum, lag) => sum + lag, 0),
        maxLagMs: Math.max(0, ...lags),
        ticksOver50Ms: lags.filter((lag) => lag > 50).length,
      },
    };
    console.log('SPIKE_RESULT ' + JSON.stringify(result));
    return result;
  } finally {
    clearInterval(lagTimer);
    await db.close();
  }
}

async function persistenceCheck() {
  const name = 'w3-persistence-' + Date.now();
  const first = await createRxDatabase({ name, multiInstance: false, storage: workletFilesystemStorage });
  await checkedBulkInsert((await first.addCollections({ products: { schema } })).products, Array.from({ length: 50 }, (_, i) => makeProduct(i)));
  await first.close();
  const reopened = await createRxDatabase({ name, multiInstance: false, storage: workletFilesystemStorage });
  try { return await (await reopened.addCollections({ products: { schema } })).products.count().exec(); }
  finally { await reopened.close(); }
}

const rows: [string, (result: Result) => number][] = [
  ['Insert 500', (r) => r.steps.bulkInsert500Ms],
  ['10 queries', (r) => r.steps.tenQueriesMs],
  ['Find 200 ids', (r) => r.steps.findByIds200Ms],
  ['Reactive +200', (r) => r.steps.reactiveInsert200Ms],
  ['RN send', (r) => r.rnSendMs],
  ['Total blocked', (r) => r.lag.totalBlockedMs],
  ['Max lag', (r) => r.lag.maxLagMs],
  ['Ticks >50 ms', (r) => r.lag.ticksOver50Ms],
  ['Persistence count', (r) => r.persistenceCount ?? 0],
];

export default function App() {
  const [counter, setCounter] = useState(0);
  const [running, setRunning] = useState<Mode | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setCounter((value) => value + 1), 100);
    return () => clearInterval(timer);
  }, []);

  const run = async (mode: Mode) => {
    setRunning(mode);
    setError('');
    try {
      const samples: Result[] = [];
      for (let run = 0; run < 3; run += 1) samples.push(await runBenchmark(mode));
      const median = (pick: (sample: Result) => number) => samples.map(pick).sort((a, b) => a - b)[1];
      const result: Result = { mode, steps: { bulkInsert500Ms: median((s) => s.steps.bulkInsert500Ms), tenQueriesMs: median((s) => s.steps.tenQueriesMs), findByIds200Ms: median((s) => s.steps.findByIds200Ms), reactiveInsert200Ms: median((s) => s.steps.reactiveInsert200Ms) }, rnSendMs: median((s) => s.rnSendMs), lag: { totalBlockedMs: median((s) => s.lag.totalBlockedMs), maxLagMs: median((s) => s.lag.maxLagMs), ticksOver50Ms: median((s) => s.lag.ticksOver50Ms) } };
      if (mode === 'worklet-filesystem-string') result.persistenceCount = await persistenceCheck();
      console.log('SPIKE_MEDIAN ' + JSON.stringify(result));
      setResults((current) => [...current.filter((item) => item.mode !== mode), result]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      console.error(`SPIKE_ERROR ${mode} ${message}`);
      setError(message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>RxDB Worklets Spike</Text>
        <Text testID="counter">JS counter: {counter}</Text>
        <Text>Status: {running ? `Running ${running}…` : 'Idle'}</Text>
        <View style={styles.buttons} className="p-4 bg-blue-500">
          <Button
            title="Run on JS thread"
            disabled={running !== null}
            onPress={() => run('js-thread')}
          />
          <Button
            title="Run on worklet runtime (memory)"
            disabled={running !== null}
            onPress={() => run('worklet-memory')}
          />
          <Button
            title="Run on worklet runtime (memory, string channel)"
            disabled={running !== null}
            onPress={() => run('worklet-memory-string')}
          />
          <Button
            title="Run on JS thread (memory)"
            disabled={running !== null}
            onPress={() => run('js-thread-memory')}
          />
          <Button
            title="Run on worklet runtime (filesystem, string channel)"
            disabled={running !== null}
            onPress={() => run('worklet-filesystem-string')}
          />
        </View>
        {error ? <Text style={styles.error}>Error: {error}</Text> : null}
        {results.length ? (
          <View style={styles.table}>
            <View style={styles.row}>
              <Text style={styles.label}>Metric (ms)</Text>
              {results.map((result) => (
                <Text key={result.mode} style={styles.value}>{result.mode}</Text>
              ))}
            </View>
            {rows.map(([label, value]) => (
              <View style={styles.row} key={label}>
                <Text style={styles.label}>{label}</Text>
                {results.map((result) => (
                  <Text key={result.mode} style={styles.value}>
                    {value(result).toFixed(1)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}
        <StatusBar style="auto" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: 'bold' },
  buttons: { gap: 8 },
  error: { color: 'red' },
  table: { borderWidth: 1, borderColor: '#999' },
  row: { flexDirection: 'row', padding: 6, borderBottomWidth: 1, borderColor: '#ddd' },
  label: { flex: 1.4, fontWeight: '600' },
  value: { flex: 1, textAlign: 'right' },
});
