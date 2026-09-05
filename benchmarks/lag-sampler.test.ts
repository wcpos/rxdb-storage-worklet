import { afterEach, expect, it, vi } from 'vitest';
import { lagSampler } from '../example/src/lag-sampler';

afterEach(() => vi.restoreAllMocks());
it('materialises missed 16 ms ticks without pretending they are timer callbacks', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let tick!: () => void;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void, ms: number) => {
    expect(ms).toBe(16); tick = callback; return 1;
  }) as any);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  const stop = lagSampler();
  now = 70; tick();
  now = 75; tick(); // early callback must not invent another scheduled tick
  const lag = stop();
  expect(lag.series).toEqual([54, 38, 22, 6]);
  expect(lag.samples.map(s => s.materialised)).toEqual([false, true, true, true]);
  expect(lag.samples[0]).toMatchObject({ scheduledMs: 16, observedMs: 70, source: 'timer' });
  expect(lag.totalBlockedMs).toBe(54); // not the sum of overlapping missed-tick delays
});
