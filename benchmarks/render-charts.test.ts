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
    expect(light).toContain('JS thread baseline');
    expect(light).toContain('Worklet (this library)');
    expect(light).toContain('aria-label="Legend"');
    expect(light).toContain('one frame (16 ms)');
    expect(light).not.toContain('<script');
    expect(dark).toContain('#1a1a19');
  });
});
