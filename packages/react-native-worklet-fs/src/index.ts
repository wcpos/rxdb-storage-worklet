export interface WorkletFs {
  open(path: string, mode: 'r' | 'rw' | 'create'): number;
  readAt(fd: number, buffer: ArrayBuffer, at: number, length: number): number;
  writeAt(fd: number, buffer: ArrayBuffer, at: number): number;
  truncate(fd: number, size: number): void;
  size(fd: number): number;
  flush(fd: number): void;
  close(fd: number): void;
  mkdir(path: string): void;
  readdir(path: string): { name: string; kind: 'file' | 'dir' }[];
  remove(path: string, recursive: boolean): void;
  exists(path: string): 'file' | 'dir' | null;
  documentDirectory(): string;
  utf8Decode(buffer: ArrayBuffer, start: number, end: number): string;
  utf8Encode(text: string): ArrayBuffer;
}

export type InstallWorkletFs = (runtime?: unknown) => void;

declare global {
  var __workletFs: WorkletFs | undefined;
}

export function getWorkletFs(): WorkletFs {
  if (!globalThis.__workletFs) {
    throw new Error('WorkletFs is unavailable. Call installWorkletFs before using storage.');
  }
  return globalThis.__workletFs;
}
