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

const modeOutput = {};
for (const [mode, samples] of modes) {
  if (samples.length !== 3) {
    throw new Error(`${mode} has ${samples.length} samples; expected exactly 3.`);
  }
  const medianSample = [...samples].sort(
    (left, right) => elapsed(left) - elapsed(right),
  )[1];
  modeOutput[mode] = {
    medianSample: medianSample.sample,
    steps: {
      bulkInsert500Ms: median(samples.map((item) => item.steps.bulkInsert500Ms)),
      tenQueriesMs: median(samples.map((item) => item.steps.tenQueriesMs)),
      findByIds200Ms: median(samples.map((item) => item.steps.findByIds200Ms)),
      reactiveInsert200Ms: median(
        samples.map((item) => item.steps.reactiveInsert200Ms),
      ),
    },
    rnSendMs: median(samples.map((item) => item.rnSendMs)),
    lag: {
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
  `${JSON.stringify({ platform, modes: modeOutput }, null, 2)}\n`,
);
console.log(outputPath);
