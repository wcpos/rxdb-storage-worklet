import { getWorkletFs, type WorkletFs } from 'react-native-worklet-fs';

type WorkletBuffer = ArrayBuffer | ArrayBufferView;
type HandleOptions = { create?: boolean };
type IoOptions = { at?: number };

const NOT_FOUND = 'A requested file or directory could not be found at the time an operation was processed.';
const openPaths = new Set<string>();

function validName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
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
      decode(input?: WorkletBuffer): string {
        if (!input) return '';
        const view = bytes(input);
        const source = arrayBuffer(view);
        return fs.utf8Decode(source, 0, source.byteLength);
      }
    }
    Object.defineProperty(globalThis, 'TextDecoder', { configurable: true, writable: true, value: WorkletTextDecoder });
    installed.push('TextDecoder');
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
    const count = data.length ? handle.read(data, { at: from }) : 0;
    return count === data.length ? data : data.slice(0, count);
  }
  getWritable(): AbstractWritable {
    return new AbstractWritable(this);
  }
  async write(data: Uint8Array, options: { at: number }): Promise<void> {
    (await this.handle).write(data, options);
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
