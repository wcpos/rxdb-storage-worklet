import type { ScheduleOnRN, ScheduleOnRuntime } from '../src/index.js';

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

export function createFakeSchedulers(receiveGlobalName: string, automatic = false) {
  const rn = { run: <T>(task: () => T): T => task(), get: () => (globalThis as any)[receiveGlobalName] };
  const worklet = new RealmBinding(receiveGlobalName);
  const runtimeQueue: (() => void)[] = [];
  const rnQueue: (() => void)[] = [];
  const messages: unknown[] = [];

  const scheduleOnRuntime: ScheduleOnRuntime = (_runtime, task, ...args) => {
    messages.push(args.at(-1));
    const run = () => worklet.run(() => task(...args));
    if (automatic) queueMicrotask(run); else runtimeQueue.push(run);
  };
  const scheduleOnRN: ScheduleOnRN = (task, ...args) => {
    messages.push(args.at(-1));
    const run = () => rn.run(() => task(...args));
    if (automatic) queueMicrotask(run); else rnQueue.push(run);
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

