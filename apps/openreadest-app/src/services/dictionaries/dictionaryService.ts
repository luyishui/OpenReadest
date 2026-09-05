import type { SelectedFile } from '@/hooks/useFileSelector';
import type { AppService } from '@/types/system';
import { md5Fingerprint } from '@/utils/md5';
import { getFilename } from '@/utils/path';
import { scanEntryOffsets, serializeOffsetsSidecar } from './stardictReader';
import { StarDictReader, parseIfo } from './stardictReader';
import { buildLookupCandidates } from './lookupCandidates';
import { clearMdictCache, lookupMdict, openMdict } from './mdictReader';
import {
  clearDictReaderCache,
  clearSlobReaderCache,
  getDictLabel,
  getSlobLabel,
  lookupDict,
  lookupSlob,
  openDictReader,
  openSlobReader,
  readDictShortLabel,
} from './extraReaders';
import { buildPinyinCandidates, PINYIN_SUGGESTION_LIMIT } from './pinyin';
import type { ImportedDictionary } from './types';

type BundleFile = SelectedFile & { name: string; file: File };

export interface DictionaryLookupResult {
  dictionaryId: string;
  dictionaryName: string;
  headword: string;
  definition: string;
  format: string;
}

/** 导入结果：imported 为待持久化的条目；replaced/skipped 供 UI 反馈。 */
export interface DictionaryImportResult {
  /** 新增条目（含替换旧条目的新条目；被替换的旧条目已清 reader 缓存与磁盘目录）。 */
  imported: ImportedDictionary[];
  /** 被替换旧条目的 id（同 stem 但文件指纹变化 → 新 id）。 */
  replaced: string[];
  /** 与既有条目完全相同的 stem（指纹一致：未重新写盘，保留原条目）。 */
  skipped: string[];
  /** 不完整包（缺必要文件）的 stem——跳过但不算"已存在"。 */
  incomplete: string[];
}

const getBundleStem = (name: string): string =>
  name
    .replace(/\.dict\.dz$/i, '')
    // 多卷 .mdd（xxx.1.mdd、xxx.2.mdd）与主卷归入同一 bundle
    .replace(/\.(?:\d+\.)?mdd$/i, '')
    .replace(/\.(?:ifo|idx|dict|syn|mdx|slob|index)$/i, '')
    .toLowerCase();

/** 导入失败的结构化错误：UI 层按 code 本地化展示。 */
export class DictionaryImportError extends Error {
  readonly code: 'no-complete-bundle' | 'store-failed';
  readonly skipped?: string[];

  constructor(
    code: 'no-complete-bundle' | 'store-failed',
    message: string,
    skipped?: string[],
  ) {
    super(message);
    this.name = 'DictionaryImportError';
    this.code = code;
    this.skipped = skipped;
  }
}

/**
 * Android content:// URI 的 basename 可能含路径分隔符/冒号（如
 * "primary:Download/tiny.ifo"），存盘与查询都会错乱——统一清洗。
 */
const sanitizeFileName = (name: string): string => name.replace(/[\\/:]/g, '_');

const toFile = async (appService: AppService, selected: SelectedFile): Promise<BundleFile> => {
  if (selected.file) {
    return { ...selected, name: sanitizeFileName(selected.file.name), file: selected.file };
  }
  if (!selected.path) throw new Error('Dictionary file has no path');
  const file = await appService.openFile(selected.path, 'None');
  return {
    ...selected,
    name: sanitizeFileName(file.name || getFilename(selected.path)),
    file,
  };
};

const storeFile = async (
  appService: AppService,
  source: BundleFile,
  bundleDir: string,
): Promise<void> => {
  const target = `${bundleDir}/${source.name}`;
  if (source.path) {
    await appService.copyFile(source.path, target, 'Dictionaries');
  } else {
    await appService.writeFile(target, 'Dictionaries', source.file);
  }
};

/** 由已导入条目的文件派生 bundle stem（导入去重/反馈展示用）。 */
export const getDictionaryStem = (dictionary: ImportedDictionary): string | null => {
  const name =
    dictionary.files.ifo ??
    dictionary.files.mdx ??
    dictionary.files.slob ??
    dictionary.files.dictBundle?.index;
  return name ? getBundleStem(name) : null;
};

/** 清空某词典的 reader 内存缓存 + 磁盘目录。 */
const clearDictionaryEntry = async (
  appService: AppService,
  dictionary: ImportedDictionary,
): Promise<void> => {
  readerCache.delete(dictionary.id);
  clearMdictCache(dictionary.id);
  clearDictReaderCache(dictionary.id);
  clearSlobReaderCache(dictionary.id);
  await appService.deleteDir(dictionary.bundleDir, 'Dictionaries', true);
};

/**
 * 导入同 stem 去重策略（Part 2.6）：
 * - 指纹一致（同名同尺寸 → 同 id）→ 跳过写盘，保留原条目（原 label/顺序/启用状态
 *   不丢失；同时消除「重导入产生新 id → 旧 reader 缓存和磁盘目录驻留」的无界增长）；
 * - 指纹变化（同 stem 但文件更新/换格式 → 新 id）→ 自动覆盖：先落盘新文件，
 *   成功后清理旧条目（缓存 + 目录）。覆盖不弹确认——导入本身就是显式的替换意图，
 *   且"自动跳过"会让用户误以为导入失败；显式禁用（enabled=false）的旧条目状态被继承，
 *   避免更新文件后意外复活。
 */
export async function importStarDictBundles(
  appService: AppService,
  selectedFiles: SelectedFile[],
  existing: ImportedDictionary[] = [],
  addedAt = Date.now(),
): Promise<DictionaryImportResult> {
  const files = await Promise.all(selectedFiles.map((selected) => toFile(appService, selected)));
  const bundles = new Map<string, BundleFile[]>();
  for (const file of files) {
    const stem = getBundleStem(file.name);
    const bundle = bundles.get(stem) ?? [];
    bundle.push(file);
    bundles.set(stem, bundle);
  }

  const imported: ImportedDictionary[] = [];
  const replaced: string[] = [];
  const skipped: string[] = [];
  const incomplete: string[] = [];
  for (const [stem, bundle] of bundles) {
    const ifo = bundle.find(({ name }) => /\.ifo$/i.test(name));
    const idx = bundle.find(({ name }) => /\.idx$/i.test(name));
    const dict = bundle.find(({ name }) => /\.dict(?:\.dz)?$/i.test(name));
    const syn = bundle.find(({ name }) => /\.syn$/i.test(name));
    const mdx = bundle.find(({ name }) => /\.mdx$/i.test(name));
    const mddFiles = bundle.filter(({ name }) => /\.mdd$/i.test(name));
    const slobFile = bundle.find(({ name }) => /\.slob$/i.test(name));
    const dictIndex = bundle.find(({ name }) => /\.index$/i.test(name));
    const isMdict = !!mdx;
    const isSlob = !!slobFile;
    // DICT 判定要求无 .ifo：同 stem 混选（stardict + DICT 同文件组）时
    // stardict 优先，避免 DICT 分支把 stardict 文件当孤儿吞掉
    const isDict = !ifo && !!dictIndex && !!dict;

    // 同 stem 已导入条目（去重基准）
    const existingEntry = existing.find((d) => getDictionaryStem(d) === stem);
    // 指纹与 id 前缀无关，各分支共享；指纹一致 → 同 id → 跳过
    const fingerprint = md5Fingerprint(
      `${stem}:${bundle
        .map(({ name, file }) => `${name.toLowerCase()}:${file.size}`)
        .sort()
        .join('|')}`,
    );

    // 同 stem 且文件完全一致：跳过写盘，保留原条目（label/排序/启用状态不丢）
    const isIdenticalDuplicate = (id: string): boolean =>
      existingEntry !== undefined && existingEntry.id === id && !replaced.includes(id);

    // 覆盖旧条目的收尾：清旧条目缓存与目录（新条目已成功落盘后调用），
    // 并继承旧条目的显式禁用状态。
    const finalizeReplace = async (id: string, dictionary: ImportedDictionary) => {
      if (!existingEntry || existingEntry.id === id) return;
      await clearDictionaryEntry(appService, existingEntry).catch(() => undefined);
      replaced.push(existingEntry.id);
      if (existingEntry.enabled === false) dictionary.enabled = false;
    };

    if (isSlob) {
      // Slob（Aard 2）包：单 .slob 文件，zlib 压缩
      const id = `slob:${fingerprint}`;
      if (isIdenticalDuplicate(id)) {
        skipped.push(stem);
        continue;
      }
      const bundleDir = id.replace(':', '-');
      await appService.createDir(bundleDir, 'Dictionaries', true);
      try {
        await Promise.all(bundle.map((file) => storeFile(appService, file, bundleDir)));
      } catch (_error) {
        await appService.deleteDir(bundleDir, 'Dictionaries', true).catch(() => undefined);
        throw new DictionaryImportError('store-failed', `Failed to store dictionary "${stem}"`);
      }
      const dictionary: ImportedDictionary = {
        id,
        kind: 'slob',
        name: stem,
        bundleDir,
        files: { slob: slobFile.name },
        addedAt,
      };
      // 打开验证：非 zlib 压缩（bz2/lzma2）标记 unsupported；取 header label
      try {
        const reader = await openSlobReader(appService, dictionary);
        dictionary.name = getSlobLabel(reader, dictionary.name);
      } catch (error) {
        dictionary.unsupported = true;
        dictionary.unsupportedReason =
          error instanceof Error ? error.message : 'Failed to open Slob';
      }
      await finalizeReplace(id, dictionary);
      imported.push(dictionary);
      continue;
    }

    if (isDict) {
      // DICT（dictd）包：.index + .dict/.dict.dz
      const id = `dict:${fingerprint}`;
      if (isIdenticalDuplicate(id)) {
        skipped.push(stem);
        continue;
      }
      const bundleDir = id.replace(':', '-');
      await appService.createDir(bundleDir, 'Dictionaries', true);
      try {
        await Promise.all(bundle.map((file) => storeFile(appService, file, bundleDir)));
      } catch (_error) {
        await appService.deleteDir(bundleDir, 'Dictionaries', true).catch(() => undefined);
        throw new DictionaryImportError('store-failed', `Failed to store dictionary "${stem}"`);
      }
      const dictionary: ImportedDictionary = {
        id,
        kind: 'dict',
        name: stem,
        bundleDir,
        files: { dictBundle: { index: dictIndex.name, dict: dict.name } },
        addedAt,
      };
      // 显示名取 00databaseshort 元数据（对齐 getSlobLabel 模式）；廉价读取，
      // 不做整包验证——同 stardict 分支只校验头部。失败回退 stem。
      const label = await readDictShortLabel(dictIndex.file, dict.file);
      if (label) dictionary.name = label;
      await finalizeReplace(id, dictionary);
      imported.push(dictionary);
      continue;
    }

    if (isMdict) {
      // MDict 包：.mdx 必选，.mdd 资源可选（可多个）
      const id = `mdict:${fingerprint}`;
      if (isIdenticalDuplicate(id)) {
        skipped.push(stem);
        continue;
      }
      const bundleDir = id.replace(':', '-');
      await appService.createDir(bundleDir, 'Dictionaries', true);
      try {
        await Promise.all(bundle.map((file) => storeFile(appService, file, bundleDir)));
      } catch (_error) {
        await appService.deleteDir(bundleDir, 'Dictionaries', true).catch(() => undefined);
        throw new DictionaryImportError('store-failed', `Failed to store dictionary "${stem}"`);
      }
      const dictionary: ImportedDictionary = {
        id,
        kind: 'mdict',
        name: stem,
        bundleDir,
        files: {
          mdx: mdx.name,
          ...(mddFiles.length > 0 ? { mdd: mddFiles.map((f) => f.name) } : {}),
        },
        addedAt,
      };
      // 打开验证（lazy 模式开销小）：加密/损坏的 mdx 标记为 unsupported；
      // 同时取 MDX 头声明的词典名（优于文件 stem）
      try {
        const opened = await openMdict(appService, dictionary);
        dictionary.name = opened.title ?? dictionary.name;
      } catch (error) {
        dictionary.unsupported = true;
        dictionary.unsupportedReason =
          error instanceof Error ? error.message : 'Failed to open MDX';
      }
      await finalizeReplace(id, dictionary);
      imported.push(dictionary);
      continue;
    }

    if (!ifo || !idx || !dict) {
      // 不完整包跳过，不阻断其他完整包的导入（上游行为：导入完整包并报告 orphans）
      incomplete.push(stem);
      continue;
    }

    const info = parseIfo(await ifo.file.text());
    const sequence = info['sametypesequence'] ?? '';
    const supported = sequence.length === 1 && ['m', 't', 'h', 'x'].includes(sequence);
    const id = `stardict:${fingerprint}`;
    if (isIdenticalDuplicate(id)) {
      skipped.push(stem);
      continue;
    }
    const bundleDir = id.replace(':', '-');

    await appService.createDir(bundleDir, 'Dictionaries', true);
    try {
      await Promise.all(bundle.map((file) => storeFile(appService, file, bundleDir)));
    } catch (_error) {
      await appService.deleteDir(bundleDir, 'Dictionaries', true).catch(() => undefined);
      throw new DictionaryImportError(
        'store-failed',
        `Failed to store dictionary "${stem}"`,
      );
    }

    // 生成 .idx 偏移边车，让后续查询跳过全量扫描（见 stardictReader）。
    try {
      const idxBytes = new Uint8Array(await idx.file.arrayBuffer());
      const sidecar = serializeOffsetsSidecar(scanEntryOffsets(idxBytes, /* payloadBytes */ 8));
      await appService.writeFile(
        `${bundleDir}/${idx.name}.offsets`,
        'Dictionaries',
        sidecar.slice().buffer,
      );
    } catch {
      // 边车只是加速，失败不影响导入
    }

    const dictionary: ImportedDictionary = {
      id,
      kind: 'stardict',
      name: info['bookname'] || stem,
      bundleDir,
      files: {
        ifo: ifo.name,
        idx: idx.name,
        dict: dict.name,
        ...(syn ? { syn: syn.name } : {}),
      },
      addedAt,
      ...(!supported
        ? {
            unsupported: true,
            unsupportedReason: `sametypesequence=${sequence || '(missing)'} is not supported`,
          }
        : {}),
    };
    await finalizeReplace(id, dictionary);
    imported.push(dictionary);
  }
  if (imported.length === 0 && incomplete.length > 0) {
    throw new DictionaryImportError(
      'no-complete-bundle',
      `No complete dictionary bundle could be imported (skipped: ${incomplete.join(', ')})`,
      incomplete,
    );
  }
  return { imported, replaced, skipped, incomplete };
}

/**
 * 已加载词典的 reader 缓存（惰性单例）。每次查词重建 reader + 全量扫描 .idx
 * 对大词典（十万词条约 2MB）代价过高；缓存后仅在首次构建时扫描，
 * 配合导入时生成的 .idx.offsets 边车进一步跳过扫描。
 */
const readerCache = new Map<string, Promise<StarDictReader>>();

const openReader = async (
  appService: AppService,
  dictionary: ImportedDictionary,
): Promise<StarDictReader> => {
  const cached = readerCache.get(dictionary.id);
  if (cached) return cached;
  const promise = (async () => {
    const { ifo, idx, dict, syn } = dictionary.files;
    const [ifoFile, idxFile, dictFile, synFile, idxOffsetsFile] = await Promise.all([
      appService.openFile(`${dictionary.bundleDir}/${ifo}`, 'Dictionaries'),
      appService.openFile(`${dictionary.bundleDir}/${idx}`, 'Dictionaries'),
      appService.openFile(`${dictionary.bundleDir}/${dict}`, 'Dictionaries'),
      syn
        ? appService.openFile(`${dictionary.bundleDir}/${syn}`, 'Dictionaries')
        : Promise.resolve(undefined),
      appService
        .openFile(`${dictionary.bundleDir}/${idx}.offsets`, 'Dictionaries')
        .catch(() => undefined),
    ]);
    const reader = new StarDictReader();
    await reader.load({ ifo: ifoFile, idx: idxFile, dict: dictFile, syn: synFile, idxOffsets: idxOffsetsFile });
    return reader;
  })();
  readerCache.set(dictionary.id, promise);
  // 构建失败也清除缓存，下次查询可重试
  promise.catch(() => readerCache.delete(dictionary.id));
  return promise;
};

export async function deleteImportedDictionary(
  appService: AppService,
  dictionary: ImportedDictionary,
): Promise<void> {
  await clearDictionaryEntry(appService, dictionary);
}

/** 词典是否参与查询：显式 enabled=false 排除；缺省视为启用（旧数据向后兼容）。 */
const isDictionaryEnabled = (dictionary: ImportedDictionary): boolean =>
  dictionary.enabled !== false;

export async function lookupImportedDictionary(
  appService: AppService,
  dictionary: ImportedDictionary,
  query: string,
): Promise<DictionaryLookupResult | null> {
  if (
    !isDictionaryEnabled(dictionary) ||
    dictionary.deletedAt ||
    dictionary.unavailable ||
    dictionary.unsupported
  ) {
    return null;
  }
  const trimmed = query.trim();
  if (!trimmed) return null;

  // MDict：大小写敏感的 .mdx 关键字表，用候选词变体逐一尝试（精确命中优先）
  if (dictionary.kind === 'mdict') {
    for (const candidate of buildLookupCandidates(trimmed)) {
      const result = await lookupMdict(appService, dictionary, candidate);
      if (result) {
        return {
          dictionaryId: dictionary.id,
          dictionaryName: dictionary.name,
          headword: result.headword,
          definition: result.html,
          format: 'h',
        };
      }
    }
    return null;
  }

  // DICT：纯文本定义；显示名优先 reader 解析的 00databaseshort label
  if (dictionary.kind === 'dict') {
    const result = await lookupDict(appService, dictionary, trimmed);
    if (!result) return null;
    return {
      dictionaryId: dictionary.id,
      dictionaryName: getDictLabel(await openDictReader(appService, dictionary), dictionary.name),
      headword: result.headword,
      definition: result.definition,
      format: 'm',
    };
  }

  // Slob：content-type 决定文本/HTML
  if (dictionary.kind === 'slob') {
    const result = await lookupSlob(appService, dictionary, trimmed);
    if (!result) return null;
    return {
      dictionaryId: dictionary.id,
      dictionaryName: dictionary.name,
      headword: result.headword,
      definition: result.definition,
      format: result.format,
    };
  }

  const reader = await openReader(appService, dictionary);

  // 候选词按优先级尝试：原样 → 小写 → 标题 → 大写 → 词形还原
  // （ran→run、mice→mouse、analyses→analysis），精确/大小写命中永远优先。
  let entry: Awaited<ReturnType<StarDictReader['lookup']>>;
  for (const candidate of buildLookupCandidates(trimmed)) {
    entry = await reader.lookup(candidate);
    if (entry) break;
    entry = await reader.resolveSynonym(candidate);
    if (entry) break;
  }
  if (!entry) return null;

  return {
    dictionaryId: dictionary.id,
    dictionaryName: reader.ifo['bookname'] || dictionary.name,
    headword: entry.word,
    // 释义按词典声明的 charset 解码（GBK 等非 UTF-8 词典）
    definition: new TextDecoder(reader.charset).decode(await reader.read(entry)),
    format: reader.ifo['sametypesequence'] || 'm',
  };
}

export async function lookupImportedDictionaries(
  appService: AppService,
  dictionaries: ImportedDictionary[],
  query: string,
): Promise<DictionaryLookupResult[]> {
  const results = await Promise.all(
    dictionaries.map((dictionary) =>
      lookupImportedDictionary(appService, dictionary, query).catch(() => null),
    ),
  );
  return results.filter((result): result is DictionaryLookupResult => result !== null);
}

/**
 * 跨所有已导入词典收集前缀候选词（去重、按序），用于查无结果时的相近词提示。
 * 任意词典读取失败忽略。
 */
export async function suggestImportedDictionaries(
  appService: AppService,
  dictionaries: ImportedDictionary[],
  query: string,
  limit = 5,
): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (word: string) => {
    if (!seen.has(word)) {
      seen.add(word);
      out.push(word);
    }
  };
  await Promise.all(
    dictionaries.map(async (dictionary) => {
      if (
        !isDictionaryEnabled(dictionary) ||
        dictionary.deletedAt ||
        dictionary.unavailable ||
        dictionary.unsupported
      ) {
        return;
      }
      try {
        // MDict/DICT/Slob 的前缀建议：MDict 需非 lazy 全量关键字表
        // （250MB 级内存/时间开销），上游 readest 同样未实现——均不贡献候选词。
        if (dictionary.kind !== 'stardict') return;
        const reader = await openReader(appService, dictionary);
        for (const word of await reader.suggest(trimmed, limit)) push(word);
      } catch {
        // 单个词典失败不影响其他
      }
    }),
  );
  return out.slice(0, limit);
}

/**
 * 限定的拼音候选尝试次数：真实词（含繁体变体）+ 少量组合词，逐一查本地词典。
 */
const MAX_PINYIN_LOOKUP_TRIES = 16;

export interface PinyinLookupResult {
  /** 转换出的候选汉字（真实词在前，按词频；组合词在后）— 无结果时作提示用。 */
  candidates: string[];
  /** 首个命中候选词在各词典中的词条。 */
  results: DictionaryLookupResult[];
}

/**
 * 拼音查词：把拉丁拼音输入（"pingguo"/"píngguǒ"）转换为候选汉字串，
 * 再用候选词查已导入的本地词典。返回 null 表示输入不是拼音（保持原英文兜底）。
 * 无任何候选命中时 results 为空、candidates 给出相近词提示（点击可重查）。
 *
 * 完全离线：转换走打包的拼音数据集（见 pinyin.ts / pinyinData.ts），
 * 词条内容仍来自用户本地词典。
 */
export async function lookupPinyinImportedDictionaries(
  appService: AppService,
  dictionaries: ImportedDictionary[],
  query: string,
): Promise<PinyinLookupResult | null> {
  const candidates = await buildPinyinCandidates(query);
  if (!candidates) return null;
  for (const candidate of candidates.slice(0, MAX_PINYIN_LOOKUP_TRIES)) {
    const results = await lookupImportedDictionaries(appService, dictionaries, candidate);
    if (results.length > 0) return { candidates, results };
  }
  return { candidates: candidates.slice(0, PINYIN_SUGGESTION_LIMIT), results: [] };
}
