#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkout = path.join(root, 'conformance/.rxdb');
const tag = '17.4.0';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, env: options.env ?? process.env, encoding: 'utf8', stdio: options.stdio ?? 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  return result;
}

async function prepareCheckout() {
  await mkdir(path.dirname(checkout), { recursive: true });
  if (!existsSync(path.join(checkout, '.git'))) run('git', ['clone', '--depth', '1', '--branch', tag, 'https://github.com/pubkey/rxdb', checkout]);
  const actualTag = run('git', ['describe', '--tags', '--exact-match'], { cwd: checkout, stdio: 'pipe' }).stdout.trim();
  if (actualTag !== tag) throw new Error(`Cached RxDB checkout is ${actualTag}, expected ${tag}`);
  if (!existsSync(path.join(checkout, 'node_modules/.bin/mocha'))) run('npm', ['install', '--ignore-scripts', '--no-package-lock'], { cwd: checkout });
  if (!existsSync(path.join(checkout, 'node_modules/rxdb-premium/package.json'))) run('npm', ['install', '--ignore-scripts', '--no-save', '--no-package-lock', `rxdb-premium@${tag}`], { cwd: checkout });

  if (!process.env.RXDB_PREMIUM) {
    const commonGitDirectory = run('git', ['rev-parse', '--git-common-dir'], { stdio: 'pipe' }).stdout.trim();
    const envFiles = [path.join(root, '.env'), path.join(path.dirname(commonGitDirectory), '.env')];
    const envFile = envFiles.find(existsSync);
    if (envFile) {
      const match = (await readFile(envFile, 'utf8')).match(/^\s*(?:export\s+)?RXDB_PREMIUM\s*=\s*(.*)$/m);
      if (match) process.env.RXDB_PREMIUM = match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  const premiumMarker = path.join(checkout, 'node_modules/rxdb-premium/dist/esm/plugins/storage-abstract-filesystem/index.js');
  if (!existsSync(premiumMarker)) {
    if (!process.env.RXDB_PREMIUM) throw new Error('RXDB_PREMIUM is required for the conformance suite.');
    const scripts = path.join(checkout, 'node_modules/rxdb-premium/scripts');
    run(process.execPath, [path.join(scripts, 'postinstall.js')], { cwd: checkout, stdio: 'ignore' });
    run(process.execPath, [path.join(scripts, 'installer.js')], { cwd: checkout, stdio: 'ignore' });
  }

  run('pnpm', ['build']);
  await cp(path.join(root, 'conformance/storage-entry.ts'), path.join(checkout, 'test/unit/worklet-opfs-storage.ts'));
  const schedulers = await readFile(path.join(root, 'packages/rxdb-storage-worklet/test/fake-schedulers.ts'), 'utf8');
  await writeFile(path.join(checkout, 'test/unit/worklet-fake-schedulers.ts'), schedulers.replace('../src/index.js', '../../../../packages/rxdb-storage-worklet/lib/index.js'));
  await cp(path.join(root, 'conformance/binary-attachments.ts'), path.join(checkout, 'test/unit/worklet-binary-attachments.test.ts'));
  const configPath = path.join(checkout, 'test/unit/config.ts');
  let config = await readFile(configPath, 'utf8');
  if (!config.includes("./worklet-opfs-storage.ts")) config = config.replace("import { CUSTOM_STORAGE } from './custom-storage.ts';", "import { CUSTOM_STORAGE } from './custom-storage.ts';\nimport { WORKLET_STORAGE } from './worklet-opfs-storage.ts';");
  if (!config.includes("case 'worklet-opfs':")) config = config.replace('    switch (storageKey) {', "    switch (storageKey) {\n        case 'worklet-opfs': return WORKLET_STORAGE as any;");
  await writeFile(configPath, config);
  run('npm', ['run', 'transpile'], { cwd: checkout });
  run('npm', ['run', 'build:plugins'], { cwd: checkout });
}

function runSuite(backend) {
  const result = spawnSync(process.execPath, ['--expose-gc', 'node_modules/mocha/bin/mocha.js', '--config', './config/.mocharc.cjs', './test_tmp/unit/rx-storage-implementations.test.js', './test_tmp/unit/worklet-binary-attachments.test.js', '--reporter', 'json', '--no-bail'], {
    cwd: checkout,
    env: { ...process.env, DEFAULT_STORAGE: 'worklet-opfs', WORKLET_STORAGE_BACKEND: backend },
    encoding: 'utf8',
  });
  const jsonStart = result.stdout.lastIndexOf('{\n  "stats":');
  if (jsonStart < 0) throw new Error(`Mocha did not produce JSON results for ${backend}: ${result.stderr}`);
  const report = JSON.parse(result.stdout.slice(jsonStart));
  console.log(`CONFORMANCE ${backend}: ${report.stats.passes} passed, ${report.stats.failures} failed, ${report.stats.pending} pending`);
  if (report.failures.length) for (const failure of report.failures) console.error(`FAIL ${failure.fullTitle}: ${failure.err.message}`);
  if (result.status !== 0 && !report.stats.failures) throw new Error(`Mocha ${backend} exited ${result.status}`);
  return report.stats.failures;
}

await prepareCheckout();
const failures = runSuite('memory') + runSuite('filesystem');
if (failures) process.exitCode = 1;
