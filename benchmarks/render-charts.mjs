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
const charts = [
  ['js-thread-stall', 'How long the JS thread is blocked during the benchmark', [
    ['max lag', (mode) => mode.lag.maxLagMs],
    ['total blocked', (mode) => mode.lag.totalBlockedMs],
  ]],
  ['operation-latency', 'Per-operation latency (median)', [
    ['insert 500', (mode) => mode.steps.bulkInsert500Ms],
    ['10 queries', (mode) => mode.steps.tenQueriesMs],
    ['reactive +200', (mode) => mode.steps.reactiveInsert200Ms],
  ]],
];
const WIDTH = 920;
const HEIGHT = 360;

const number = (value) => `${Number(value.toFixed(1))}`;
const xml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

function frame(title, palette, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}"><title id="title">${xml(title)}</title><rect width="100%" height="100%" fill="${palette.surface}"/><g font-family="system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><text x="20" y="24" fill="${palette.primary}" font-size="14" font-weight="700">${xml(title)}</text><g aria-label="Legend" font-size="12" fill="${palette.secondary}"><line x1="560" x2="578" y1="20" y2="20" stroke="${palette.baseline}" stroke-width="3"/><text x="584" y="24">JS thread baseline</text><line x1="742" x2="760" y1="20" y2="20" stroke="${palette.worklet}" stroke-width="3"/><text x="766" y="24">Worklet (this library)</text></g>${content}</g></svg>\n`;
}

function panels(platforms, palette, draw) {
  return platforms.map((platform, panelIndex) => {
    const left = 20 + panelIndex * 450;
    const subtitle = [platform.device, platform.date].filter(Boolean).join(' · ') || 'recorded benchmark';
    return `<text x="${left}" y="54" fill="${palette.primary}" font-size="13" font-weight="700">${xml(platform.platform.toUpperCase())}</text><text x="${left}" y="70" fill="${palette.secondary}" font-size="12">${xml(subtitle)}</text>${draw(platform, left)}`;
  }).join('');
}

function barChart(platforms, title, categories, palette) {
  const values = platforms.flatMap(({ modes }) => categories.flatMap(([, select]) => series.map(([key]) => select(modes[key]))));
  const maximum = Math.max(...values) * 1.15 || 1;
  const content = panels(platforms, palette, (platform, left) => {
    const top = 92, bottom = 308, plotHeight = bottom - top;
    const grid = [0, .25, .5, .75, 1].map((fraction) => {
      const y = bottom - fraction * plotHeight;
      return `<line x1="${left + 42}" x2="${left + 424}" y1="${y}" y2="${y}" stroke="${palette.grid}"/><text x="${left + 36}" y="${y + 4}" text-anchor="end" fill="${palette.secondary}" font-size="12">${number(maximum * fraction)}</text>`;
    }).join('');
    const groupWidth = 382 / categories.length;
    const bars = categories.map(([label, select], categoryIndex) => {
      const center = left + 42 + groupWidth * (categoryIndex + .5);
      const shapes = series.map(([key, seriesLabel, token], seriesIndex) => {
        const value = select(platform.modes[key]);
        const x = center - 23 + seriesIndex * 24, y = bottom - value / maximum * plotHeight;
        return `<path d="M${x},${bottom}V${y + 4}Q${x},${y} ${x + 4},${y}H${x + 18}Q${x + 22},${y} ${x + 22},${y + 4}V${bottom}Z" fill="${palette[token]}" aria-label="${xml(`${seriesLabel}: ${number(value)} ms`)}"/><text x="${x + 11}" y="${Math.max(top + 10, y - 5)}" text-anchor="middle" fill="${palette.primary}" font-size="12">${number(value)} ms</text>`;
      }).join('');
      return `${shapes}<text x="${center}" y="330" text-anchor="middle" fill="${palette.secondary}" font-size="12">${xml(label)}</text>`;
    }).join('');
    return `${grid}<text transform="translate(${left + 8} 210) rotate(-90)" fill="${palette.secondary}" font-size="12">ms</text>${bars}`;
  });
  return frame(title, palette, content);
}

function timeline(platforms, title, palette) {
  const content = panels(platforms, palette, (platform, left) => {
    const top = 92, bottom = 308, start = left + 42, end = left + 424;
    const maximum = Math.max(16, ...series.flatMap(([key]) => platform.modes[key].lag.series));
    const y = (value) => bottom - value / maximum * (bottom - top);
    const reference = y(16);
    const lines = series.map(([key, label, token]) => {
      const values = platform.modes[key].lag.series;
      const points = values.map((value, index) => `${start + index * (end - start) / Math.max(1, values.length - 1)},${y(Math.min(value, maximum))}`).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${palette[token]}" stroke-width="2" aria-label="${xml(label)}"/>`;
    }).join('');
    return `<line x1="${start}" x2="${end}" y1="${bottom}" y2="${bottom}" stroke="${palette.grid}"/><line x1="${start}" x2="${end}" y1="${reference}" y2="${reference}" stroke="${palette.secondary}" stroke-dasharray="5 4"/><text x="${end}" y="${reference - 5}" text-anchor="end" fill="${palette.secondary}" font-size="12">one frame (16 ms)</text><text x="${left + 8}" y="${top + 4}" fill="${palette.secondary}" font-size="12">${number(maximum)} ms</text><text x="${start}" y="330" fill="${palette.secondary}" font-size="12">tick 1</text><text x="${end}" y="330" text-anchor="end" fill="${palette.secondary}" font-size="12">tick</text>${lines}`;
  });
  return frame(title, palette, content);
}

function tables(platforms) {
  const output = [];
  for (const [name, title, categories] of charts) {
    output.push(`## ${title}\n\n| Platform | Metric | JS thread baseline | Worklet (this library) |\n|---|---|---:|---:|`);
    for (const platform of platforms) for (const [label, select] of categories) output.push(`| ${platform.platform} | ${label} | ${number(select(platform.modes['js-filesystem']))} ms | ${number(select(platform.modes['worklet-filesystem']))} ms |`);
  }
  output.push('## JS-thread lag per 50 ms tick during one run\n\n| Platform | Tick | JS thread baseline | Worklet (this library) |\n|---|---:|---:|---:|');
  for (const platform of platforms) {
    const baseline = platform.modes['js-filesystem'].lag.series, worklet = platform.modes['worklet-filesystem'].lag.series;
    for (let tick = 0; tick < Math.max(baseline.length, worklet.length); tick += 1) output.push(`| ${platform.platform} | ${tick + 1} | ${baseline[tick] === undefined ? '—' : `${number(baseline[tick])} ms`} | ${worklet[tick] === undefined ? '—' : `${number(worklet[tick])} ms`} |`);
  }
  return `${output.join('\n')}\n`;
}

export async function renderCharts(platforms, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  for (const [theme, palette] of Object.entries(palettes)) {
    for (const [name, title, categories] of charts) await writeFile(path.join(outputDirectory, `${name}-${theme}.svg`), barChart(platforms, title, categories, palette));
    await writeFile(path.join(outputDirectory, `lag-timeline-${theme}.svg`), timeline(platforms, 'JS-thread lag per 50 ms tick during one run', palette));
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
