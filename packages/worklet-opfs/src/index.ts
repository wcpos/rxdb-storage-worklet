import { getWorkletFs, type WorkletFs } from 'react-native-worklet-fs';

type WorkletBuffer = ArrayBuffer | ArrayBufferView;
type HandleOptions = { create?: boolean };
type IoOptions = { at?: number };

const NOT_FOUND = 'A requested file or directory could not be found at the time an operation was processed.';
const openPaths = new Set<string>();

function validName(name: string): boolean {
  return !name.includes('\0') && name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}

function exception(message: string, name: string): DOMException {
  return new globalThis.DOMException(message, name);
}

function bytes(buffer: WorkletBuffer): Uint8Array {
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function arrayBuffer(view: Uint8Array): ArrayBuffer {
  if (view.buffer instanceof ArrayBuffer && view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer;
  }
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function sha256(input: WorkletBuffer): ArrayBuffer {
  const source = bytes(input);
  const data = new Uint8Array(Math.ceil((source.byteLength + 9) / 64) * 64);
  data.set(source);
  data[source.byteLength] = 0x80;
  const view = new DataView(data.buffer);
  const bits = source.byteLength * 8;
  view.setUint32(data.byteLength - 8, Math.floor(bits / 0x100000000));
  view.setUint32(data.byteLength - 4, bits);
  const primes: number[] = [];
  for (let candidate = 2; primes.length < 64; candidate++) {
    if (!primes.some((prime) => candidate % prime === 0)) primes.push(candidate);
  }
  const constants = primes.map((prime) => ((Math.cbrt(prime) % 1) * 0x100000000) | 0);
  const hash = primes.slice(0, 8).map((prime) => ((Math.sqrt(prime) % 1) * 0x100000000) | 0);
  const rotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  for (let offset = 0; offset < data.byteLength; offset += 64) {
    const words = Array.from({ length: 64 }, (_, index) => index < 16 ? view.getInt32(offset + index * 4) : 0);
    for (let index = 16; index < 64; index++) {
      const x = words[index - 15]!;
      const y = words[index - 2]!;
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) | 0;
    }
    let a = hash[0]!, b = hash[1]!, c = hash[2]!, d = hash[3]!;
    let e = hash[4]!, f = hash[5]!, g = hash[6]!, h = hash[7]!;
    for (let index = 0; index < 64; index++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index]! + words[index]!) | 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + sum0 + majority) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => { hash[index] = (hash[index]! + value) | 0; });
  }
  const output = new ArrayBuffer(32);
  hash.forEach((value, index) => new DataView(output).setInt32(index * 4, value));
  return output;
}

export class WorkletFileSystemSyncAccessHandle {
  private closed = false;
  private cursor = 0;

  constructor(
    private readonly fs: WorkletFs,
    private readonly fd: number,
    private readonly path: string,
  ) {}

  private checkOpen(): void {
    if (this.closed) throw exception('The object is no longer usable.', 'InvalidStateError');
  }

  read(buffer: WorkletBuffer, options?: IoOptions): number {
    this.checkOpen();
    const view = bytes(buffer);
    const at = options?.at ?? this.cursor;
    const target = arrayBuffer(view);
    const count = this.fs.readAt(this.fd, target, at, view.byteLength);
    if (target !== view.buffer) view.set(new Uint8Array(target, 0, count));
    this.cursor = at + count;
    return count;
  }

  write(buffer: WorkletBuffer, options?: IoOptions): number {
    this.checkOpen();
    const at = options?.at ?? this.cursor;
    if (at > this.getSize()) this.fs.truncate(this.fd, at);
    const count = this.fs.writeAt(this.fd, arrayBuffer(bytes(buffer)), at);
    this.cursor = at + count;
    return count;
  }

  truncate(size: number): void {
    this.checkOpen();
    this.fs.truncate(this.fd, size);
    if (this.cursor > size) this.cursor = size;
  }

  getSize(): number {
    this.checkOpen();
    return this.fs.size(this.fd);
  }

  flush(): void {
    this.checkOpen();
    this.fs.flush(this.fd);
  }

  close(): void {
    if (this.closed) return;
    this.fs.close(this.fd);
    this.closed = true;
    openPaths.delete(this.path);
  }
}

export class WorkletFileSystemFileHandle {
  readonly kind = 'file' as const;

  constructor(
    readonly name: string,
    readonly path: string,
    private readonly fs: WorkletFs,
  ) {}

  async createSyncAccessHandle(): Promise<WorkletFileSystemSyncAccessHandle> {
    if (openPaths.has(this.path)) {
      throw exception('The object can not be modified in this way.', 'NoModificationAllowedError');
    }
    if (this.fs.exists(this.path) !== 'file') throw exception(NOT_FOUND, 'NotFoundError');
    openPaths.add(this.path);
    try {
      return new WorkletFileSystemSyncAccessHandle(this.fs, this.fs.open(this.path, 'rw'), this.path);
    } catch (error) {
      openPaths.delete(this.path);
      throw error;
    }
  }
}

export class WorkletFileSystemDirectoryHandle {
  readonly kind = 'directory' as const;

  constructor(
    readonly name: string,
    readonly path: string,
    private readonly fs: WorkletFs,
  ) {}

  async getFileHandle(name: string, options?: HandleOptions): Promise<WorkletFileSystemFileHandle> {
    if (!validName(name)) throw new TypeError(`Name is not allowed: ${name}`);
    const path = this.path + name;
    const kind = this.fs.exists(path);
    if (kind === 'dir') throw exception(`A directory with the same name exists: ${name}`, 'TypeMismatchError');
    if (!kind) {
      if (!options?.create) throw exception(NOT_FOUND, 'NotFoundError');
      this.fs.close(this.fs.open(path, 'create'));
    }
    return new WorkletFileSystemFileHandle(name, path, this.fs);
  }

  async getDirectoryHandle(name: string, options?: HandleOptions): Promise<WorkletFileSystemDirectoryHandle> {
    if (!validName(name)) throw new TypeError(`Name is not allowed: ${name}`);
    const path = this.path + name;
    const kind = this.fs.exists(path);
    if (kind === 'file') throw exception(`A file with the same name exists: ${name}`, 'TypeMismatchError');
    if (!kind) {
      if (!options?.create) throw exception(NOT_FOUND, 'NotFoundError');
      this.fs.mkdir(path);
    }
    return new WorkletFileSystemDirectoryHandle(name, `${path}/`, this.fs);
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    if (!validName(name)) throw new TypeError(`Name is not allowed: ${name}`);
    const path = this.path + name;
    if (openPaths.has(path) || [...openPaths].some((open) => open.startsWith(`${path}/`))) {
      throw exception('The object can not be modified in this way.', 'NoModificationAllowedError');
    }
    if (!this.fs.exists(path)) throw exception(NOT_FOUND, 'NotFoundError');
    this.fs.remove(path, options?.recursive ?? false);
  }
}

export interface WorkletOpfs {
  getDirectory(): Promise<WorkletFileSystemDirectoryHandle>;
}

export function createWorkletOpfs(options: { fs?: WorkletFs; rootDirectory?: string } = {}): WorkletOpfs {
  const fs = options.fs ?? getWorkletFs();
  const root = (options.rootDirectory ?? `${fs.documentDirectory()}/.worklet-opfs`).replace(/\/+$/, '');
  return {
    async getDirectory() {
      const kind = fs.exists(root);
      if (kind === 'file') throw exception('A file exists at the OPFS root.', 'TypeMismatchError');
      if (!kind) fs.mkdir(root);
      return new WorkletFileSystemDirectoryHandle('', `${root}/`, fs);
    },
  };
}

export function installWorkletRuntimePolyfills({ fs }: { fs: WorkletFs }): string[] {
  const installed: string[] = [];
  if (typeof globalThis.Blob === 'undefined' || typeof globalThis.Blob.prototype.arrayBuffer !== 'function') {
    const IncompleteBlob = globalThis.Blob;
    class WorkletBlob {
      readonly type: string;
      readonly #data: Uint8Array;
      constructor(parts: (WorkletBuffer | string | WorkletBlob)[] = [], options: { type?: string } = {}) {
        const chunks = parts.map((part) => typeof part === 'string'
          ? new Uint8Array(fs.utf8Encode(part))
          : part instanceof WorkletBlob ? part.#data
            : IncompleteBlob && part instanceof IncompleteBlob
              ? (() => { throw new TypeError('Blob parts from the replaced implementation are unsupported.'); })()
              : bytes(part));
        this.#data = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
        let offset = 0;
        for (const chunk of chunks) {
          this.#data.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const type = options.type ?? '';
        this.type = /[^\x20-\x7e]/.test(type) ? '' : type.toLowerCase();
      }
      get size(): number {
        return this.#data.byteLength;
      }
      async arrayBuffer(): Promise<ArrayBuffer> {
        return this.#data.slice().buffer;
      }
      async text(): Promise<string> {
        const data = arrayBuffer(this.#data);
        return fs.utf8Decode(data, 0, data.byteLength);
      }
    }
    Object.defineProperty(globalThis, 'Blob', { configurable: true, writable: true, value: WorkletBlob });
    installed.push('Blob');
  }
  if (typeof globalThis.DOMException === 'undefined') {
    class WorkletDOMException extends Error {
      constructor(message = '', name = 'DOMException') {
        super(message);
        this.name = name;
      }
    }
    Object.defineProperty(globalThis, 'DOMException', { configurable: true, writable: true, value: WorkletDOMException });
    installed.push('DOMException');
  }
  if (typeof globalThis.TextEncoder === 'undefined') {
    class WorkletTextEncoder {
      encode(text = ''): Uint8Array {
        return new Uint8Array(fs.utf8Encode(text));
      }
    }
    Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, writable: true, value: WorkletTextEncoder });
    installed.push('TextEncoder');
  }
  if (typeof globalThis.TextDecoder === 'undefined') {
    class WorkletTextDecoder {
      readonly encoding = 'utf-8';
      readonly fatal: boolean;
      readonly ignoreBOM: boolean;
      constructor(label = 'utf-8', options: TextDecoderOptions = {}) {
        if (!['utf-8', 'utf8', 'unicode-1-1-utf-8'].includes(label.trim().toLowerCase())) {
          throw new RangeError('Only UTF-8 is supported');
        }
        this.fatal = Boolean(options.fatal);
        this.ignoreBOM = Boolean(options.ignoreBOM);
      }
      decode(input?: WorkletBuffer, options: TextDecodeOptions = {}): string {
        if (options.stream) throw new TypeError('Streaming decode is not supported');
        if (!input) return '';
        const view = bytes(input);
        const source = arrayBuffer(view);
        const text = fs.utf8Decode(source, 0, source.byteLength);
        if (this.fatal) {
          // Valid UTF-8 has a unique encoding; replacement of malformed bytes cannot round-trip.
          const encoded = new Uint8Array(fs.utf8Encode(text));
          if (encoded.length !== view.length || encoded.some((value, index) => value !== view[index])) {
            throw new TypeError('Invalid UTF-8');
          }
        }
        return !this.ignoreBOM && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
      }
    }
    Object.defineProperty(globalThis, 'TextDecoder', { configurable: true, writable: true, value: WorkletTextDecoder });
    installed.push('TextDecoder');
  }
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    const subtle = {
      async digest(algorithm: string | { name: string }, input: WorkletBuffer): Promise<ArrayBuffer> {
        if ((typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase() !== 'SHA-256') {
          throw new Error('Only SHA-256 is supported in the worklet runtime.');
        }
        return sha256(input);
      },
    };
    if (!globalThis.crypto) {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: {} });
    }
    if (!globalThis.crypto.subtle) Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: {} });
    Object.defineProperty(globalThis.crypto.subtle, 'digest', { configurable: true, writable: true, value: subtle.digest });
    installed.push('crypto');
  }
  return installed;
}

class AbstractFilesystem {
  readonly useAsyncApi = false;
  constructor(private readonly opfs: WorkletOpfs) {}
  async getDirectory(): Promise<AbstractDirectory> {
    return new AbstractDirectory(await this.opfs.getDirectory());
  }
}

class AbstractDirectory {
  constructor(private readonly base: WorkletFileSystemDirectoryHandle) {}
  async getDirectoryHandle(name: string, options: { create: boolean }): Promise<AbstractDirectory> {
    return new AbstractDirectory(await this.base.getDirectoryHandle(name, options));
  }
  async getFileHandle(name: string, options: { create: boolean }): Promise<AbstractFileHandle> {
    return new AbstractFileHandle(name, await this.base.getFileHandle(name, options));
  }
  async removeEntry(name: string): Promise<void> {
    try {
      await this.base.removeEntry(name);
    } catch (error) {
      if ((error as { name?: string }).name !== 'NotFoundError') throw error;
    }
  }
}

class AbstractFileHandle {
  constructor(readonly name: string, private readonly file: WorkletFileSystemFileHandle) {}
  async createAccessHandle(): Promise<AbstractSyncAccessHandle> {
    return new AbstractSyncAccessHandle(this.file);
  }
}

class AbstractSyncAccessHandle {
  private readonly handle: Promise<WorkletFileSystemSyncAccessHandle>;
  constructor(file: WorkletFileSystemFileHandle) {
    this.handle = file.createSyncAccessHandle();
  }
  async read(from: number, to?: number): Promise<Uint8Array> {
    const handle = await this.handle;
    const end = to ?? handle.getSize();
    const data = new Uint8Array(end - from);
    let count = 0;
    while (count < data.length) {
      const read = handle.read(data.subarray(count), { at: from + count });
      if (read === 0) break; // EOF
      count += read;
    }
    return count === data.length ? data : data.slice(0, count);
  }
  getWritable(): AbstractWritable {
    return new AbstractWritable(this);
  }
  async write(data: Uint8Array, options: { at: number }): Promise<void> {
    const handle = await this.handle;
    let count = 0;
    while (count < data.length) {
      const written = handle.write(data.subarray(count), { at: options.at + count });
      if (written === 0) throw new Error('write made no progress');
      count += written;
    }
  }
  async truncate(size: number): Promise<void> {
    (await this.handle).truncate(size);
  }
  async getSize(): Promise<number> {
    return (await this.handle).getSize();
  }
  async flush(): Promise<void> {
    (await this.handle).flush();
  }
  async close(): Promise<void> {
    (await this.handle).close();
  }
}

class AbstractWritable {
  constructor(private readonly access: AbstractSyncAccessHandle) {}
  write(data: Uint8Array, options: { at: number }): Promise<void> {
    return this.access.write(data, options);
  }
  flush(): Promise<void> {
    return this.access.flush();
  }
  close(): Promise<void> {
    return this.access.close();
  }
}

export function createAbstractFilesystemAdapter(opfs: WorkletOpfs): AbstractFilesystem {
  return new AbstractFilesystem(opfs);
}

export function createPromiseQueueLock(): {
  request<T>(name: string, task: () => Promise<T>): Promise<T>;
} {
  const queues = new Map<string, Promise<unknown>>();
  return {
    request(name, task) {
      const next = (queues.get(name) ?? Promise.resolve()).catch(() => undefined).then(task);
      queues.set(name, next);
      return next;
    },
  };
}
