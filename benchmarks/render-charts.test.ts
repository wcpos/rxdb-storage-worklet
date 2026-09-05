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
    expect(light).toContain('Sustained JS-thread lag (16 ms ticks)');
    expect(light).toContain('p95 = 29 ms');
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
  it('replaces a materialised descending run with a blocked band and uses real-sample p95', async () => {
    const platforms = structuredClone(fixture);
    platforms[0].modes['sustained-js-filesystem'].lag.series = [...Array.from({ length: 251 }, (_, i) => 4000 - i * 16), 2];
    const output = await mkdtemp(path.join(tmpdir(), 'worklet-blocked-'));
    await renderCharts(platforms, output);
    const svg = await readFile(path.join(output, 'lag-timeline-light.svg'), 'utf8');
    expect(svg).toContain('JS thread blocked for 4 s');
    expect(svg).toContain('fill="#eb6834" opacity="0.25"');
    expect(svg).toContain('of 2 real samples');
    expect(svg).toContain('p95 = 4000 ms');
    const baseline = svg.match(/<polyline[^>]+aria-label="JS thread baseline"/)!;
    expect(baseline[0].match(/points="([^"]+)"/)![1].split(' ')).toHaveLength(2);
  });

});
