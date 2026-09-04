import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeWorkletFs } from 'react-native-worklet-fs/node';
import {
  createAbstractFilesystemAdapter,
  createPromiseQueueLock,
  createWorkletOpfs,
  installWorkletRuntimePolyfills,
} from '../src/index.js';

describe('worklet OPFS', () => {
  let root: string;
  let fs: ReturnType<typeof createNodeWorkletFs>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'worklet-opfs-'));
    fs = createNodeWorkletFs(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each(['', '.', '..', 'a/b', 'a\\b'])('rejects the invalid name %j', async (name) => {
    const directory = await createWorkletOpfs({ fs }).getDirectory();
    await expect(directory.getFileHandle(name)).rejects.toBeInstanceOf(TypeError);
    await expect(directory.getDirectoryHandle(name)).rejects.toBeInstanceOf(TypeError);
  });

  it('uses the specified DOMException names', async () => {
    const directory = await createWorkletOpfs({ fs }).getDirectory();
    await expect(directory.getFileHandle('missing')).rejects.toMatchObject({ name: 'NotFoundError' });
    await directory.getDirectoryHandle('same', { create: true });
    await expect(directory.getFileHandle('same')).rejects.toMatchObject({ name: 'TypeMismatchError' });
    const file = await directory.getFileHandle('file', { create: true });
    const access = await file.createSyncAccessHandle();
    await expect(file.createSyncAccessHandle()).rejects.toMatchObject({ name: 'NoModificationAllowedError' });
    access.close();
    expect(() => access.getSize()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('implements cursor, positioned IO, truncation, and zero-padding', async () => {
    const directory = await createWorkletOpfs({ fs }).getDirectory();
    const file = await directory.getFileHandle('data', { create: true });
    const access = await file.createSyncAccessHandle();
    expect(access.write(Uint8Array.of(1, 2))).toBe(2);
    expect(access.write(Uint8Array.of(3))).toBe(1);
    expect(access.write(Uint8Array.of(9), { at: 5 })).toBe(1);
    expect(access.getSize()).toBe(6);
    const output = new Uint8Array(6);
    expect(access.read(output, { at: 0 })).toBe(6);
    expect([...output]).toEqual([1, 2, 3, 0, 0, 9]);
    access.truncate(2);
    expect(access.getSize()).toBe(2);
    access.write(Uint8Array.of(8));
    expect(access.getSize()).toBe(3);
    access.flush();
    access.close();
  });

  it('blocks removal while open and removes closed files', async () => {
    const directory = await createWorkletOpfs({ fs }).getDirectory();
    const file = await directory.getFileHandle('data', { create: true });
    const access = await file.createSyncAccessHandle();
    await expect(directory.removeEntry('data')).rejects.toMatchObject({ name: 'NoModificationAllowedError' });
    access.close();
    await directory.removeEntry('data');
    await expect(directory.getFileHandle('data')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('adapts read, write, truncate, and size operations', async () => {
    const adapter = createAbstractFilesystemAdapter(createWorkletOpfs({ fs }));
    expect(adapter.useAsyncApi).toBe(false);
    const directory = await adapter.getDirectory();
    const file = await directory.getFileHandle('data', { create: true });
    const access = await file.createAccessHandle();
    await access.write(Uint8Array.of(1, 2, 3), { at: 0 });
    expect([...await access.read(1)]).toEqual([2, 3]);
    await access.truncate(2);
    expect(await access.getSize()).toBe(2);
    await access.close();
  });

  it('installs UTF-8 polyfills only when absent', () => {
    const original = {
      DOMException: globalThis.DOMException,
      TextDecoder: globalThis.TextDecoder,
      TextEncoder: globalThis.TextEncoder,
    };
    try {
      Object.assign(globalThis, { DOMException: undefined, TextDecoder: undefined, TextEncoder: undefined });
      expect(installWorkletRuntimePolyfills({ fs }).sort()).toEqual(['DOMException', 'TextDecoder', 'TextEncoder']);
      expect(installWorkletRuntimePolyfills({ fs })).toEqual([]);
      const text = '€🪽';
      const bytes = new TextEncoder().encode(text);
      expect([...bytes]).toEqual([226, 130, 172, 240, 159, 170, 189]);
      expect(new TextDecoder().decode(bytes)).toBe(text);
    } finally {
      Object.assign(globalThis, original);
    }
  });

  it('serializes promise lock requests independently by name', async () => {
    const lock = createPromiseQueueLock();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.request('a', async () => { events.push('first'); await gate; });
    const second = lock.request('a', async () => { events.push('second'); });
    await lock.request('b', async () => { events.push('other'); });
    expect(events).toEqual(['first', 'other']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first', 'other', 'second']);
  });
});
