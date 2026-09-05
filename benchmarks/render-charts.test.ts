import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/platforms.json';
import { renderCharts } from './render-charts.mjs';

describe('benchmark chart rendering', () => {
  it('writes accessible, static light and dark charts', async () => {
    const outputDirectory = await mkdtemp(path.join(tmpdir(), 'worklet-charts-'));
    await renderCharts(fixture, outputDirectory);

    const light = await readFile(path.join(outputDirectory, 'lag-timeline-light.svg'), 'utf8');
    const dark = await readFile(path.join(outputDirectory, 'lag-timeline-dark.svg'), 'utf8');
    const stall = await readFile(path.join(outputDirectory, 'js-thread-stall-light.svg'), 'utf8');
    const throughput = await readFile(path.join(outputDirectory, 'sustained-throughput-light.svg'), 'utf8');
    expect(light).toContain('JS thread baseline');
    expect(light).toContain('Worklet (this library)');
    expect(light).toContain('aria-label="Legend"');
    expect(light).toContain('one frame (16 ms)');
    expect(light).toContain('JS-thread lag under 4 s of sustained writes and queries (16 ms ticks)');
    expect(light).toContain('p95 = 21 ms');
    expect(light).toContain('0 s');
    expect(light).toContain('4 s');
    expect(light).toContain('iOS');
    expect(light).toContain('Android');
    expect(light).not.toContain('<script');
    expect(dark).toContain('#1a1a19');
    expect(throughput).toContain('documents written');
    expect(throughput).toContain('iterations');

    const axisTicks = [...stall.matchAll(/data-axis-tick="([^"]+)"/g)].map((match) => Number(match[1]));
    expect(axisTicks.length).toBeGreaterThan(0);
    expect(axisTicks.every(Number.isInteger)).toBe(true);
  });
});
