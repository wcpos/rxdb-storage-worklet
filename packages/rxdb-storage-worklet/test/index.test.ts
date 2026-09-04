import { createRxDatabase, type RxStorage } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { filter, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkletMessageChannel,
  exposeWorkletRxStorage,
  getRxStorageWorklet,
  type ScheduleOnRN,
  type ScheduleOnRuntime,
} from '../src/index.js';

const schema = {
  title: 'hero schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    name: { type: 'string' },
  },
  required: ['id', 'name'],
} as const;

let sequence = 0;
const databases: { database: { close(): Promise<unknown> }; drain(): Promise<void> }[] = [];

class RealmBinding {
  private value: unknown;
  constructor(private readonly name: string) {}

  run<T>(task: () => T): T {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = globals[this.name];
    if (this.value === undefined) delete globals[this.name];
    else globals[this.name] = this.value;
    try {
      const result = task();
      this.value = globals[this.name];
      return result;
    } finally {
      if (previous === undefined) delete globals[this.name];
      else globals[this.name] = previous;
    }
  }

  get(): unknown {
    return this.value;
  }
}

function createFakeSchedulers(receiveGlobalName: string) {
  const rn = new RealmBinding(receiveGlobalName);
  const worklet = new RealmBinding(receiveGlobalName);
  const runtimeQueue: (() => void)[] = [];
  const rnQueue: (() => void)[] = [];
  const messages: unknown[] = [];

  const scheduleOnRuntime: ScheduleOnRuntime = (_runtime, task, ...args) => {
    messages.push(args.at(-1));
    runtimeQueue.push(() => worklet.run(() => task(...args)));
  };
  const scheduleOnRN: ScheduleOnRN = (task, ...args) => {
    messages.push(args.at(-1));
    rnQueue.push(() => rn.run(() => task(...args)));
  };

  async function drain(): Promise<void> {
    while (runtimeQueue.length || rnQueue.length) {
      while (runtimeQueue.length) runtimeQueue.shift()!();
      await Promise.resolve();
      while (rnQueue.length) rnQueue.shift()!();
      await Promise.resolve();
    }
  }

  return { drain, messages, rn, runtimeQueue, scheduleOnRN, scheduleOnRuntime, worklet };
}

async function settle<T>(promise: Promise<T>, drain: () => Promise<void>): Promise<T> {
  let done = false;
  promise.finally(() => { done = true; }).catch(() => undefined);
  for (let turn = 0; turn < 1000 && !done; turn += 1) {
    await drain();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (!done) throw new Error('Remote operation hung');
  return promise;
}

async function createRemote(storage: RxStorage<any, any>) {
  const id = ++sequence;
  const receiveGlobalName = '__rxdbReceiveString';
  const fake = createFakeSchedulers(receiveGlobalName);
  await fake.worklet.run(() => exposeWorkletRxStorage({
    storage,
    receiveGlobalName,
    scheduleOnRN: fake.scheduleOnRN,
  }));
  const remote = fake.rn.run(() => getRxStorageWorklet({
    runtime: {},
    identifier: `worklet-test-${id}`,
    scheduleOnRN: fake.scheduleOnRN,
    scheduleOnRuntime: fake.scheduleOnRuntime,
  }));
  return { fake, id, remote };
}

afterEach(async () => {
  for (const { database, drain } of databases.splice(0)) {
    await settle(database.close(), drain);
  }
});

describe('worklet storage channel', () => {
  it('returns RxStorage synchronously for createRxDatabase', () => {
    const storage = getRxStorageWorklet({
      runtime: {},
      scheduleOnRN: () => undefined,
      scheduleOnRuntime: () => undefined,
    });

    expect(storage).not.toBeInstanceOf(Promise);
  });

  it('runs RxDB CRUD and subscriptions through string-only messages', async () => {
    const { fake, id, remote } = await createRemote(getRxStorageMemory());
    const database = await settle(createRxDatabase({ name: `worklet${id}`, storage: remote }), fake.drain);
    databases.push({ database, drain: fake.drain });
    const collections = await settle(database.addCollections({ heroes: { schema } }), fake.drain);
    const snapshots: string[][] = [];
    const subscription = collections.heroes.find().$.subscribe((documents) => {
      snapshots.push(documents.map((document) => document.name));
    });

    const aliceObserved = firstValueFrom(collections.heroes.find().$.pipe(
      filter((documents) => documents.some((document) => document.name === 'Alice')),
    ));
    await settle(collections.heroes.insert({ id: 'hero-1', name: 'Alice' }), fake.drain);
    await settle(aliceObserved, fake.drain);
    const found = await settle(collections.heroes.findOne('hero-1').exec(), fake.drain);
    expect(found?.name).toBe('Alice');
    expect(snapshots).toContainEqual(['Alice']);
    const removalObserved = firstValueFrom(collections.heroes.find().$.pipe(
      filter((documents) => documents.length === 0),
    ));
    await settle(found!.remove(), fake.drain);
    await settle(removalObserved, fake.drain);
    expect(await settle(collections.heroes.findOne('hero-1').exec(), fake.drain)).toBeNull();
    expect(snapshots.at(-1)).toEqual([]);
    expect(fake.messages.length).toBeGreaterThan(0);
    expect(fake.messages.every((message) => typeof message === 'string')).toBe(true);
    subscription.unsubscribe();
  });

  it('closes subscriptions and removes both runtime receive bindings', async () => {
    const receiveGlobalName = `__rxdbTestReceive${++sequence}`;
    const fake = createFakeSchedulers(receiveGlobalName);
    await fake.worklet.run(() => exposeWorkletRxStorage({
      storage: getRxStorageMemory(),
      receiveGlobalName,
      scheduleOnRN: fake.scheduleOnRN,
    }));
    const creator = fake.rn.run(() => createWorkletMessageChannel({
      runtime: {},
      receiveGlobalName,
      scheduleOnRN: fake.scheduleOnRN,
      scheduleOnRuntime: fake.scheduleOnRuntime,
    }));
    const channel = await creator();
    let completed = false;
    channel.messages$.subscribe({ complete: () => { completed = true; } });
    expect(typeof fake.rn.get()).toBe('function');
    expect(typeof fake.worklet.get()).toBe('function');
    await fake.rn.run(() => channel.close());
    await fake.drain();
    expect(completed).toBe(true);
    expect(fake.rn.get()).toBeUndefined();
    expect(fake.worklet.get()).toBeUndefined();
    channel.send({ ignored: true });
    expect(fake.runtimeQueue).toHaveLength(0);
  });

  it('rejects when remote storage throws instead of hanging', async () => {
    const memory = getRxStorageMemory();
    const failing = {
      ...memory,
      createStorageInstance(parameters: Parameters<typeof memory.createStorageInstance>[0]) {
        if (parameters.collectionName === 'broken') return Promise.reject(new Error('remote boom'));
        return memory.createStorageInstance(parameters);
      },
    } as typeof memory;
    const { fake, id, remote } = await createRemote(failing);
    const database = await settle(createRxDatabase({ name: `failure${id}`, storage: remote }), fake.drain);
    databases.push({ database, drain: fake.drain });
    await expect(settle(database.addCollections({ broken: { schema } }), fake.drain)).rejects.toThrow('remote boom');
  });
});
