import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('retains all 18 raw samples, phases and request timings while reporting medians', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'worklet-collector-'));
  await mkdir(path.join(root, 'example/scripts'), { recursive: true });
  const script = path.join(root, 'example/scripts/collect-results.mjs');
  await copyFile('example/scripts/collect-results.mjs', script);
  const modes = ['js-filesystem', 'js-memory', 'worklet-filesystem', 'worklet-memory', 'sustained-js-filesystem', 'sustained-worklet-filesystem'];
  const samples = modes.flatMap(mode => [1, 2, 3].map(sample => ({
    platform: 'ios', mode, sample, samplerIntervalMs: 16, materialisedMissedTicks: true,
    rnSerializeMs: sample, rnDispatchMs: sample * 2, roundTripMs: sample * 3,
    rnRequests: [{ requestId: 'a', sentMs: 1, replyMs: 2 }], phases: { setup: [{ startMs: 0, endMs: 10 }] },
    steps: { bulkInsert500Ms: sample, tenQueriesMs: sample, findByIds200Ms: sample, reactiveInsert200Ms: sample },
    lag: { series: [sample], samples: [{ observedMs: 16, lagMs: sample }], totalBlockedMs: sample, maxLagMs: sample, ticksOver50Ms: 0, p50LagMs: sample, p95LagMs: sample, ticksOver16Ms: 0 },
    iterations: sample, documentsWritten: sample * 50, durationMs: 4001,
    persistence: { actual: 50, pass: true },
  })));
  const log = path.join(root, 'metro.log');
  await writeFile(log, samples.map(sample => ` LOG BENCH_RESULT ${JSON.stringify(sample)}`).join('\n'));
  execFileSync(process.execPath, [script, log, 'ios']);
  const output = JSON.parse(await readFile(path.join(root, 'benchmarks/ios.json'), 'utf8'));
  expect(output.samplerIntervalMs).toBe(16);
  expect(output.materialisedMissedTicks).toBe(true);
  for (const mode of modes) {
    expect(output.modes[mode].samples).toEqual(samples.filter(sample => sample.mode === mode));
    expect(output.modes[mode]).toMatchObject({ rnSerializeMs: 2, rnDispatchMs: 4, roundTripMs: 6 });
    expect(output.modes[mode]).not.toHaveProperty('rnSendMs');
  }
});
