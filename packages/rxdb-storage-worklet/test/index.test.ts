import { fillWithDefaultSettings } from 'rxdb/plugins/core';
import { createFakeSchedulers } from './fake-schedulers.js';
import { createRxDatabase, type RxStorage } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { filter, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkletMessageChannel,
  exposeWorkletRxStorage,
  getRxStorageWorklet,
  receiveWorkletMessage,
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
  const receiveGlobalName = `__rxdbReceiveString_${id}`;
  const fake = createFakeSchedulers(receiveGlobalName);
  await fake.worklet.run(() => exposeWorkletRxStorage({
    storage,
    receiveGlobalName,
    scheduleOnRN: fake.scheduleOnRN,
  }));
  const remote = fake.rn.run(() => getRxStorageWorklet({
    runtime: {},
    identifier: `worklet-test-${id}`,
    receiveGlobalName,
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
  it('times stringify, dispatch and matching replies independently', async () => {
    const fake = createFakeSchedulers('__timed');
    const timings: any[] = [];
    const channel = await createWorkletMessageChannel({
      runtime: {}, receiveGlobalName: '__timed', scheduleOnRuntime: fake.scheduleOnRuntime,
      onTiming: timing => timings.push(timing),
    })();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 2);
    channel.send({ requestId: 'timed', method: 'custom', params: [] });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    (fake.rn.get() as any)(JSON.stringify({ answerTo: 'changestream' }));
    expect(timings).toHaveLength(0);
    (fake.rn.get() as any)(JSON.stringify({ answerTo: 'timed', return: null }));
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ requestId: 'timed', rnSerializeMs: 2, rnDispatchMs: 2 });
    expect(timings[0].roundTripMs).toBe(timings[0].replyMs - timings[0].sentMs);
    expect(timings[0].roundTripMs).toBeGreaterThan(timings[0].rnDispatchMs);
    await channel.close();
    vi.restoreAllMocks();
  });

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

  it('closes the RN channel without destroying the exposure', async () => {
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
    const channel = await fake.rn.run(creator);
    let completed = false;
    channel.messages$.subscribe({ complete: () => { completed = true; } });
    expect(typeof fake.rn.get()).toBe('function');
    expect(typeof fake.worklet.get()).toBe('function');
    await fake.rn.run(() => channel.close());
    await fake.drain();
    expect(completed).toBe(true);
    expect(fake.rn.get()).toBeUndefined();
    expect(typeof fake.worklet.get()).toBe('function');
    expect(() => channel.send({ ignored: true })).toThrow(/closing/);
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
  it('isolates two storages on two runtimes with distinct receive bindings', async () => {
    const first = await createRemote(getRxStorageMemory());
    const second = await createRemote(getRxStorageMemory());
    const drain = async () => { await first.fake.drain(); await second.fake.drain(); };
    const a = await settle(first.remote.createStorageInstance(params('same')), drain);
    const b = await settle(second.remote.createStorageInstance(params('other')), drain);
    await settle(a.bulkWrite([{ document: doc('one') }], 'test'), drain);
    expect((await settle(a.findDocumentsById(['one'], false), drain)).length).toBe(1);
    expect(await settle(b.findDocumentsById(['one'], false), drain)).toEqual([]);
    await settle(a.close(), drain); await settle(b.close(), drain);
  });

  it('derives matching receive bindings from identifier', async () => {
    const identifier = `derived-${++sequence}`;
    const fake = createFakeSchedulers(`__rxdbReceiveString_${identifier}`);
    await fake.worklet.run(() => exposeWorkletRxStorage({ storage: getRxStorageMemory(), identifier, scheduleOnRN: fake.scheduleOnRN }));
    const remote = getRxStorageWorklet({ runtime: {}, identifier, scheduleOnRuntime: fake.scheduleOnRuntime });
    const instance = await settle(remote.createStorageInstance(params('derived')), fake.drain);
    await settle(instance.close(), fake.drain);
  });

  it('opens closes and reopens through the same RxStorage', async () => {
    const { remote, fake } = await createRemote(getRxStorageMemory());
    for (let cycle = 0; cycle < 2; cycle++) {
      const instance = await settle(remote.createStorageInstance(params('reopen')), fake.drain);
      expect(await settle(instance.findDocumentsById(['missing'], false), fake.drain)).toEqual([]);
      await settle(instance.close(), fake.drain);
    }
  });

  it('round trips arbitrary binary attachments without fetch through the public channel', async () => {
    const original = globalThis.fetch;
    Object.assign(globalThis, { fetch: undefined });
    try {
      const { remote, fake } = await createRemote(getRxStorageMemory());
      const instance = await settle(remote.createStorageInstance(params('binary')), fake.drain);
      const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const document = { ...doc('binary'), _attachments: { binary: { data: blob, length: blob.size, type: blob.type, digest: 'binary-digest' } } };
      expect((await settle(instance.bulkWrite([{ document }], 'binary'), fake.drain)).error).toEqual([]);
      const read = await settle(instance.getAttachmentData('binary', 'binary', 'binary-digest'), fake.drain);
      expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
      expect(fake.messages.every((message) => typeof message === 'string')).toBe(true);
      expect(fake.messages.some((message) => JSON.parse(message as string).method === 'bulkWrite')).toBe(true);
      await settle(instance.close(), fake.drain);
    } finally { globalThis.fetch = original; }
  });

  it('answers attachment decoding failure and keeps the next request alive', async () => {
    const { remote, fake } = await createRemote(getRxStorageMemory());
    const instance = await settle(remote.createStorageInstance(params('badattachment')), fake.drain);
    const document = { ...doc('bad'), _attachments: { bad: { data: '%%%', length: 1, type: '', digest: 'bad' } } };
    await expect(settle(instance.bulkWrite([{ document: document as any }], 'bad'), fake.drain)).rejects.toThrow();
    expect(await settle(instance.findDocumentsById(['bad'], false), fake.drain)).toEqual([]);
    await settle(instance.close(), fake.drain);
  });

  it('drains a queued send and its answer before closing the channel', async () => {
    const { remote, fake } = await createRemote(getRxStorageMemory());
    const instance = await settle(remote.createStorageInstance(params('drain')), fake.drain);
    const channel = instance.internals.messageChannel;
    const write = instance.bulkWrite([{ document: doc('queued') }], 'queued');
    const close = channel.close();
    expect((await settle(write, fake.drain)).error).toEqual([]);
    await settle(close, fake.drain);
    expect(channel.messages$.isStopped).toBe(true);
    // The remote instance is still exposed; explicitly dispose it below.
    await fake.worklet.run(() => (fake.worklet.get() as any).dispose());
  });

  it('disposal closes actual exposed instances after pending requests finish', async () => {
    let actual: any;
    const memory = getRxStorageMemory();
    const storage = { ...memory, async createStorageInstance(p: any) { actual = await memory.createStorageInstance(p); return actual; } };
    const { remote, fake } = await createRemote(storage);
    const instance = await settle(remote.createStorageInstance(params('dispose')), fake.drain);
    expect(actual.closed).toBe(false);
    const write = instance.bulkWrite([{ document: doc('before-dispose') }], 'dispose');
    // Let the serialized request reach the worker before disposing its exposure.
    for (let turn = 0; turn < 5; turn++) { await Promise.resolve(); await fake.drain(); }
    const dispose = fake.worklet.run(() => (fake.worklet.get() as any).dispose());
    await settle(write, fake.drain);
    await settle(Promise.resolve(dispose), fake.drain);
    expect(actual.closed).toBe(true);
    await instance.internals.messageChannel.close();
  });

  it('decodes attachment replies with the RN Blob implementation', async () => {
    const OriginalBlob = globalThis.Blob;
    const originalFetch = globalThis.fetch;
    const fake = createFakeSchedulers(`__rnBlob${++sequence}`);
    const channel = await createWorkletMessageChannel({ runtime: {}, receiveGlobalName: `__rnBlob${sequence}`, scheduleOnRuntime: fake.scheduleOnRuntime })();
    class RNBlob {
      constructor(parts: any[] = []) {
        if (parts.some((part) => part instanceof ArrayBuffer)) throw new Error('ArrayBuffer Blob parts are unsupported');
      }
    }
    try {
      Object.assign(globalThis, { Blob: RNBlob });
      globalThis.fetch = vi.fn(async () => ({ blob: async () => new OriginalBlob([Uint8Array.of(0, 128, 255)]) })) as any;
      const reply = firstValueFrom(channel.messages$);
      (fake.rn.get() as any)(JSON.stringify({ method: 'getAttachmentData', answerTo: 'reply', return: 'AID/' }));
      const result = await reply;
      expect(result.error).toBeUndefined();
      expect([...new Uint8Array(await result.return.arrayBuffer())]).toEqual([0, 128, 255]);
    } finally {
      globalThis.Blob = OriginalBlob; globalThis.fetch = originalFetch;
      await channel.close();
    }
  });

  it('pairs the default channel creator with the default exposure', async () => {
    const fake = createFakeSchedulers('__rxdbReceiveString_rxdb-storage-worklet');
    const scheduled = vi.fn(fake.scheduleOnRN);
    const dispose = await fake.worklet.run(() => exposeWorkletRxStorage({ storage: getRxStorageMemory(), scheduleOnRN: scheduled, receiveOnRN: receiveWorkletMessage }));
    const channel = await createWorkletMessageChannel({ runtime: {}, scheduleOnRuntime: fake.scheduleOnRuntime })();
    const reply = firstValueFrom(channel.messages$);
    channel.send({ requestId: 'default', connectionId: 'default', method: 'custom', params: [] });
    expect((await settle(reply, fake.drain)).answerTo).toBe('default');
    expect(scheduled.mock.calls[0][0]).toBe(receiveWorkletMessage);
    await settle(channel.close(), fake.drain);
    await fake.worklet.run(dispose);
  });

});

function params(name: string) {
  return { databaseInstanceToken: `token-${sequence}`, databaseName: name + sequence, collectionName: 'heroes', schema: fillWithDefaultSettings({ ...schema, attachments: {} }), options: {}, multiInstance: false, devMode: true };
}
function doc(id: string) {
  return { id, name: id, _rev: '1-test', _meta: { lwt: Date.now() }, _deleted: false, _attachments: {} };
}
