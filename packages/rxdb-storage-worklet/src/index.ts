import type { RxStorage } from 'rxdb';
import { blobToBase64String, clone, base64ToArrayBuffer, createBlobFromBase64 } from 'rxdb/plugins/core';
import { createErrorAnswer, exposeRxStorageRemote, getRxStorageRemote } from 'rxdb/plugins/storage-remote';
import { Subject } from 'rxjs';

declare const require: (id: string) => unknown;

type ScheduledFunction = (...args: any[]) => void;

export type ScheduleOnRuntime = (
  runtime: unknown,
  task: ScheduledFunction,
  ...args: any[]
) => void;

export type ScheduleOnRN = (task: ScheduledFunction, ...args: any[]) => void;

const DEFAULT_IDENTIFIER = 'rxdb-storage-worklet';
const DEFAULT_RECEIVE_GLOBAL = '__rxdbReceiveString';
type ReceiveFunction = ((message: string) => void) & { dispose?: () => Promise<void> };
type WorkletsModule = {
  scheduleOnRuntime: ScheduleOnRuntime;
  scheduleOnRN: ScheduleOnRN;
};

function globals(): Record<string, unknown> {
  'worklet';
  return globalThis as unknown as Record<string, unknown>;
}

function deliverToGlobal(name: string, message: string): void {
  'worklet';
  const receive = globals()[name];
  if (typeof receive === 'function') (receive as (value: string) => void)(message);
}

// Pass this RN-defined reference into a bundle-mode worker initializer.
export function receiveWorkletMessage(name: string, serialized: string): void {
  deliverToGlobal(name, serialized);
}

function blobAsBase64(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === 'function') return blobToBase64String(blob);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function serializeMessage(message: any, timing?: { rnSerializeMs: number }): Promise<string> {
  'worklet';
  const copy = clone(message);
  if (copy.method === 'bulkWrite' && Array.isArray(copy.params?.[0])) {
    for (const row of copy.params[0]) {
      for (const attachment of Object.values(row.document?._attachments ?? {}) as any[]) {
        if (attachment.data instanceof Blob) attachment.data = await blobAsBase64(attachment.data);
      }
    }
  } else if (copy.method === 'getAttachmentData' && copy.return instanceof Blob) {
    copy.return = await blobAsBase64(copy.return);
  }
  const started = timing ? performance.now() : 0;
  const serialized = JSON.stringify(copy);
  if (timing) timing.rnSerializeMs = performance.now() - started;
  return serialized;
}

function deserializeMessage(serialized: string): any {
  'worklet';
  const message = JSON.parse(serialized);
  if (message.method === 'bulkWrite' && Array.isArray(message.params?.[0])) {
    for (const row of message.params[0]) {
      for (const attachment of Object.values(row.document?._attachments ?? {}) as any[]) {
        if (typeof attachment.data === 'string') attachment.data = new Blob([base64ToArrayBuffer(attachment.data)], { type: attachment.type ?? '' });
      }
    }
  } else if (message.method === 'getAttachmentData' && typeof message.return === 'string') {
    // RN's built-in Blob rejects ArrayBuffer parts; keep its native reply decoder.
    if (typeof Blob.prototype.arrayBuffer !== 'function') {
      return createBlobFromBase64(message.return, '').then((blob) => ({ ...message, return: blob }));
    }
    message.return = new Blob([base64ToArrayBuffer(message.return)], { type: '' });
  }
  return message;
}

function loadWorklets(): WorkletsModule {
  return require('react-native-worklets') as WorkletsModule;
}

export type RnRequestTiming = {
  requestId: string;
  sentMs: number;
  replyMs: number;
  rnSerializeMs: number;
  rnDispatchMs: number;
  roundTripMs: number;
};

export function createWorkletMessageChannel(options: {
  runtime: unknown;
  scheduleOnRuntime?: ScheduleOnRuntime;
  scheduleOnRN?: ScheduleOnRN;
  receiveGlobalName?: string;
  onTiming?: (timing: RnRequestTiming) => void;
}) {
  const receiveGlobalName = options.receiveGlobalName ?? `${DEFAULT_RECEIVE_GLOBAL}_${DEFAULT_IDENTIFIER}`;
  let loadedWorklets: WorkletsModule | undefined;
  const scheduleOnRuntime = () => options.scheduleOnRuntime
    ?? (loadedWorklets ??= loadWorklets()).scheduleOnRuntime;
  return async () => {
    const messages$ = new Subject<any>();
    const pending = new Set<string>();
    const timings = new Map<string, Omit<RnRequestTiming, 'replyMs' | 'roundTripMs'>>();
    let drained: (() => void) | undefined;
    let closing: Promise<void> | undefined;
    let sendQueue = Promise.resolve();
    const accept = (value: any) => {
      pending.delete(value.answerTo);
      messages$.next(value);
      if (!pending.size) drained?.();
    };
    const receive: ReceiveFunction = (serialized) => {
      const replyMs = options.onTiming ? performance.now() : 0;
      const message = JSON.parse(serialized);
      const timing = timings.get(message.answerTo);
      if (timing) {
        timings.delete(message.answerTo);
        options.onTiming?.({ ...timing, replyMs, roundTripMs: replyMs - timing.sentMs });
      }
      void Promise.resolve().then(() => deserializeMessage(serialized)).then(accept, (error) => {
        accept({ ...message, return: undefined, error: { message: String(error) } });
      });
    };
    globals()[receiveGlobalName] = receive;
    return {
      messages$,
      send(message: any) {
        if (closing) throw new Error('Channel is closing');
        pending.add(message.requestId);
        sendQueue = sendQueue.then(async () => {
          try {
            const timing = options.onTiming ? { requestId: message.requestId, sentMs: performance.now(), rnSerializeMs: 0, rnDispatchMs: 0 } : undefined;
            const serialized = await serializeMessage(message, timing);
            const schedule = scheduleOnRuntime();
            const dispatchStart = timing ? performance.now() : 0;
            schedule(options.runtime, deliverToGlobal, receiveGlobalName, serialized);
            if (timing) {
              timing.rnDispatchMs = performance.now() - dispatchStart;
              timings.set(message.requestId, timing);
            }
          } catch (error) { accept(createErrorAnswer(message, error as Error)); }
        });
      },
      close() {
        return closing ??= (async () => {
          await sendQueue;
          // Keep delivering replies until every accepted request has settled.
          if (pending.size) await new Promise<void>((resolve) => { drained = resolve; });
          messages$.complete();
          if (globals()[receiveGlobalName] === receive) delete globals()[receiveGlobalName];
          // Exposure lifetime belongs to its owner, not the last current connection.
        })();
      },
    };
  };
}

export function getRxStorageWorklet(options: {
  runtime: unknown;
  identifier?: string;
  receiveGlobalName?: string;
  scheduleOnRuntime?: ScheduleOnRuntime;
  scheduleOnRN?: ScheduleOnRN;
  onTiming?: (timing: RnRequestTiming) => void;
}): RxStorage<any, any> {
  return getRxStorageRemote({
    identifier: options.identifier ?? DEFAULT_IDENTIFIER,
    mode: 'storage',
    messageChannelCreator: createWorkletMessageChannel({
      runtime: options.runtime,
      receiveGlobalName: options.receiveGlobalName ?? `${DEFAULT_RECEIVE_GLOBAL}_${options.identifier ?? DEFAULT_IDENTIFIER}`,
      scheduleOnRuntime: options.scheduleOnRuntime,
      scheduleOnRN: options.scheduleOnRN,
      onTiming: options.onTiming,
    }),
  });
}

export async function exposeWorkletRxStorage(options: {
  storage: RxStorage<any, any>;
  identifier?: string;
  receiveGlobalName?: string;
  scheduleOnRN?: ScheduleOnRN;
  receiveOnRN?: typeof receiveWorkletMessage;
}): Promise<() => Promise<void>> {
  const receiveGlobalName = options.receiveGlobalName ?? `${DEFAULT_RECEIVE_GLOBAL}_${options.identifier ?? DEFAULT_IDENTIFIER}`;
  const scheduleOnRN = options.scheduleOnRN ?? loadWorklets().scheduleOnRN;
  const messages$ = new Subject<any>();
  let pending = 0;
  let drained: (() => void) | undefined;
  let disposal: Promise<void> | undefined;
  const send = (message: any) => {
    void serializeMessage(message).catch((error) => JSON.stringify({
      ...message, return: undefined, error: { message: String(error) },
    })).then((serialized) => {
      scheduleOnRN(options.receiveOnRN ?? deliverToGlobal, receiveGlobalName, serialized);
      if (message.answerTo !== 'changestream' && --pending === 0) drained?.();
    });
  };
  const exposure = exposeRxStorageRemote({ storage: options.storage, messages$, send });
  const receive: ReceiveFunction = (serialized) => {
    const message = JSON.parse(serialized);
    pending++;
    void Promise.resolve().then(() => deserializeMessage(serialized)).then(
      (value) => messages$.next(value), (error) => send(createErrorAnswer(message, error as Error)),
    );
  };
  const close = () => {
    if (disposal) return disposal;
    if (globals()[receiveGlobalName] === receive) delete globals()[receiveGlobalName];
    return disposal = (async () => {
      if (pending) await new Promise<void>((resolve) => { drained = resolve; });
      messages$.complete();
      await Promise.all([...exposure.instanceByFullName.values()].map(async (state) => {
        // Failed creations have no resource to dispose.
        const instance = await state.storageInstancePromise.catch(() => undefined);
        if (instance) await instance.close();
      }));
      exposure.instanceByFullName.clear();
    })();
  };
  receive.dispose = close;
  globals()[receiveGlobalName] = receive;
  return close;
}
