type NativeFs = {
  open(path: string, mode: 'r' | 'rw' | 'create'): number;
  readAt(fd: number, buffer: ArrayBuffer, at: number, length: number): number;
  writeAt(fd: number, buffer: ArrayBuffer, at: number): number;
  truncate(fd: number, size: number): void; size(fd: number): number; flush(fd: number): void; close(fd: number): void;
  mkdir(path: string): void; remove(path: string, recursive: boolean): void; exists(path: string): 'file' | 'dir' | null;
  documentDirectory(): string; utf8Decode(buffer: ArrayBuffer, start: number, end: number): string; utf8Encode(text: string): ArrayBuffer;
};
declare global { var __workletFs: NativeFs; }

const openPaths = new Set<string>();
const message = 'A requested file or directory could not be found at the time an operation was processed.';
const validName = (name: string) => name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
const exception = (text: string, name: string) => new (globalThis as any).DOMException(text, name);
const bytes = (buffer: ArrayBuffer | ArrayBufferView) => buffer instanceof ArrayBuffer
  ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

export function installWorkletPolyfills(): string[] {
  const needed: string[] = [];
  if (typeof (globalThis as any).DOMException === 'undefined') {
    (globalThis as any).DOMException = class DOMException extends Error { constructor(text = '', name = 'DOMException') { super(text); this.name = name; } };
    needed.push('DOMException');
  }
  if (typeof (globalThis as any).TextEncoder === 'undefined') {
    (globalThis as any).TextEncoder = class TextEncoder { encode(text = '') { return new Uint8Array(globalThis.__workletFs.utf8Encode(text)); } };
    needed.push('TextEncoder');
  }
  if (typeof (globalThis as any).TextDecoder === 'undefined') {
    (globalThis as any).TextDecoder = class TextDecoder { decode(input?: ArrayBuffer | ArrayBufferView) { if (!input) return ''; const view = bytes(input); return globalThis.__workletFs.utf8Decode(view.buffer as ArrayBuffer, view.byteOffset, view.byteOffset + view.byteLength); } };
    needed.push('TextDecoder');
  }
  return needed;
}

export class WorkletFileSystemSyncAccessHandle {
  private closed = false; private cursor = 0;
  constructor(private fd: number, private path: string) {}
  private check() { if (this.closed) throw exception('The object is no longer usable.', 'InvalidStateError'); }
  read(buffer: ArrayBuffer | ArrayBufferView, options?: { at: number }) { this.check(); const view = bytes(buffer); const at = options?.at ?? this.cursor; const target = view.byteOffset === 0 && view.byteLength === view.buffer.byteLength ? view.buffer : new ArrayBuffer(view.byteLength); const count = globalThis.__workletFs.readAt(this.fd, target as ArrayBuffer, at, view.byteLength); if (target !== view.buffer) view.set(new Uint8Array(target as ArrayBuffer, 0, count)); this.cursor = at + count; return count; }
  write(buffer: ArrayBuffer | ArrayBufferView, options?: { at: number }) { this.check(); const view = bytes(buffer); const at = options?.at ?? this.cursor; if (at > this.getSize()) globalThis.__workletFs.truncate(this.fd, at); const source = view.byteOffset === 0 && view.byteLength === view.buffer.byteLength ? view.buffer : view.slice().buffer; const count = globalThis.__workletFs.writeAt(this.fd, source as ArrayBuffer, at); this.cursor = at + count; return count; }
  truncate(size: number) { this.check(); globalThis.__workletFs.truncate(this.fd, size); if (this.cursor > size) this.cursor = size; }
  getSize() { this.check(); return globalThis.__workletFs.size(this.fd); }
  flush() { this.check(); globalThis.__workletFs.flush(this.fd); }
  close() { if (!this.closed) { globalThis.__workletFs.close(this.fd); this.closed = true; openPaths.delete(this.path); } }
}

export class WorkletFileSystemFileHandle {
  readonly kind = 'file';
  constructor(readonly name: string, readonly path: string) {}
  async createSyncAccessHandle() { if (openPaths.has(this.path)) throw exception('The object can not be modified in this way.', 'NoModificationAllowedError'); if (globalThis.__workletFs.exists(this.path) !== 'file') throw exception(message, 'NotFoundError'); openPaths.add(this.path); try { return new WorkletFileSystemSyncAccessHandle(globalThis.__workletFs.open(this.path, 'rw'), this.path); } catch (error) { openPaths.delete(this.path); throw error; } }
}

export class WorkletFileSystemDirectoryHandle {
  readonly kind = 'directory';
  constructor(readonly name: string, readonly path: string) {}
  async getFileHandle(name: string, options?: { create?: boolean }) { if (!validName(name)) throw new TypeError(`Name is not allowed: ${name}`); const path = this.path + name; const kind = globalThis.__workletFs.exists(path); if (kind === 'dir') throw exception(`A directory with the same name exists: ${name}`, 'TypeMismatchError'); if (!kind) { if (!options?.create) throw exception(message, 'NotFoundError'); globalThis.__workletFs.close(globalThis.__workletFs.open(path, 'create')); } return new WorkletFileSystemFileHandle(name, path); }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) { if (!validName(name)) throw new TypeError(`Name is not allowed: ${name}`); const path = this.path + name; const kind = globalThis.__workletFs.exists(path); if (kind === 'file') throw exception(`A file with the same name exists: ${name}`, 'TypeMismatchError'); if (!kind) { if (!options?.create) throw exception(message, 'NotFoundError'); globalThis.__workletFs.mkdir(path); } return new WorkletFileSystemDirectoryHandle(name, path + '/'); }
  async removeEntry(name: string, options?: { recursive?: boolean }) { if (!validName(name)) throw new TypeError(`Name is not allowed: ${name}`); const path = this.path + name; if (openPaths.has(path) || [...openPaths].some((open) => open.startsWith(path + '/'))) throw exception('The object can not be modified in this way.', 'NoModificationAllowedError'); if (!globalThis.__workletFs.exists(path)) throw exception(message, 'NotFoundError'); globalThis.__workletFs.remove(path, options?.recursive ?? false); }
}

export const workletOpfs = { async getDirectory() { const path = globalThis.__workletFs.documentDirectory() + '/.worklet-opfs'; const kind = globalThis.__workletFs.exists(path); if (kind === 'file') throw exception('A file exists at the OPFS root.', 'TypeMismatchError'); if (!kind) globalThis.__workletFs.mkdir(path); return new WorkletFileSystemDirectoryHandle('', path + '/'); } };

export class WorkletFilesystem {
  constructor(readonly useAsyncApi = false) {}
  async getDirectory() { return new WorkletFilesystemDirectory(await workletOpfs.getDirectory()); }
}
export class WorkletFilesystemDirectory {
  constructor(private baseDir: WorkletFileSystemDirectoryHandle) {}
  async getDirectoryHandle(name: string, options: { create: boolean }) { return new WorkletFilesystemDirectory(await this.baseDir.getDirectoryHandle(name, options)); }
  async getFileHandle(name: string, options: { create: boolean }) { return new WorkletFilesystemFileHandle(name, await this.baseDir.getFileHandle(name, options)); }
  async removeEntry(name: string) { try { await this.baseDir.removeEntry(name); } catch (error: any) { if (error?.name !== 'NotFoundError') throw error; } }
}
export class WorkletFilesystemFileHandle {
  constructor(readonly name: string, private fileHandle: WorkletFileSystemFileHandle) {}
  async createAccessHandle() { return new WorkletFilesystemFileSyncAccessHandle(this.fileHandle); }
}
export class WorkletFilesystemFileSyncAccessHandle {
  private handle: Promise<WorkletFileSystemSyncAccessHandle>;
  constructor(private fileHandle: WorkletFileSystemFileHandle) { this.handle = fileHandle.createSyncAccessHandle(); }
  private getHandle() { return this.handle; }
  async read(from: number, to?: number) { const handle = await this.getHandle(); const end = to ?? handle.getSize(); const data = new Uint8Array(end - from); const count = data.length ? handle.read(data, { at: from }) : 0; return count === data.length ? data : data.slice(0, count); }
  getWritable() { return new WorkletFilesystemWritable(this); }
  async write(data: Uint8Array, options: { at: number }) { (await this.getHandle()).write(data, options); }
  async truncate(size: number) { (await this.getHandle()).truncate(size); }
  async getSize() { return (await this.getHandle()).getSize(); }
  async flush() { (await this.getHandle()).flush(); }
  async close() { (await this.getHandle()).close(); }
}
export class WorkletFilesystemWritable {
  constructor(private access: WorkletFilesystemFileSyncAccessHandle) {}
  write(data: Uint8Array, options: { at: number }) { return this.access.write(data, options); }
  flush() { return this.access.flush(); }
  close() { return this.access.close(); }
}
