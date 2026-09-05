import type { WorkletFs } from './index.js';

function arity(count: number, required: number): void {
  if (count < required) throw new TypeError(`Expected at least ${required} arguments`);
}
function integer(value: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number') throw new TypeError('Expected number');
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError('Invalid integer range');
  return value;
}
function pathArg(path: string): void {
  if (typeof path !== 'string' || path.includes('\0')) throw new TypeError('Expected path without NUL');
}
function bufferArg(buffer: ArrayBuffer): void {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Expected ArrayBuffer');
}

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
      arity(arguments.length, 2);
      pathArg(path);
      if (!['r', 'rw', 'create'].includes(mode)) throw new TypeError('Invalid open mode');
      if (mode === 'create') mkdirSync(dirname(path), { recursive: true });
      const flags = mode === 'r'
        ? constants.O_RDONLY
        : mode === 'rw'
          ? constants.O_RDWR
          : constants.O_RDWR | constants.O_CREAT;
      return openSync(path, flags, 0o600);
    },
    readAt(fd, buffer, at, length) {
      arity(arguments.length, 4);
      integer(fd, 0x7fffffff); bufferArg(buffer); integer(at); integer(length, buffer.byteLength);
      integer(at + length);
      let total = 0;
      while (total < length) {
        const count = readSync(fd, Buffer.from(buffer), total, length - total, at + total);
        if (count === 0) break; // EOF is the only successful short read.
        total += count;
      }
      return total;
    },
    writeAt(fd, buffer, at) {
      arity(arguments.length, 3);
      integer(fd, 0x7fffffff); bufferArg(buffer); integer(at); integer(at + buffer.byteLength);
      const bytes = Buffer.from(buffer);
      let total = 0;
      while (total < bytes.byteLength) {
        const count = writeSync(fd, bytes, total, bytes.byteLength - total, at + total);
        if (count === 0) throw new Error('write made no progress');
        total += count;
      }
      return total;
    },
    truncate(fd, size) {
      arity(arguments.length, 2);
      ftruncateSync(integer(fd, 0x7fffffff), integer(size));
    },
    size(fd) {
      arity(arguments.length, 1);
      return fstatSync(integer(fd, 0x7fffffff)).size;
    },
    flush(fd) {
      arity(arguments.length, 1);
      fsyncSync(integer(fd, 0x7fffffff));
    },
    close(fd) {
      arity(arguments.length, 1);
      closeSync(integer(fd, 0x7fffffff));
    },
    mkdir(path) {
      arity(arguments.length, 1); pathArg(path);
      mkdirSync(path, { mode: 0o700 });
    },
    readdir(path) {
      arity(arguments.length, 1); pathArg(path);
      return readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' as const : 'file' as const,
      }));
    },
    remove(path, recursive) {
      arity(arguments.length, 2); pathArg(path);
      if (typeof recursive !== 'boolean') throw new TypeError('Expected boolean');
      const info = lstatSync(path);
      if (info.isDirectory()) {
        if (recursive) rmSync(path, { recursive: true });
        else rmdirSync(path);
      } else {
        unlinkSync(path);
      }
    },
    exists(path) {
      arity(arguments.length, 1); pathArg(path);
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
      arity(arguments.length, 3); bufferArg(buffer); integer(start, buffer.byteLength); integer(end, buffer.byteLength);
      if (start > end || end > buffer.byteLength) throw new RangeError('Invalid UTF-8 range');
      return Buffer.from(buffer, start, end - start).toString('utf8');
    },
    utf8Encode(text) {
      arity(arguments.length, 1);
      if (typeof text !== 'string') throw new TypeError('Expected string');
      const bytes = Buffer.from(text, 'utf8');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}
