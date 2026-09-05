import nativeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNodeWorkletFs } from '../src/node.js';

let root: string;
beforeEach(() => { root = nativeFs.mkdtempSync(join(tmpdir(), 'fs-contract-')); });
afterEach(() => { vi.restoreAllMocks(); nativeFs.rmSync(root, { recursive: true, force: true }); });

it('completes short positioned IO and stops reads at EOF', () => {
  const read = nativeFs.readSync;
  const write = nativeFs.writeSync;
  vi.spyOn(nativeFs, 'readSync').mockImplementation(((fd, buffer, offset, length, at) => read(fd, buffer, offset, Math.min(length, 2), at)) as typeof read);
  vi.spyOn(nativeFs, 'writeSync').mockImplementation(((fd, buffer, offset, length, at) => write(fd, buffer, offset, Math.min(length, 2), at)) as typeof write);
  const fs = createNodeWorkletFs(root);
  const fd = fs.open(join(root, 'data'), 'create');
  try {
    expect(fs.writeAt(fd, Uint8Array.of(1, 2, 3, 4, 5).buffer, 0)).toBe(5);
    const output = new ArrayBuffer(8);
    expect(fs.readAt(fd, output, 0, 8)).toBe(5);
    expect([...new Uint8Array(output)]).toEqual([1, 2, 3, 4, 5, 0, 0, 0]);
  } finally { fs.close(fd); }
});

it('rejects zero-progress writes', () => {
  vi.spyOn(nativeFs, 'writeSync').mockReturnValue(0);
  const fs = createNodeWorkletFs(root);
  const fd = fs.open(join(root, 'data'), 'create');
  try { expect(() => fs.writeAt(fd, new ArrayBuffer(1), 0)).toThrow(/progress/); }
  finally { fs.close(fd); }
});

it('checks required arity for every host function', () => {
  const fs = createNodeWorkletFs(root);
  for (const [name, count] of Object.entries({ open: 2, readAt: 4, writeAt: 3, truncate: 2, size: 1, flush: 1, close: 1, mkdir: 1, readdir: 1, remove: 2, exists: 1, utf8Decode: 3, utf8Encode: 1 })) {
    const fn = fs[name as keyof typeof fs] as (...args: any[]) => unknown;
    for (let n = 0; n < count; n++) expect(() => fn(...Array(n).fill(undefined)), name).toThrow(TypeError);
  }
});

it('rejects missing trailing arguments before truncation or reads', () => {
  const fs = createNodeWorkletFs(root);
  const fd = fs.open(join(root, 'arity'), 'create');
  try {
    fs.writeAt(fd, Uint8Array.of(1, 2, 3).buffer, 0);
    expect(() => (fs.truncate as any)(fd)).toThrow(TypeError);
    expect(fs.size(fd)).toBe(3);
    expect(() => (fs.readAt as any)(fd, new ArrayBuffer(3), 0)).toThrow(TypeError);
    expect(() => (fs.writeAt as any)(fd, new ArrayBuffer(3))).toThrow(TypeError);
    expect(() => (fs.utf8Decode as any)(new ArrayBuffer(3), 0)).toThrow(TypeError);
  } finally { fs.close(fd); }
});

it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid numeric argument %s before IO', (value) => {
  const fs = createNodeWorkletFs(root);
  const b = new ArrayBuffer(4);
  for (const call of [() => fs.size(value), () => fs.flush(value), () => fs.close(value), () => fs.truncate(0, value), () => fs.readAt(0, b, value, 1), () => fs.readAt(0, b, 0, value), () => fs.writeAt(0, b, value), () => fs.utf8Decode(b, value, 4), () => fs.utf8Decode(b, 0, value)]) expect(call).toThrow(RangeError);
});

it('rejects wrong types, descriptors and overflowing ranges', () => {
  const fs = createNodeWorkletFs(root);
  expect(() => fs.size(2 ** 31)).toThrow(RangeError);
  expect(() => fs.size('0' as any)).toThrow(TypeError);
  expect(() => fs.readAt(0, new Uint8Array(4) as any, 0, 4)).toThrow(TypeError);
  expect(() => fs.writeAt(0, new ArrayBuffer(4), Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  expect(() => fs.open(join(root, 'bad'), 'bad' as any)).toThrow(TypeError);
  expect(() => fs.remove(root, 'yes' as any)).toThrow(TypeError);
});

it('rejects embedded NUL in every path argument but allows it in text', () => {
  const fs = createNodeWorkletFs(root);
  const path = `${root}/data\0suffix`;
  for (const call of [() => fs.open(path, 'create'), () => fs.exists(path), () => fs.mkdir(path), () => fs.readdir(path), () => fs.remove(path, false)]) expect(call).toThrow(TypeError);
  expect(fs.utf8Decode(fs.utf8Encode('a\0b'), 0, 3)).toBe('a\0b');
});
