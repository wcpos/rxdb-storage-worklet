#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const palettes = {
  light: { surface: '#fcfcfb', primary: '#0b0b0b', secondary: '#52514e', grid: '#e6e5e1', worklet: '#2a78d6', baseline: '#eb6834' },
  dark: { surface: '#1a1a19', primary: '#ffffff', secondary: '#c3c2b7', grid: '#2e2e2c', worklet: '#3987e5', baseline: '#d95926' },
};
const series = [
  ['js-filesystem', 'JS thread baseline', 'baseline'],
  ['worklet-filesystem', 'Worklet (this library)', 'worklet'],
];
const sustainedSeries = [
  ['sustained-js-filesystem', 'JS thread baseline', 'baseline'],
  ['sustained-worklet-filesystem', 'Worklet (this library)', 'worklet'],
];
const charts = [
  ['js-thread-stall', 'How long the JS thread is blocked during the benchmark', [
    ['max lag', (mode) => mode.lag.maxLagMs],
    ['total blocked', (mode) => mode.lag.totalBlockedMs],
  ], series, 'ms'],
  ['operation-latency', 'Per-operation latency (median)', [
    ['insert 500', (mode) => mode.steps.bulkInsert500Ms],
    ['10 queries', (mode) => mode.steps.tenQueriesMs],
    ['reactive +200', (mode) => mode.steps.reactiveInsert200Ms],
  ], series, 'ms'],
  ['sustained-throughput', 'Throughput during 4 s of sustained writes and queries', [
    ['documents written', (mode) => mode.documentsWritten],
    ['iterations', (mode) => mode.iterations],
  ], sustainedSeries, ''],
];
const WIDTH = 920;
const HEIGHT = 360;
const TIMELINE_TITLE = 'JS-thread lag under 4 s of sustained writes and queries (16 ms ticks)';

const number = (value) => `${Number(value.toFixed(1))}`;
const seconds = (tick) => `${Number((tick * .016).toFixed(3))}`;
const xml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const platformTitle = (platform) => platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : platform;

function niceScale(dataMaximum) {
  const target = Math.max(1, dataMaximum * 1.15);
  const roughStep = target / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = Math.max(1, (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude);
  const maximum = Math.ceil(target / step) * step;
  return { maximum, ticks: Array.from({ length: Math.round(maximum / step) + 1 }, (_, index) => index * step) };
}

function frame(title, palette, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}"><title id="title">${xml(title)}</title><rect width="100%" height="100%" fill="${palette.surface}"/><g font-family="system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><text x="20" y="24" fill="${palette.primary}" font-size="14" font-weight="700">${xml(title)}</text><g aria-label="Legend" font-size="12" fill="${palette.secondary}"><line x1="560" x2="578" y1="20" y2="20" stroke="${palette.baseline}" stroke-width="3"/><text x="584" y="24">JS thread baseline</text><line x1="742" x2="760" y1="20" y2="20" stroke="${palette.worklet}" stroke-width="3"/><text x="766" y="24">Worklet (this library)</text></g>${content}</g></svg>\n`;
}

function panels(platforms, palette, draw) {
  return platforms.map((platform, panelIndex) => {
    const left = 20 + panelIndex * 450;
    const subtitle = [platform.device, platform.date].filter(Boolean).join(' · ') || 'recorded benchmark';
    return `<text x="${left}" y="54" fill="${palette.primary}" font-size="13" font-weight="700">${xml(platformTitle(platform.platform))}</text><text x="${left}" y="70" fill="${palette.secondary}" font-size="12">${xml(subtitle)}</text>${draw(platform, left)}`;
  }).join('');
}

function yAxis(left, top, bottom, scale, palette, unit) {
  return `<g aria-label="Y axis">${scale.ticks.map((tick) => {
    const y = bottom - tick / scale.maximum * (bottom - top);
    return `<line x1="${left + 42}" x2="${left + 424}" y1="${y}" y2="${y}" stroke="${palette.grid}"/><text x="${left + 36}" y="${y + 4}" text-anchor="end" fill="${palette.secondary}" font-size="12" data-axis-tick="${tick}">${number(tick)}</text>`;
  }).join('')}<text transform="translate(${unit ? left + 8 : left - 10} 210) rotate(-90)" fill="${palette.secondary}" font-size="12">${unit || 'count'}</text></g>`;
}

function barChart(platforms, title, categories, chartSeries, unit, palette) {
  const values = platforms.flatMap(({ modes }) => categories.flatMap(([, select]) => chartSeries.map(([key]) => select(modes[key]))));
  const scale = niceScale(Math.max(...values));
  const content = panels(platforms, palette, (platform, left) => {
    const top = 92, bottom = 308, plotHeight = bottom - top;
    const groupWidth = 382 / categories.length;
    const bars = categories.map(([label, select], categoryIndex) => {
      const center = left + 42 + groupWidth * (categoryIndex + .5);
      const positions = chartSeries.map(([key], seriesIndex) => {
        const value = select(platform.modes[key]);
        return { value, x: center - 23 + seriesIndex * 24, y: bottom - value / scale.maximum * plotHeight };
      });
      const labelsAreClose = Math.abs(positions[0].y - positions[1].y) < 14;
      const labelYs = positions.map(({ y }) => y - 5);
      if (labelsAreClose) {
        const taller = positions[0].y <= positions[1].y ? 0 : 1;
        const shorter = 1 - taller;
        labelYs[taller] -= 16 - Math.abs(labelYs[taller] - labelYs[shorter]);
      }
      const shapes = chartSeries.map(([, seriesLabel, token], seriesIndex) => {
        const { value, x, y } = positions[seriesIndex];
        const labelX = labelsAreClose ? x + (seriesIndex ? 20 : 2) : x + 11;
        const labelY = Math.max(top + 10, labelYs[seriesIndex]);
        const anchor = labelsAreClose ? (seriesIndex ? 'end' : 'start') : 'middle';
        const suffix = unit ? ` ${unit}` : '';
        return `<path d="M${x},${bottom}V${y + 4}Q${x},${y} ${x + 4},${y}H${x + 18}Q${x + 22},${y} ${x + 22},${y + 4}V${bottom}Z" fill="${palette[token]}" aria-label="${xml(`${seriesLabel}: ${number(value)}${suffix}`)}"/><text x="${labelX}" y="${labelY}" text-anchor="${anchor}" fill="${palette.primary}" font-size="12">${number(value)}${suffix}</text>`;
      }).join('');
      return `${shapes}<text x="${center}" y="330" text-anchor="middle" fill="${palette.secondary}" font-size="12">${xml(label)}</text>`;
    }).join('');
    return `${yAxis(left, top, bottom, scale, palette, unit)}${bars}`;
  });
  return frame(title, palette, content);
}

function timeline(platforms, palette) {
  const content = panels(platforms, palette, (platform, left) => {
    const top = 92, bottom = 308, start = left + 42, end = left + 424;
    const scale = niceScale(Math.max(16, ...sustainedSeries.flatMap(([key]) => platform.modes[key].lag.series)));
    const y = (value) => bottom - Math.min(value, scale.maximum) / scale.maximum * (bottom - top);
    const reference = y(16);
    const lines = sustainedSeries.map(([key, label, token]) => {
      const values = platform.modes[key].lag.series;
      const points = values.map((value, index) => `${start + index * (end - start) / Math.max(1, values.length - 1)},${y(value)}`).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${palette[token]}" stroke-width="2" aria-label="${xml(label)}"/>`;
    }).join('');
    const p95Positions = sustainedSeries.map(([key]) => ({ value: platform.modes[key].lag.p95LagMs, y: y(platform.modes[key].lag.p95LagMs) }));
    if (Math.abs(p95Positions[0].y - p95Positions[1].y) < 14) {
      p95Positions[0].y -= 7;
      p95Positions[1].y += 7;
    }
    const annotations = p95Positions.map(({ value, y: labelY }) => `<text x="${end}" y="${Math.min(bottom - 4, Math.max(top + 10, labelY))}" text-anchor="end" fill="${palette.secondary}" font-size="12">p95 = ${number(value)} ms</text>`).join('');
    const xTicks = [0, 1, 2, 3, 4].map((second) => {
      const x = start + second / 4 * (end - start);
      return `<line x1="${x}" x2="${x}" y1="${bottom}" y2="${bottom + 4}" stroke="${palette.grid}"/><text x="${x}" y="330" text-anchor="middle" fill="${palette.secondary}" font-size="12">${second} s</text>`;
    }).join('');
    return `${yAxis(left, top, bottom, scale, palette, 'ms')}<line x1="${start}" x2="${end}" y1="${reference}" y2="${reference}" stroke="${palette.secondary}" stroke-dasharray="5 4"/><text x="${start + 4}" y="${reference - 5}" fill="${palette.secondary}" font-size="12">one frame (16 ms)</text>${xTicks}${lines}${annotations}`;
  });
  return frame(TIMELINE_TITLE, palette, content);
}

function tables(platforms) {
  const output = [];
  for (const [, title, categories, chartSeries, unit] of charts) {
    output.push(`## ${title}\n\n| Platform | Metric | JS thread baseline | Worklet (this library) |\n|---|---|---:|---:|`);
    for (const platform of platforms) for (const [label, select] of categories) {
      const suffix = unit ? ` ${unit}` : '';
      output.push(`| ${platform.platform} | ${label} | ${number(select(platform.modes[chartSeries[0][0]]))}${suffix} | ${number(select(platform.modes[chartSeries[1][0]]))}${suffix} |`);
    }
  }
  output.push(`## ${TIMELINE_TITLE}\n\n| Platform | Time | JS thread baseline | Worklet (this library) |\n|---|---:|---:|---:|`);
  for (const platform of platforms) {
    const baseline = platform.modes['sustained-js-filesystem'].lag.series;
    const worklet = platform.modes['sustained-worklet-filesystem'].lag.series;
    for (let tick = 0; tick < Math.max(baseline.length, worklet.length); tick += 1) output.push(`| ${platform.platform} | ${seconds(tick)} s | ${baseline[tick] === undefined ? '—' : `${number(baseline[tick])} ms`} | ${worklet[tick] === undefined ? '—' : `${number(worklet[tick])} ms`} |`);
  }
  return `${output.join('\n')}\n`;
}

export async function renderCharts(platforms, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  for (const [theme, palette] of Object.entries(palettes)) {
    for (const [name, title, categories, chartSeries, unit] of charts) {
      await writeFile(path.join(outputDirectory, `${name}-${theme}.svg`), barChart(platforms, title, categories, chartSeries, unit, palette));
    }
    await writeFile(path.join(outputDirectory, `lag-timeline-${theme}.svg`), timeline(platforms, palette));
  }
  return tables(platforms);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const platforms = (await Promise.all(['ios.json', 'android.json'].map(async (file) => {
    try { return JSON.parse(await readFile(path.join(here, file), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }))).filter(Boolean);
  process.stdout.write(await renderCharts(platforms, path.join(here, 'charts')));
}
