import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWorkletFs } from '../src/index.js';
import { createNodeWorkletFs } from '../src/node.js';

describe('createNodeWorkletFs', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'worklet-fs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete (globalThis as { __workletFs?: unknown }).__workletFs;
  });

  it('preserves Node error codes for missing paths and bad descriptors', () => {
    const fs = createNodeWorkletFs(root);
    expect(() => fs.open(join(root, 'missing'), 'r')).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
    fs.mkdir(join(root, 'directory'));
    expect(() => fs.mkdir(join(root, 'directory'))).toThrow(
      expect.objectContaining({ code: 'EEXIST' }),
    );
    const fd = fs.open(join(root, 'file'), 'create');
    fs.close(fd);
    expect(() => fs.size(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }));
  });

  it('reports directory-entry kinds', () => {
    const fs = createNodeWorkletFs(root);
    fs.mkdir(join(root, 'directory'));
    fs.close(fs.open(join(root, 'file'), 'create'));
    expect(fs.readdir(root).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'directory', kind: 'dir' },
      { name: 'file', kind: 'file' },
    ]);
  });

  it('round trips UTF-8 bytes', () => {
    const fs = createNodeWorkletFs(root);
    const text = 'ASCII € 🪽';
    const encoded = fs.utf8Encode(text);
    expect(fs.utf8Decode(encoded, 0, encoded.byteLength)).toBe(text);
  });

  it('gets the installed host object or names installWorkletFs in its error', () => {
    expect(() => getWorkletFs()).toThrow(/installWorkletFs/);
    const fs = createNodeWorkletFs(root);
    (globalThis as { __workletFs?: unknown }).__workletFs = fs;
    expect(getWorkletFs()).toBe(fs);
  });
});
