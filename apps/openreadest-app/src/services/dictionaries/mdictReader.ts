/**
 * MDict (.mdx/.mdd) reader — adapted from upstream readest's mdictProvider
 * to the local function-based dictionary service.
 *
 * Wraps `js-mdict`'s `MDX` / `MDD` classes via `MDX.create(blob)` /
 * `MDD.create(blob)`. Both factories accept any `Blob` whose
 * `slice(start, end).arrayBuffer()` resolves the bytes — init reads only the
 * header + key index (lazy mode), lookups decode only the relevant key block
 * on demand.
 *
 * Encrypted MDX (record-block encryption, requires a user passcode) is
 * detected at open time and surfaced as `unsupported`.
 */
import type { AppService } from '@/types/system';
import type { ImportedDictionary } from './types';

export interface MdictLookupResult {
  headword: string;
  /** 定义内容（HTML）。 */
  html: string;
}

interface MDXMeta {
  encrypt?: number;
}

interface MDXInstance {
  meta: MDXMeta;
  header: Record<string, unknown>;
  lookup(word: string): { keyText: string; definition: string | null } | Promise<{ keyText: string; definition: string | null }>;
  prefix(prefix: string): Array<{ keyText: string }>;
}

export interface MDDInstance {
  locateBytes(
    key: string,
  ):
    | { keyText: string; data: Uint8Array | null }
    | Promise<{ keyText: string; data: Uint8Array | null }>;
}

interface OpenedMdict {
  mdx: MDXInstance;
  mdds: MDDInstance[];
  /** MDX 头声明的词典名（如词典全名），用于显示。 */
  title?: string;
  /** 创建过的 object URL（供 UI revoke）。 */
  trackedUrls: string[];
}

const openCache = new Map<string, Promise<OpenedMdict>>();

export const clearMdictCache = (dictionaryId: string) => {
  openCache.delete(dictionaryId);
};

const isEncryptedError = (message: string): boolean =>
  /encrypted file|user identification/i.test(message);

const isRecordBlockEncrypted = (meta?: MDXMeta): boolean => ((meta?.encrypt ?? 0) & 1) === 1;

/** 打开（并缓存）一个 MDict bundle；加密/损坏抛错（带 unsupported 标记）。 */
export const openMdict = async (
  appService: AppService,
  dictionary: ImportedDictionary,
): Promise<OpenedMdict> => {
  const cached = openCache.get(dictionary.id);
  if (cached) return cached;

  const promise = (async () => {
    if (!dictionary.files.mdx) {
      throw new Error('MDict bundle is missing the .mdx file');
    }
    const { MDX, MDD } = (await import('js-mdict')) as {
      MDX: {
        create(file: Blob, options?: { lazy?: boolean }): Promise<MDXInstance>;
      };
      MDD: {
        create(file: Blob, options?: { lazy?: boolean }): Promise<MDDInstance>;
      };
    };

    const mdxFile = await appService.openFile(
      `${dictionary.bundleDir}/${dictionary.files.mdx}`,
      'Dictionaries',
    );
    let mdx: MDXInstance;
    try {
      // Lazy mode: skip the upfront decompress-every-key-block + sort that
      // costs ~80 s on a 250 MB MDX. Lookups decode only the relevant key
      // block on demand (~tens of ms each).
      mdx = await MDX.create(mdxFile, { lazy: true });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (isEncryptedError(message)) {
        throw Object.assign(
          new Error(
            'This MDX is registered to a specific user (record-block encryption); passcode-protected dictionaries are not supported.',
          ),
          { unsupported: true },
        );
      }
      throw err;
    }
    // `meta.encrypt` is a bitmap（js-mdict 约定：bit0=record/key-header 需
    // 用户口令，bit1=key-info 由 ripemd128-based mdxDecrypt 透明处理）。
    // 注意该位约定与官方 MDict 规范相反（官方 1=key info、2=record）；
    // 若真实词典 Encrypted=2 且 record 实际加密，js-mdict 会静默返回乱码
    // 而非报错——上游限制，本层无法检测。
    if (isRecordBlockEncrypted(mdx.meta)) {
      throw Object.assign(
        new Error(
          'This MDX is registered to a specific user (record-block encryption); passcode-protected dictionaries are not supported.',
        ),
        { unsupported: true },
      );
    }

    const mdds: MDDInstance[] = [];
    for (const name of dictionary.files.mdd ?? []) {
      try {
        const mddFile = await appService.openFile(
          `${dictionary.bundleDir}/${name}`,
          'Dictionaries',
        );
        // lazy：大 .mdd 不必在导入/首次查询时解压全部 key block
        mdds.push(await MDD.create(mddFile, { lazy: true }));
      } catch (err) {
        console.warn('Failed to open MDD', name, err);
      }
    }
    const rawTitle = mdx.header['Title'];
    const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : undefined;
    return { mdx, mdds, title, trackedUrls: [] };
  })();

  openCache.set(dictionary.id, promise);
  promise.catch(() => openCache.delete(dictionary.id));
  return promise;
};

/** 查询一个词条；未命中返回 null。 */
export const lookupMdict = async (
  appService: AppService,
  dictionary: ImportedDictionary,
  word: string,
): Promise<MdictLookupResult | null> => {
  const { mdx } = await openMdict(appService, dictionary);
  const result = await mdx.lookup(word);
  if (!result || result.definition == null) return null;
  return { headword: result.keyText || word, html: result.definition };
};

/**
 * 把渲染容器内 `<img src="...">` 的资源引用替换为 `.mdd` 里的实际字节
 * （object URL）。返回创建的 URL 列表，调用方负责在组件卸载时 revoke。
 * 纯 DOM 操作，仅 Tauri/Web 渲染环境可用。
 */
export async function resolveMddResources(
  appService: AppService,
  dictionary: ImportedDictionary,
  container: HTMLElement,
  trackedUrls: string[],
): Promise<void> {
  const { mdds } = await openMdict(appService, dictionary);
  if (!mdds.length) return;
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('img[src]'));
  if (!imgs.length) return;

  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return;
      // 先按原样尝试；失败再剥一个前导 /（部分 MDX 用 /images/x.png 而
      // MDD 存 images/x.png）。
      const candidates = src.startsWith('/') ? [src, src.slice(1)] : [src];
      for (const mdd of mdds) {
        for (const key of candidates) {
          try {
            const located = await mdd.locateBytes(key);
            if (located.data) {
              const blob = new Blob([new Uint8Array(located.data)]);
              const url = URL.createObjectURL(blob);
              trackedUrls.push(url);
              img.setAttribute('src', url);
              return;
            }
          } catch (err) {
            console.warn('mdd.locateBytes failed for', key, err);
          }
        }
      }
    }),
  );
}
