import type { RxStorage } from 'rxdb';
import { blobToBase64String, clone, createBlobFromBase64 } from 'rxdb/plugins/core';
import { exposeRxStorageRemote, getRxStorageRemote } from 'rxdb/plugins/storage-remote';
import { Subject } from 'rxjs';

declare const require: (id: string) => unknown;

type ScheduledFunction = (...args: any[]) => void;

export type ScheduleOnRuntime = (
  runtime: unknown,
  task: ScheduledFunction,
  ...args: any[]
) => void;

export type ScheduleOnRN = (task: ScheduledFunction, ...args: any[]) => void;

const DEFAULT_RECEIVE_GLOBAL = '__rxdbReceiveString';
type ReceiveFunction = ((message: string) => void) & { dispose?: () => void };
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

function disposeGlobal(name: string): void {
  'worklet';
  const receive = globals()[name] as ReceiveFunction | undefined;
  receive?.dispose?.();
  delete globals()[name];
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

async function serializeMessage(message: any): Promise<string> {
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
  return JSON.stringify(copy);
}

async function deserializeMessage(serialized: string): Promise<any> {
  'worklet';
  const message = JSON.parse(serialized);
  if (message.method === 'bulkWrite' && Array.isArray(message.params?.[0])) {
    for (const row of message.params[0]) {
      for (const attachment of Object.values(row.document?._attachments ?? {}) as any[]) {
        if (typeof attachment.data === 'string') attachment.data = await createBlobFromBase64(attachment.data, attachment.type ?? '');
      }
    }
  } else if (message.method === 'getAttachmentData' && typeof message.return === 'string') {
    message.return = await createBlobFromBase64(message.return, '');
  }
  return message;
}

function loadWorklets(): WorkletsModule {
  return require('react-native-worklets') as WorkletsModule;
}

export function createWorkletMessageChannel(options: {
  runtime: unknown;
  scheduleOnRuntime?: ScheduleOnRuntime;
  scheduleOnRN?: ScheduleOnRN;
  receiveGlobalName?: string;
}) {
  const receiveGlobalName = options.receiveGlobalName ?? DEFAULT_RECEIVE_GLOBAL;
  const messages$ = new Subject<any>();
  let loadedWorklets: WorkletsModule | undefined;
  const scheduleOnRuntime = () => options.scheduleOnRuntime
    ?? (loadedWorklets ??= loadWorklets()).scheduleOnRuntime;
  let closed = false;
  let sendQueue = Promise.resolve();
  const receive: ReceiveFunction = (message) => {
    void deserializeMessage(message).then((value) => { if (!closed) messages$.next(value); }, (error) => messages$.error(error));
  };
  globals()[receiveGlobalName] = receive;
  const channel = {
    messages$,
    send(message: unknown) {
      if (closed) return;
      sendQueue = sendQueue.then(async () => scheduleOnRuntime()(
        options.runtime, deliverToGlobal, receiveGlobalName, await serializeMessage(message),
      ));
      sendQueue.catch((error) => messages$.error(error));
    },
    async close() {
      if (closed) return;
      closed = true;
      messages$.complete();
      if (globals()[receiveGlobalName] === receive) delete globals()[receiveGlobalName];
      scheduleOnRuntime()(options.runtime, disposeGlobal, receiveGlobalName);
    },
  };
  return async () => channel;
}

export function getRxStorageWorklet(options: {
  runtime: unknown;
  identifier?: string;
  scheduleOnRuntime?: ScheduleOnRuntime;
  scheduleOnRN?: ScheduleOnRN;
}): RxStorage<any, any> {
  return getRxStorageRemote({
    identifier: options.identifier ?? 'rxdb-storage-worklet',
    mode: 'storage',
    messageChannelCreator: createWorkletMessageChannel({
      runtime: options.runtime,
      scheduleOnRuntime: options.scheduleOnRuntime,
      scheduleOnRN: options.scheduleOnRN,
    }),
  });
}

export async function exposeWorkletRxStorage(options: {
  storage: RxStorage<any, any>;
  receiveGlobalName?: string;
  scheduleOnRN?: ScheduleOnRN;
}): Promise<void> {
  const receiveGlobalName = options.receiveGlobalName ?? DEFAULT_RECEIVE_GLOBAL;
  const scheduleOnRN = options.scheduleOnRN ?? loadWorklets().scheduleOnRN;
  const messages$ = new Subject<any>();
  const exposure = exposeRxStorageRemote({
    storage: options.storage,
    messages$,
    send(message: unknown) {
      void serializeMessage(message).then(
        (serialized) => scheduleOnRN(deliverToGlobal, receiveGlobalName, serialized),
        (error) => messages$.error(error),
      );
    },
  }) as unknown as { unsubscribe?: () => void; close?: () => unknown } | undefined;
  const receive: ReceiveFunction = (message) => {
    void deserializeMessage(message).then((value) => messages$.next(value), (error) => messages$.error(error));
  };
  const close = () => {
    messages$.complete();
    exposure?.unsubscribe?.();
    exposure?.close?.();
    if (globals()[receiveGlobalName] === receive) delete globals()[receiveGlobalName];
  };
  receive.dispose = close;
  globals()[receiveGlobalName] = receive;
}
