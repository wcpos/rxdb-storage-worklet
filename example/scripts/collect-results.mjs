#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , inputArgument, platformArgument] = process.argv;
if (!inputArgument) {
  throw new Error('Usage: node scripts/collect-results.mjs <metro-log> [ios|android]');
}

const input = await readFile(path.resolve(inputArgument), 'utf8');
const results = input
  .split(/\r?\n/)
  .flatMap((line) => {
    const marker = line.indexOf('BENCH_RESULT ');
    if (marker < 0) return [];
    try {
      return [JSON.parse(line.slice(marker + 'BENCH_RESULT '.length))];
    } catch (error) {
      throw new Error(`Invalid BENCH_RESULT line: ${error.message}`);
    }
  });

if (!results.length) throw new Error('No BENCH_RESULT lines found.');
const platform = platformArgument ?? results[0].platform;
const platformResults = results.filter((result) => result.platform === platform);
const modes = new Map();
for (const result of platformResults) {
  const samples = modes.get(result.mode) ?? [];
  samples.push(result);
  modes.set(result.mode, samples);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function elapsed(result) {
  return Object.values(result.steps).reduce((sum, value) => sum + value, 0);
}

if (modes.size !== 6) throw new Error(`Expected six modes, got ${modes.size}`);
const modeOutput = {};
for (const [mode, samples] of modes) {
  if (samples.length !== 3) {
    throw new Error(`${mode} has ${samples.length} samples; expected exactly 3.`);
  }
  if (new Set(samples.map(s => s.sample)).size !== 3 || samples.some(s => s.samplerIntervalMs !== 16 || s.materialisedMissedTicks !== true || !s.phases || !s.lag.samples)) throw new Error(`${mode}: incomplete corrected measurements`);
  const timing = Object.fromEntries(['rnSerializeMs', 'rnDispatchMs', 'roundTripMs'].map(key => [key, median(samples.map(s => s[key]))]));
  if (mode.startsWith('sustained-')) {
    const medianSample = [...samples].sort(
      (left, right) => left.lag.p95LagMs - right.lag.p95LagMs,
    )[1];
    modeOutput[mode] = {
      samples, ...timing,
      durationMs: median(samples.map(s => s.durationMs)),
      medianSample: medianSample.sample,
      iterations: median(samples.map((item) => item.iterations)),
      documentsWritten: median(samples.map((item) => item.documentsWritten)),
      lag: {
        ...medianSample.lag,
        p50LagMs: median(samples.map((item) => item.lag.p50LagMs)),
        p95LagMs: median(samples.map((item) => item.lag.p95LagMs)),
        maxLagMs: median(samples.map((item) => item.lag.maxLagMs)),
        ticksOver16Ms: median(samples.map((item) => item.lag.ticksOver16Ms)),
        ticksOver50Ms: median(samples.map((item) => item.lag.ticksOver50Ms)),
        series: medianSample.lag.series,
      },
    };
    continue;
  }
  const medianSample = [...samples].sort(
    (left, right) => elapsed(left) - elapsed(right),
  )[1];
  modeOutput[mode] = {
    samples, ...timing,
    medianSample: medianSample.sample,
    steps: {
      bulkInsert500Ms: median(samples.map((item) => item.steps.bulkInsert500Ms)),
      tenQueriesMs: median(samples.map((item) => item.steps.tenQueriesMs)),
      findByIds200Ms: median(samples.map((item) => item.steps.findByIds200Ms)),
      reactiveInsert200Ms: median(
        samples.map((item) => item.steps.reactiveInsert200Ms),
      ),
    },
    lag: {
      ...medianSample.lag,
      totalBlockedMs: median(samples.map((item) => item.lag.totalBlockedMs)),
      maxLagMs: median(samples.map((item) => item.lag.maxLagMs)),
      ticksOver50Ms: median(samples.map((item) => item.lag.ticksOver50Ms)),
      series: medianSample.lag.series,
    },
    persistence: {
      expected: 50,
      actual: median(samples.map((item) => item.persistence.actual)),
      pass: samples.every((item) => item.persistence.pass),
    },
  };
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const benchmarksDirectory = path.join(repoRoot, 'benchmarks');
const outputPath = path.join(benchmarksDirectory, `${platform}.json`);
await mkdir(benchmarksDirectory, { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({
    platform,
    samplerIntervalMs: 16,
    materialisedMissedTicks: true,
    queryStrategy: platformResults[0].queryStrategy,
    timingSummary: 'Median of three per-run request medians; raw matching request timings retained. RN stringify only; dispatch call only; round trip starts before serialization and ends at matching reply entry.',
    lagScope: 'Short: setup through persistence. Sustained: loop only. Terminal stop observations included; synthetic ticks marked. totalBlockedMs sums real lateness, not overlapping synthetic delays.',
    replacesIncompleteWorkload: true,
    device: platform === 'ios'
      ? 'iPhone simulator'
      : 'Pixel Tablet API 35 emulator',
    date: new Date().toISOString().slice(0, 10),
    modes: modeOutput,
  }, null, 2)}\n`,
);
console.log(outputPath);
