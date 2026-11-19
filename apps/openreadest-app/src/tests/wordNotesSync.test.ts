import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WordNote } from '@/types/book';
import type { WebDavResponse } from '@/services/webdav/client/types';
import {
  parseWordNotesSnapshot,
  syncWordNotesWithWebDav,
  type WordNotesSyncStore,
} from '@/services/webdav/sync/wordNotesSync';
import { mergeWordNotesData, resolveWordNote, type WordNotesData } from '@/utils/wordNotes';

const entry = (id: string, word = 'read', time = 10): WordNote => ({
  id,
  word,
  note: 'meaning ' + id,
  createdAt: 1,
  updatedAt: time,
});
const device = (initial: WordNotesData = {}) => {
  let data = initial;
  const store: WordNotesSyncStore = {
    read: () => data,
    merge: async (remote) => (data = mergeWordNotesData(data, remote)),
  };
  return {
    store,
    read: () => data,
    edit: (value: WordNotesData) => {
      data = value;
    },
  };
};

class FakeDav {
  file: string | null = null;
  revision = 0;
  puts = 0;
  status = 200;
  weakEtag = false;
  beforePut: (() => void) | undefined;
  beforeGet: (() => void) | undefined;
  set(text: string) {
    this.file = text;
    this.revision++;
  }
  async get(): Promise<WebDavResponse<ArrayBuffer>> {
    const hook = this.beforeGet;
    this.beforeGet = undefined;
    hook?.();
    if (this.status !== 200) return { ok: false, status: this.status, headers: new Headers() };
    return this.file === null
      ? { ok: false, status: 404, headers: new Headers() }
      : {
          ok: true,
          status: 200,
          data: new TextEncoder().encode(this.file).buffer as ArrayBuffer,
          headers: new Headers({ etag: (this.weakEtag ? 'W/' : '') + '"v' + this.revision + '"' }),
        };
  }
  async put(
    _path: string,
    body: BodyInit,
    options?: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<WebDavResponse<void>> {
    this.puts++;
    const hook = this.beforePut;
    this.beforePut = undefined;
    hook?.();
    if (
      (options?.ifNoneMatch === '*' && this.file !== null) ||
      (options?.ifMatch && options.ifMatch !== '"v' + this.revision + '"')
    ) {
      return { ok: false, status: 412, headers: new Headers() };
    }
    this.set(new TextDecoder().decode(body as Uint8Array));
    return { ok: true, status: 201, headers: new Headers() };
  }
}

let dav: FakeDav;
beforeEach(() => {
  dav = new FakeDav();
});

describe('cross-book word notes over WebDAV', () => {
  it('migrates existing local entries and restores them on a device with no source books', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    expect((await syncWordNotesWithWebDav(dav, pc.store)).status).toBe('pushed');
    const phone = device();
    expect((await syncWordNotesWithWebDav(dav, phone.store)).status).toBe('unchanged');
    expect(phone.read()).toEqual(mergeWordNotesData(pc.read()));
    expect(phone.read().wordNotes).toEqual([entry('a')]);
    await syncWordNotesWithWebDav(dav, phone.store);
    expect(dav.puts).toBe(1);
  });

  it('merges independent offline additions without dropping either device’s entries', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    const phone = device({ wordNotes: [entry('b', 'book')] });
    await syncWordNotesWithWebDav(dav, pc.store);
    await syncWordNotesWithWebDav(dav, phone.store);
    await syncWordNotesWithWebDav(dav, pc.store);
    expect(pc.read()).toEqual(phone.read());
    expect(pc.read().wordNotes).toHaveLength(2);
  });

  it('merges duplicate words deterministically and preserves both source note links', async () => {
    const a = { wordNotes: [entry('a', 'read', 10)] };
    const b = { wordNotes: [entry('b', 'read', 20)] };
    const merged = mergeWordNotesData(a, b);
    expect(merged).toEqual(mergeWordNotesData(b, a));
    expect(merged.wordNotes).toHaveLength(1);
    for (const id of ['a', 'b']) {
      expect(resolveWordNote({ wordNoteId: id } as never, merged.wordNotes).note).toBe('meaning b');
    }
    expect(mergeWordNotesData(merged, a)).toEqual(merged);
  });

  it('uses a deterministic winner when edit timestamps are equal', () => {
    const a = { wordNotes: [entry('a')] };
    const b = { wordNotes: [entry('b')] };
    expect(mergeWordNotesData(a, b)).toEqual(mergeWordNotesData(b, a));
  });

  it('propagates deletions without resurrecting stale offline copies and allows later recreation', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    const offline = device({ wordNotes: [entry('a')] });
    await syncWordNotesWithWebDav(dav, pc.store);
    pc.edit({ wordNotes: [], wordNoteTombstones: [{ word: 'read', deletedAt: 20 }] });
    await syncWordNotesWithWebDav(dav, pc.store);
    await syncWordNotesWithWebDav(dav, offline.store);
    expect(offline.read().wordNotes).toEqual([]);
    offline.edit({ ...offline.read(), wordNotes: [entry('new', 'read', 30)] });
    await syncWordNotesWithWebDav(dav, offline.store);
    await syncWordNotesWithWebDav(dav, pc.store);
    expect(pc.read().wordNotes).toEqual([entry('new', 'read', 30)]);
  });

  it('re-pulls and merges a concurrent write rejected by If-Match', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    await syncWordNotesWithWebDav(dav, pc.store);
    const previous = JSON.parse(dav.file!);
    pc.edit({ wordNotes: [entry('a', 'read', 30)] });
    dav.beforePut = () => dav.set(JSON.stringify({ ...previous, wordNotes: [entry('b', 'book')] }));
    expect(await syncWordNotesWithWebDav(dav, pc.store)).toEqual({ status: 'pushed', attempts: 2 });
    expect(pc.read().wordNotes).toHaveLength(2);
  });

  it('protects first creation when another device uploads before PUT', async () => {
    const remote = device({ wordNotes: [entry('b', 'book')] });
    await syncWordNotesWithWebDav(dav, remote.store);
    const text = dav.file!;
    dav.file = null;
    dav.beforePut = () => dav.set(text);
    const pc = device({ wordNotes: [entry('a')] });
    expect(await syncWordNotesWithWebDav(dav, pc.store)).toEqual({ status: 'pushed', attempts: 2 });
    expect(pc.read().wordNotes).toHaveLength(2);
  });

  it('includes local edits made while downloading the remote snapshot', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    await syncWordNotesWithWebDav(dav, pc.store);
    dav.beforeGet = () => pc.edit({ wordNotes: [entry('a', 'read', 40), entry('b', 'book')] });
    await syncWordNotesWithWebDav(dav, pc.store);
    expect(JSON.parse(dav.file!).wordNotes).toHaveLength(2);
    expect(pc.read().wordNotes![1]!.updatedAt).toBe(40);
  });

  it.each([
    '',
    '{bad json',
    '{"format":"openreadest-word-notes","version":999,"wordNotes":[],"wordNoteTombstones":[]}',
  ])('does not import or overwrite an invalid or future snapshot: %s', async (text) => {
    const pc = device({ wordNotes: [entry('a')] });
    dav.set(text);
    expect((await syncWordNotesWithWebDav(dav, pc.store)).status).toBe('failed');
    expect(dav.puts).toBe(0);
    expect(pc.read().wordNotes).toEqual([entry('a')]);
    expect(dav.file).toBe(text);
  });

  it.each([401, 500, 0])('reports GET failure %s without uploading', async (status) => {
    dav.status = status;
    expect((await syncWordNotesWithWebDav(dav, device().store)).status).toBe('failed');
    expect(dav.puts).toBe(0);
  });

  it('rejects an entire snapshot with a malformed entry', async () => {
    await syncWordNotesWithWebDav(dav, device({ wordNotes: [entry('a')] }).store);
    const snapshot = JSON.parse(dav.file!);
    snapshot.wordNotes.push({ ...entry('b'), updatedAt: 'tomorrow' });
    expect(parseWordNotesSnapshot(JSON.stringify(snapshot)).ok).toBe(false);
  });

  it('rechecks and merges remote changes when only a weak ETag is available', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    await syncWordNotesWithWebDav(dav, pc.store);
    const previous = JSON.parse(dav.file!);
    dav.weakEtag = true;
    pc.edit({ wordNotes: [entry('a', 'read', 30)] });
    const get = dav.get.bind(dav);
    let reads = 0;
    vi.spyOn(dav, 'get').mockImplementation(async () => {
      if (++reads === 2) dav.set(JSON.stringify({ ...previous, wordNotes: [entry('b', 'book')] }));
      return get();
    });
    expect(await syncWordNotesWithWebDav(dav, pc.store)).toEqual({ status: 'pushed', attempts: 2 });
    expect(pc.read().wordNotes).toHaveLength(2);
  });

  it('stops without uploading if the ETag fallback recheck fails', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    await syncWordNotesWithWebDav(dav, pc.store);
    const previous = dav.file;
    const puts = dav.puts;
    dav.weakEtag = true;
    pc.edit({ wordNotes: [entry('a', 'read', 30)] });
    const get = dav.get.bind(dav);
    let reads = 0;
    vi.spyOn(dav, 'get').mockImplementation(async () => {
      if (++reads === 2) dav.status = 500;
      return get();
    });
    expect((await syncWordNotesWithWebDav(dav, pc.store)).status).toBe('failed');
    expect(dav.file).toBe(previous);
    expect(dav.puts).toBe(puts);
  });

  it('reports exhausted precondition retries and keeps local entries', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    vi.spyOn(dav, 'put').mockResolvedValue({ ok: false, status: 412, headers: new Headers() });
    expect((await syncWordNotesWithWebDav(dav, pc.store)).status).toBe('failed');
    expect(dav.put).toHaveBeenCalledTimes(3);
    expect(pc.read().wordNotes).toEqual([entry('a')]);
  });

  it('reports upload failure without deleting the local library', async () => {
    const pc = device({ wordNotes: [entry('a')] });
    vi.spyOn(dav, 'put').mockResolvedValue({ ok: false, status: 507, headers: new Headers() });
    expect((await syncWordNotesWithWebDav(dav, pc.store)).status).toBe('failed');
    expect(pc.read().wordNotes).toEqual([entry('a')]);
  });
});
