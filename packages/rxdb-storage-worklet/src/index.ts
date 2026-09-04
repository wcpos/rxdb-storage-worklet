import type { RxStorage } from 'rxdb';
import { exposeRxStorageRemote, getRxStorageRemote } from 'rxdb/plugins/storage-remote';
import { Subject } from 'rxjs';

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

async function loadWorklets(): Promise<WorkletsModule> {
  return import('react-native-worklets') as Promise<WorkletsModule>;
}

export function createWorkletMessageChannel(options: {
  runtime: unknown;
  scheduleOnRuntime: ScheduleOnRuntime;
  scheduleOnRN: ScheduleOnRN;
  receiveGlobalName?: string;
}) {
  const receiveGlobalName = options.receiveGlobalName ?? DEFAULT_RECEIVE_GLOBAL;
  const serializedMessages$ = new Subject<string>();
  const messages$ = new Subject<any>();
  const relay = serializedMessages$.subscribe((message) => messages$.next(JSON.parse(message)));
  let closed = false;
  const receive: ReceiveFunction = (message) => {
    if (!closed) serializedMessages$.next(message);
  };
  globals()[receiveGlobalName] = receive;
  const channel = {
    messages$,
    send(message: unknown) {
      if (closed) return;
      options.scheduleOnRuntime(
        options.runtime,
        deliverToGlobal,
        receiveGlobalName,
        JSON.stringify(message),
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      relay.unsubscribe();
      serializedMessages$.complete();
      messages$.complete();
      if (globals()[receiveGlobalName] === receive) delete globals()[receiveGlobalName];
      options.scheduleOnRuntime(options.runtime, disposeGlobal, receiveGlobalName);
    },
  };
  return async () => channel;
}

export async function getRxStorageWorklet(options: {
  runtime: unknown;
  identifier?: string;
  scheduleOnRuntime?: ScheduleOnRuntime;
  scheduleOnRN?: ScheduleOnRN;
}): Promise<RxStorage<any, any>> {
  let scheduleOnRuntime = options.scheduleOnRuntime;
  let scheduleOnRN = options.scheduleOnRN;
  if (!scheduleOnRuntime || !scheduleOnRN) {
    const worklets = await loadWorklets();
    scheduleOnRuntime ??= worklets.scheduleOnRuntime;
    scheduleOnRN ??= worklets.scheduleOnRN;
  }
  return getRxStorageRemote({
    identifier: options.identifier ?? 'rxdb-storage-worklet',
    mode: 'storage',
    messageChannelCreator: createWorkletMessageChannel({
      runtime: options.runtime,
      scheduleOnRuntime,
      scheduleOnRN,
    }),
  });
}

export async function exposeWorkletRxStorage(options: {
  storage: RxStorage<any, any>;
  receiveGlobalName?: string;
  scheduleOnRN?: ScheduleOnRN;
}): Promise<void> {
  const receiveGlobalName = options.receiveGlobalName ?? DEFAULT_RECEIVE_GLOBAL;
  const scheduleOnRN = options.scheduleOnRN ?? (await loadWorklets()).scheduleOnRN;
  const messages$ = new Subject<any>();
  const exposure = exposeRxStorageRemote({
    storage: options.storage,
    messages$,
    send(message: unknown) {
      scheduleOnRN(deliverToGlobal, receiveGlobalName, JSON.stringify(message));
    },
  }) as unknown as { unsubscribe?: () => void; close?: () => unknown } | undefined;
  const receive: ReceiveFunction = (message) => messages$.next(JSON.parse(message));
  const close = () => {
    messages$.complete();
    exposure?.unsubscribe?.();
    exposure?.close?.();
    if (globals()[receiveGlobalName] === receive) delete globals()[receiveGlobalName];
  };
  receive.dispose = close;
  globals()[receiveGlobalName] = receive;
}
