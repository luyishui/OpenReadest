/**
 * DICT（dictd）与 Slob（Aard 2）词典的函数式封装——沿用本地简化架构：
 * 缓存 reader 单例 + lookup 函数，供 dictionaryService 按 kind 路由。
 *
 * 底层解析器（DictReader/SlobReader）直接来自上游 readest 0.11.20
 * （dictReader.ts / slobReader.ts），无本地改造。
 */
import type { AppService } from '@/types/system';
import { DictReader, DictEntry, parseDictIndex } from './dictReader';
import { inflateChunkStreaming, parseDictZipHeader } from './dictZip';
import { SlobReader, SlobRef } from './slobReader';
import { buildLookupCandidates } from './lookupCandidates';
import type { ImportedDictionary } from './types';

// ---------------------------------------------------------------------------
// DICT（.index + .dict/.dict.dz）
// ---------------------------------------------------------------------------

const dictCache = new Map<string, Promise<DictReader>>();

export const clearDictReaderCache = (dictionaryId: string) => {
  dictCache.delete(dictionaryId);
};

export const openDictReader = async (
  appService: AppService,
  dictionary: ImportedDictionary,
): Promise<DictReader> => {
  const cached = dictCache.get(dictionary.id);
  if (cached) return cached;
  const promise = (async () => {
    const bundle = dictionary.files.dictBundle;
    if (!bundle) throw new Error('DICT bundle is missing files');
    const [indexFile, dictFile] = await Promise.all([
      appService.openFile(`${dictionary.bundleDir}/${bundle.index}`, 'Dictionaries'),
      appService.openFile(`${dictionary.bundleDir}/${bundle.dict}`, 'Dictionaries'),
    ]);
    const reader = new DictReader();
    await reader.load({ index: indexFile, dict: dictFile });
    return reader;
  })();
  dictCache.set(dictionary.id, promise);
  promise.catch(() => dictCache.delete(dictionary.id));
  return promise;
};

export const lookupDict = async (
  appService: AppService,
  dictionary: ImportedDictionary,
  word: string,
): Promise<{ headword: string; definition: string } | null> => {
  const reader = await openDictReader(appService, dictionary);
  for (const candidate of buildLookupCandidates(word)) {
    const entry: DictEntry | undefined = await reader.lookup(candidate);
    if (entry) {
      return {
        headword: entry.word,
        definition: await reader.readText(entry),
      };
    }
  }
  return null;
};

export const getDictLabel = (reader: DictReader, fallback: string): string =>
  reader.info.label?.replace(/\0+$/u, '').trim() || fallback;

/**
 * 廉价读取 DICT 词典的 `00databaseshort` 显示名（对齐 getSlobLabel 模式）。
 * 不整包加载正文：
 * - 原始 .dict：直接按 offset 切片元数据区间；
 * - .dict.dz（dictzip 分块）：仅解压覆盖元数据区间的单个分块；
 * - .dict.dz 但无 RA 分块头（罕见整文件 gzip）：无法随机读取，返回 undefined。
 * 读取失败一律返回 undefined（显示名只是增强，回退 stem）。
 */
export async function readDictShortLabel(
  indexFile: Blob,
  dictFile: Blob,
): Promise<string | undefined> {
  try {
    const parsed = parseDictIndex(await indexFile.text());
    const meta = parsed.meta['00databaseshort'];
    if (!meta) return undefined;
    const bytes = await readDictBodyAt(dictFile, meta.offset, meta.size);
    if (!bytes) return undefined;
    const label = new TextDecoder('utf-8').decode(bytes).replace(/\0+$/u, '').trim();
    return label || undefined;
  } catch {
    return undefined;
  }
}

/** 读取 DICT 正文元数据区间；失败（越界/无法随机读取）返回 null。 */
async function readDictBodyAt(
  dictFile: Blob,
  offset: number,
  size: number,
): Promise<Uint8Array | null> {
  const head = new Uint8Array(
    await dictFile.slice(0, Math.min(dictFile.size, 64 * 1024)).arrayBuffer(),
  );
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
    // gzip：要求 dictzip 分块头，否则无法按未压缩 offset 定位
    const meta = parseDictZipHeader(head);
    if (!meta) return null;
    const totalUncompressed = meta.chlen * meta.chunkSizes.length;
    if (offset < 0 || size < 0 || offset + size > totalUncompressed) return null;
    const firstChunk = Math.floor(offset / meta.chlen);
    const lastChunk = Math.floor((offset + size - 1) / meta.chlen);
    if (lastChunk !== firstChunk) return null; // 元数据跨块（短标签实际不会发生）
    let compressedPos = meta.compressedDataOffset;
    for (let i = 0; i < firstChunk; i++) compressedPos += meta.chunkSizes[i]!;
    const chunkBytes = new Uint8Array(
      await dictFile
        .slice(compressedPos, compressedPos + meta.chunkSizes[firstChunk]!)
        .arrayBuffer(),
    );
    const inflated = inflateChunkStreaming(chunkBytes);
    if (!inflated) return null;
    const localOffset = offset - firstChunk * meta.chlen;
    return inflated.slice(localOffset, localOffset + size);
  }
  // 原始 .dict：直接切片
  if (offset < 0 || size < 0 || offset + size > dictFile.size) return null;
  return new Uint8Array(await dictFile.slice(offset, offset + size).arrayBuffer());
}

// ---------------------------------------------------------------------------
// Slob（.slob 单文件，zlib 压缩）
// ---------------------------------------------------------------------------

const slobCache = new Map<string, Promise<SlobReader>>();

export const clearSlobReaderCache = (dictionaryId: string) => {
  slobCache.delete(dictionaryId);
};

export const openSlobReader = async (
  appService: AppService,
  dictionary: ImportedDictionary,
): Promise<SlobReader> => {
  const cached = slobCache.get(dictionary.id);
  if (cached) return cached;
  const promise = (async () => {
    if (!dictionary.files.slob) throw new Error('Slob bundle is missing the .slob file');
    const slobFile = await appService.openFile(
      `${dictionary.bundleDir}/${dictionary.files.slob}`,
      'Dictionaries',
    );
    const reader = new SlobReader();
    await reader.load({ slob: slobFile });
    return reader;
  })();
  slobCache.set(dictionary.id, promise);
  promise.catch(() => slobCache.delete(dictionary.id));
  return promise;
};

export const lookupSlob = async (
  appService: AppService,
  dictionary: ImportedDictionary,
  word: string,
): Promise<{ headword: string; definition: string; format: 'm' | 'h' } | null> => {
  const reader = await openSlobReader(appService, dictionary);
  if (word.startsWith('~/')) return null; // 内置资源（CSS/JS）不是词条
  for (const candidate of buildLookupCandidates(word)) {
    const ref: SlobRef | undefined = await reader.findRef(candidate);
    if (!ref || ref.key.startsWith('~/')) continue;
    const blob = await reader.readBlob(ref);
    if (!blob.data.length) continue; // 空条目不算命中
    // 对齐上游：content-type 精确匹配（去 charset 参数）——
    // text/html / application/xhtml+xml → HTML，text/plain / 空 → 文本，其余跳过
    const ct = blob.contentType.split(';')[0]!.trim().toLowerCase();
    let format: 'm' | 'h' | null = null;
    if (ct === 'text/html' || ct === 'application/xhtml+xml') format = 'h';
    else if (ct === 'text/plain' || ct === '') format = 'm';
    if (!format) continue;
    const text = new TextDecoder('utf-8').decode(blob.data); // Slob 仅支持 utf-8
    return { headword: ref.key, definition: text, format };
  }
  return null;
};

export const getSlobLabel = (reader: SlobReader, fallback: string): string =>
  reader.header.tags['label']?.replace(/\0+$/u, '') || fallback;
