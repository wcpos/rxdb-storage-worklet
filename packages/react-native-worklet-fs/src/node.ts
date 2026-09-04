import type { WorkletFs } from './index.js';

// Node implementation of the native surface, for tests and for running the engine in Node.
export function createNodeWorkletFs(rootDirectory: string): WorkletFs {
  const process = (globalThis as typeof globalThis & {
    process?: { getBuiltinModule?(name: string): unknown };
  }).process;
  if (!process?.getBuiltinModule) {
    throw new Error('createNodeWorkletFs requires Node.js 22 or newer.');
  }
  const {
    closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync,
    mkdirSync, openSync, readdirSync, readSync, rmSync, rmdirSync, unlinkSync,
    writeSync,
  } = process.getBuiltinModule('node:fs') as typeof import('node:fs');
  const { dirname, resolve } = process.getBuiltinModule('node:path') as typeof import('node:path');
  const root = resolve(rootDirectory);
  mkdirSync(root, { recursive: true });

  return {
    open(path, mode) {
      if (mode === 'create') mkdirSync(dirname(path), { recursive: true });
      const flags = mode === 'r'
        ? constants.O_RDONLY
        : mode === 'rw'
          ? constants.O_RDWR
          : constants.O_RDWR | constants.O_CREAT;
      return openSync(path, flags, 0o600);
    },
    readAt(fd, buffer, at, length) {
      if (length > buffer.byteLength) throw new RangeError('Read exceeds buffer');
      return readSync(fd, Buffer.from(buffer), 0, length, at);
    },
    writeAt(fd, buffer, at) {
      const bytes = Buffer.from(buffer);
      return writeSync(fd, bytes, 0, bytes.byteLength, at);
    },
    truncate: ftruncateSync,
    size(fd) {
      return fstatSync(fd).size;
    },
    flush: fsyncSync,
    close: closeSync,
    mkdir(path) {
      mkdirSync(path, { mode: 0o700 });
    },
    readdir(path) {
      return readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' as const : 'file' as const,
      }));
    },
    remove(path, recursive) {
      const info = lstatSync(path);
      if (info.isDirectory()) {
        if (recursive) rmSync(path, { recursive: true });
        else rmdirSync(path);
      } else {
        unlinkSync(path);
      }
    },
    exists(path) {
      try {
        return lstatSync(path).isDirectory() ? 'dir' : 'file';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    documentDirectory() {
      return root;
    },
    utf8Decode(buffer, start, end) {
      if (start > end || end > buffer.byteLength) throw new RangeError('Invalid UTF-8 range');
      return Buffer.from(buffer, start, end - start).toString('utf8');
    },
    utf8Encode(text) {
      const bytes = Buffer.from(text, 'utf8');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}
