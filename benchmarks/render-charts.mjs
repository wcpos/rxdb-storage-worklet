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
  ['js-thread-stall', 'Whole short benchmark: RN timer lateness', [
    ['max lag', (mode) => mode.lag.maxLagMs],
    ['sum of real lateness', (mode) => mode.lag.totalBlockedMs],
  ], series, 'ms'],
  ['operation-latency', 'Per-operation latency (median)', [
    ['insert 500', (mode) => mode.steps.bulkInsert500Ms],
    ['10 queries', (mode) => mode.steps.tenQueriesMs],
    ['find 200 IDs', (mode) => mode.steps.findByIds200Ms],
    ['reactive +200', (mode) => mode.steps.reactiveInsert200Ms],
  ], series, 'ms'],
  ['sustained-throughput', 'Throughput during 4 s of sustained writes and queries', [
    ['documents written', (mode) => mode.documentsWritten],
    ['iterations', (mode) => mode.iterations],
  ], sustainedSeries, ''],
];
const WIDTH = 920;
const HEIGHT = 360;
const TIMELINE_TITLE = 'Sustained JS-thread lag (16 ms ticks)';

const number = (value) => `${Number(value.toFixed(1))}`;
const seconds = (tick) => `${Number(((tick + 1) * .016).toFixed(3))}`;
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
  }).join('')}<text transform="translate(${left - 7} 210) rotate(-90)" fill="${palette.secondary}" font-size="12">${unit || 'count'}</text></g>`;
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
      const shapes = chartSeries.map(([, seriesLabel, token], seriesIndex) => {
        const { value, x, y } = positions[seriesIndex];
        const labelX = x + (seriesIndex ? 2 : 20);
        const labelY = Math.max(top + 10, y - 5);
        const anchor = seriesIndex ? 'start' : 'end';
        const suffix = unit ? ` ${unit}` : '';
        return `<path d="M${x},${bottom}V${y + 4}Q${x},${y} ${x + 4},${y}H${x + 18}Q${x + 22},${y} ${x + 22},${y + 4}V${bottom}Z" fill="${palette[token]}" aria-label="${xml(`${seriesLabel}: ${number(value)}${suffix}`)}"/><text x="${labelX}" y="${labelY}" text-anchor="${anchor}" fill="${palette.primary}" font-size="12">${number(value)}</text>`;
      }).join('');
      return `${shapes}<text x="${center}" y="330" text-anchor="middle" fill="${palette.secondary}" font-size="12">${xml(label)}</text>`;
    }).join('');
    return `${yAxis(left, top, bottom, scale, palette, unit)}${bars}`;
  });
  return frame(title, palette, content);
}

function timeline(platforms, palette) {
  const content = panels(platforms, palette, (platform, left) => {
    const top = 120, bottom = 308, start = left + 42, end = left + 424;
    const scale = niceScale(Math.max(16, ...sustainedSeries.flatMap(([key]) => platform.modes[key].lag.series)));
    const y = (value) => bottom - Math.min(value, scale.maximum) / scale.maximum * (bottom - top);
    const reference = y(16);
    const data = sustainedSeries.map(([key, label, token]) => {
      const lag = platform.modes[key].lag;
      const values = lag.series;
      const real = [], blocked = [];
      for (let i = 0; i < values.length; i++) {
        const sample = lag.samples?.[i];
        const inferred = i > 0 && Math.abs(values[i - 1] - values[i] - 16) < 0.001;
        if (sample?.materialised ?? inferred) continue;
        const scheduled = sample ? sample.scheduledMs - lag.startMs : (i + 1) * 16;
        const observed = sample ? sample.observedMs - lag.startMs : scheduled + values[i];
        real.push({ time: observed, value: values[i] });
        if (i + 1 < values.length && (lag.samples?.[i + 1]?.materialised ?? Math.abs(values[i] - values[i + 1] - 16) < 0.001)) blocked.push({ start: scheduled, end: observed });
      }
      const sorted = real.map(p => p.value).sort((a, b) => a - b);
      return { label, token, real, blocked, p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0 };
    });
    const duration = Math.max(4000, ...data.flatMap(d => d.real.map(p => p.time)));
    const x = ms => start + ms / duration * (end - start);
    const bands = `<g opacity="0.25">${data.map(({ blocked, label, token }) => blocked.map(span => `<rect x="${x(span.start)}" y="${top}" width="${x(span.end) - x(span.start)}" height="${bottom - top}" fill="${palette[token]}"><title>${xml(label)}: JS thread blocked for ${Number(((span.end - span.start) / 1000).toFixed(3))} s</title></rect>`).join('')).join('')}</g>`;
    // Label only the longest span per series; every band has an accessible per-span title.
    const labels = data.map(({ blocked, token }, index) => {
      const span = [...blocked].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
      return span ? `<text x="${start + 4}" y="${top + 16 + index * 16}" fill="${palette[token]}" font-size="12">JS thread blocked for ${Number(((span.end - span.start) / 1000).toFixed(3))} s</text>` : '';
    }).join('');
    const lines = data.map(({ real, label, token }) => `<polyline points="${real.map(p => `${x(p.time)},${y(p.value)}`).join(' ')}" fill="none" stroke="${palette[token]}" stroke-width="2" aria-label="${xml(label)}"/>`).join('');
    const annotations = data.map(({ p95, real, token }, index) => `<text x="${start + 4}" y="${86 + index * 14}" fill="${palette[token]}" font-size="11">p95 = ${number(p95)} ms of ${real.length} real samples</text>`).join('');
    const xTicks = [0, 1, 2, 3, 4].map((second) => {
      const x = start + second * 1000 / duration * (end - start);
      return `<line x1="${x}" x2="${x}" y1="${bottom}" y2="${bottom + 4}" stroke="${palette.grid}"/><text x="${x}" y="330" text-anchor="middle" fill="${palette.secondary}" font-size="12">${second} s</text>`;
    }).join('');
    return `${bands}${yAxis(left, top, bottom, scale, palette, 'ms')}<line x1="${start}" x2="${end}" y1="${reference}" y2="${reference}" stroke="${palette.secondary}" stroke-dasharray="5 4"/><text x="${start + 4}" y="${reference - 5}" fill="${palette.secondary}" font-size="12">one frame (16 ms)</text>${xTicks}${lines}<g aria-label="Timeline subtitle">${annotations}</g>${labels}`;
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
  output.push(`## ${TIMELINE_TITLE}\n\n| Platform | Scheduled tick (includes materialised ticks) | JS thread baseline | Worklet (this library) |\n|---|---:|---:|---:|`);
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
