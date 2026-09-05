/**
 * Node-only FileScanner. Imports `node:fs`, so do NOT import this module from
 * code that needs to run in a browser/Tauri renderer. Browser callers should
 * use `BlobScanner` from `./scanner.js` instead.
 *
 * FileScanner is intentionally synchronous: it lets callers use the legacy
 * `new MDX(path)` constructor and get sync `lookup()` results, matching
 * pre-fork behavior. The async path (BlobScanner) is for browser use where
 * sync file IO does not exist.
 */
import { closeSync, openSync, readSync } from 'node:fs';
import type { Scanner } from './scanner';

export class FileScanner implements Scanner {
  /** Discriminator: callers can branch sync vs async on `scanner.sync`. */
  readonly sync = true as const;

  offset: number;
  filepath: string;
  fd: number;

  constructor(filepath: string) {
    this.filepath = filepath;
    this.offset = 0;
    this.fd = openSync(filepath, 'r');
  }

  close() {
    if (this.fd === 0) return;
    closeSync(this.fd);
  }

  readBuffer(offset: number | bigint, length: number): Uint8Array {
    const buffer = new Uint8Array(length);
    const readedLen = readSync(this.fd, buffer, {
      offset: 0, // offset into `buffer`
      length,
      position: offset, // position in the file
    });
    return buffer.slice(0, readedLen);
  }

  readNumber(offset: number, length: number): DataView {
    const buffer = new ArrayBuffer(length);
    const dataView = new DataView(buffer);
    readSync(this.fd, dataView, {
      length,
      position: offset,
      offset: 0,
    });
    return dataView;
  }
}
