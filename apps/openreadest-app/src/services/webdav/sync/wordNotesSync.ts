import type { WordNote, WordNoteTombstone } from '@/types/book';
import type { WebDavResponse } from '../client/types';
import { mergeWordNotesData, normalizeWord, type WordNotesData } from '@/utils/wordNotes';
import { READEST_WEBDAV_SYSTEM_DIR } from './paths';

export const WORD_NOTES_SYNC_KEY = 'System/word-notes.json';
export const REMOTE_WORD_NOTES_PATH = READEST_WEBDAV_SYSTEM_DIR + '/word-notes.json';
const FORMAT = 'openreadest-word-notes';

export interface WordNotesSnapshot extends Required<WordNotesData> {
  format: typeof FORMAT;
  version: 1;
}

export interface WordNotesSyncStore {
  read(): WordNotesData | Promise<WordNotesData>;
  merge(remote: WordNotesData): Promise<WordNotesData>;
}

interface WordNotesSyncClient {
  get(path: string): Promise<WebDavResponse<ArrayBuffer>>;
  put(
    path: string,
    body: BodyInit,
    options?: {
      contentType?: string;
      ifMatch?: string;
      ifNoneMatch?: string;
    },
  ): Promise<WebDavResponse<void>>;
}

type SyncResult =
  | { status: 'unchanged' }
  | { status: 'pushed'; attempts: number }
  | { status: 'failed'; error: string };

const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const validWord = (value: unknown): value is string =>
  typeof value === 'string' && !!value && normalizeWord(value) === value;

// Validate the whole file before importing anything. Unknown versions and broken
// records must never turn a partial import into an overwrite of the remote file.
export const parseWordNotesSnapshot = (
  text: string,
): { ok: true; snapshot: WordNotesSnapshot } | { ok: false; error: string } => {
  const fail = (error = '跨书词条文件结构损坏') => ({ ok: false as const, error });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('跨书词条文件不是合法 JSON');
  }
  if (!record(value)) return fail('跨书词条文件格式无法识别');
  const { format, version, wordNotes: rawNotes, wordNoteTombstones: rawTombstones } = value;
  if (format !== FORMAT) return fail('跨书词条文件格式无法识别');
  if (version !== 1) return fail('跨书词条文件版本不受支持');
  if (!Array.isArray(rawNotes) || !Array.isArray(rawTombstones)) return fail();
  const wordNotes: WordNote[] = [];
  const owners = new Map<string, string>();
  for (const item of rawNotes as unknown[]) {
    if (!record(item)) return fail();
    const { id, word, note, createdAt, updatedAt, aliases } = item;
    if (
      !validId(id) ||
      !validWord(word) ||
      typeof note !== 'string' ||
      !note.trim() ||
      !timestamp(createdAt) ||
      !timestamp(updatedAt) ||
      updatedAt < createdAt ||
      (aliases !== undefined && (!Array.isArray(aliases) || !aliases.every(validId)))
    )
      return fail();
    for (const key of [id, ...((aliases as string[] | undefined) ?? [])]) {
      if (owners.has(key) && owners.get(key) !== word) return fail();
      owners.set(key, word);
    }
    wordNotes.push({
      id,
      word,
      note,
      createdAt,
      updatedAt,
      ...(aliases !== undefined ? { aliases: aliases as string[] } : {}),
    });
  }
  const wordNoteTombstones: WordNoteTombstone[] = [];
  for (const item of rawTombstones as unknown[]) {
    if (!record(item)) return fail();
    const { word, deletedAt } = item;
    if (!validWord(word) || !timestamp(deletedAt)) return fail();
    wordNoteTombstones.push({ word, deletedAt });
  }
  return { ok: true, snapshot: { format: FORMAT, version: 1, wordNotes, wordNoteTombstones } };
};

const serialize = (data: WordNotesData) =>
  JSON.stringify({ format: FORMAT, version: 1, ...mergeWordNotesData(data) });

export const syncWordNotesWithWebDav = async (
  client: WordNotesSyncClient,
  store: WordNotesSyncStore,
): Promise<SyncResult> => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await client.get(REMOTE_WORD_NOTES_PATH);
    let remoteText: string | null = null;
    let ifMatch: string | undefined;
    if (res.ok) {
      if (!res.data?.byteLength)
        return { status: 'failed', error: '远端跨书词条文件为空，未覆盖远端' };
      remoteText = new TextDecoder().decode(res.data);
      const etag = res.headers.get('etag')?.trim();
      ifMatch = etag && !etag.startsWith('W/') ? etag : undefined;
      const parsed = parseWordNotesSnapshot(remoteText);
      if (!parsed.ok) return { status: 'failed', error: parsed.error + '，未覆盖远端' };
      await store.merge(parsed.snapshot);
    } else if (res.status !== 404 && res.status !== 410) {
      return {
        status: 'failed',
        error: '读取远端跨书词条失败（' + (res.error || res.status) + '）',
      };
    }
    const localText = serialize(await store.read());
    if (localText === remoteText) return { status: 'unchanged' };
    if (remoteText !== null && !ifMatch) {
      // Servers without strong ETags cannot guarantee an atomic update. Re-read
      // immediately before PUT to catch detectable concurrent changes.
      const recheck = await client.get(REMOTE_WORD_NOTES_PATH);
      if (!recheck.ok) {
        if (recheck.status === 404 || recheck.status === 410) continue;
        return { status: 'failed', error: '复查远端跨书词条失败，未覆盖远端' };
      }
      const text = recheck.data ? new TextDecoder().decode(recheck.data) : null;
      if (text !== remoteText) continue;
    }
    const put = await client.put(REMOTE_WORD_NOTES_PATH, new TextEncoder().encode(localText), {
      contentType: 'application/json; charset=utf-8',
      ifMatch,
      ifNoneMatch: remoteText === null ? '*' : undefined,
    });
    if (put.ok) return { status: 'pushed', attempts: attempt };
    if (put.status !== 412) {
      return { status: 'failed', error: '上传跨书词条失败（' + (put.error || put.status) + '）' };
    }
  }
  return { status: 'failed', error: '跨书词条并发写入冲突，下次同步重试' };
};
