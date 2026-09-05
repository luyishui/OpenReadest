import DOMPurify from 'dompurify';
import React, { useEffect, useRef, useState } from 'react';

import Link from '@/components/Link';
import Popup from '@/components/Popup';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  DictionaryLookupResult,
  lookupImportedDictionaries,
  lookupPinyinImportedDictionaries,
  suggestImportedDictionaries,
} from '@/services/dictionaries/dictionaryService';
import { resolveMddResources } from '@/services/dictionaries/mdictReader';
import {
  WikipediaSummary,
  BUILTIN_WEB_SEARCHES,
  buildWiktionaryDefinitionUrl,
  buildWiktionarySearchUrl,
  buildWikipediaSearchUrl,
  lookupWikipediaSummary,
  substituteUrlTemplate,
} from '@/services/dictionaries/webProviders';
import { useSettingsStore } from '@/store/settingsStore';
import { Position } from '@/utils/sel';

type Definition = {
  definition: string;
  examples?: string[];
};

type WiktionaryResult = {
  partOfSpeech: string;
  definitions: Definition[];
  language: string;
};

type LookupState =
  | { state: 'loading' }
  | { state: 'local'; results: DictionaryLookupResult[]; viaPinyin?: boolean }
  | { state: 'suggestions'; suggestions: string[]; viaPinyin?: boolean }
  | { state: 'wiktionary'; results: WiktionaryResult[]; wikipedia: WikipediaSummary | null }
  // 网页兜底（本地词典 + 拼音 + Wiktionary 均未命中/失败）：
  // wiktionaryError=true 表示 Wiktionary 接口请求失败，false 表示返回空结果
  | { state: 'fallback'; wiktionaryError: boolean; wikipedia: WikipediaSummary | null };

interface WiktionaryPopupProps {
  word: string;
  lang?: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

const sanitizedMarkup = (html: string) => ({ __html: DOMPurify.sanitize(html) });

/** Wikipedia 摘要块：标题 + 描述 + 摘要 HTML + 阅读全文链接。 */
const WikipediaSection: React.FC<{ summary: WikipediaSummary }> = ({ summary }) => {
  const _ = useTranslation();
  return (
    <section className='mt-4'>
      <hgroup>
        <h2 className='text-base font-bold'>{summary.title}</h2>
        {summary.description && (
          <p className='text-sm italic opacity-75'>{summary.description}</p>
        )}
      </hgroup>
      {summary.extractHtml && (
        <div
          className='mt-2 text-sm'
          dir={summary.dir}
          dangerouslySetInnerHTML={sanitizedMarkup(summary.extractHtml)}
        />
      )}
      <p className='mt-2'>
        <Link href={summary.articleUrl} className='text-primary underline'>
          {_('Read on Wikipedia →')}
        </Link>
      </p>
    </section>
  );
};

/**
 * 网页入口链接卡片：Wiktionary（按书籍语言选 zh/en 域）+ Wikipedia
 * （zh/en 按书籍语言）+ 内置网页搜索模板（Google/Bing/必应中国/百度）。
 * 链接全部走组件 Link（Tauri 平台经 openUrl/native bridge 外链打开，
 * Web 端 _blank）。不做联网探测/开关（Part 2.5 保守决策：直接接入兜底链尾部）。
 */
const WebLinksSection: React.FC<{ word: string; lang?: string }> = ({ word, lang }) => {
  const _ = useTranslation();
  const links = [
    { id: 'wiktionary', name: 'Wiktionary', href: buildWiktionarySearchUrl(word, lang) },
    { id: 'wikipedia', name: 'Wikipedia', href: buildWikipediaSearchUrl(lang, word) },
    ...BUILTIN_WEB_SEARCHES.map((entry) => ({
      id: entry.id,
      name: entry.name,
      href: substituteUrlTemplate(entry.urlTemplate, word),
    })),
  ];
  return (
    <section className='mt-4'>
      <h2 className='text-sm font-semibold opacity-80'>{_('Look up on the web')}</h2>
      <div className='mt-2 flex flex-wrap gap-2'>
        {links.map((link) => (
          <Link
            key={link.id}
            href={link.href}
            className='btn btn-ghost btn-sm border border-base-300 normal-case'
          >
            {link.name}
          </Link>
        ))}
      </div>
    </section>
  );
};

const WiktionaryPopup: React.FC<WiktionaryPopupProps> = ({
  word,
  lang,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const [lookupWord, setLookupWord] = useState(word);
  const [lookup, setLookup] = useState<LookupState>({ state: 'loading' });
  const wiktionaryResultRef = useRef<HTMLDivElement>(null);
  // mdict 资源替换创建的 object URL（新查词开始或组件卸载时 revoke）
  const trackedUrlsRef = useRef<string[]>([]);
  // 已为哪一版 lookup 对象创建过 object URL：effect 因 settings.customDictionaries
  // 等变化重跑而 lookup 对象未变时，图片仍在显示中，不能 revoke
  const urlRoundLookupRef = useRef<LookupState | null>(null);
  const bookLang = typeof lang === 'string' ? lang : lang?.[0];

  useEffect(() => setLookupWord(word), [word]);

  useEffect(() => {
    const controller = new AbortController();

    const fetchDefinitions = async () => {
      setLookup({ state: 'loading' });
      try {
        const dictionaries = settings.customDictionaries ?? [];
        if (appService && dictionaries.length > 0) {
          const localResults = await lookupImportedDictionaries(
            appService,
            dictionaries,
            lookupWord,
          );
          if (controller.signal.aborted) return;
          if (localResults.length > 0) {
            setLookup({ state: 'local', results: localResults });
            return;
          }
          // 本地词典无结果：给出相近词候选（前缀建议），命中后用户可点击重查
          const suggestions = await suggestImportedDictionaries(
            appService,
            dictionaries,
            lookupWord,
          );
          if (controller.signal.aborted) return;
          if (suggestions.length > 0) {
            setLookup({ state: 'suggestions', suggestions });
            return;
          }
          // 拼音查词（"pingguo" → 苹果）：候选汉字命中本地词典则直接展示，
          // 否则把候选词作为提示（点击后按汉字重查）。转换完全离线。
          const byPinyin = await lookupPinyinImportedDictionaries(
            appService,
            dictionaries,
            lookupWord,
          );
          if (controller.signal.aborted) return;
          if (byPinyin) {
            if (byPinyin.results.length > 0) {
              setLookup({ state: 'local', results: byPinyin.results, viaPinyin: true });
              return;
            }
            if (byPinyin.candidates.length > 0) {
              setLookup({ state: 'suggestions', suggestions: byPinyin.candidates, viaPinyin: true });
              return;
            }
          }
        }

        // 本地词典与拼音全部未命中 → 网页兜底：Wiktionary REST（既有实现）与
        // Wikipedia 摘要（zh/en 按书籍语言，best-effort，任何失败返回 null）
        // 并行抓取，Wiktionary 兜底旁边直接提供 Wikipedia/网页搜索入口。
        // allSettled：Wiktionary 失败时 Wikipedia 摘要不丢（相互独立）。
        const [wiktionaryOutcome, wikipedia] = await Promise.allSettled([
          (async () => {
            const response = await fetch(buildWiktionaryDefinitionUrl(lookupWord), {
              signal: controller.signal,
            });
            if (!response.ok) throw new Error('Failed to fetch definitions');
            const json = await response.json();
            const results: WiktionaryResult[] | undefined = bookLang
              ? json[bookLang] || json['en']
              : json[Object.keys(json)[0]!];
            return results ?? [];
          })(),
          lookupWikipediaSummary(lookupWord, bookLang, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const wiktionaryResults =
          wiktionaryOutcome.status === 'fulfilled' ? wiktionaryOutcome.value : [];
        const wikipediaSummary = wikipedia.status === 'fulfilled' ? wikipedia.value : null;
        if (wiktionaryResults.length > 0) {
          setLookup({ state: 'wiktionary', results: wiktionaryResults, wikipedia: wikipediaSummary });
        } else {
          setLookup({
            state: 'fallback',
            wiktionaryError: wiktionaryOutcome.status === 'rejected',
            wikipedia: wikipediaSummary,
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setLookup({ state: 'fallback', wiktionaryError: true, wikipedia: null });
      }
    };

    fetchDefinitions();
    return () => controller.abort();
  }, [appService, bookLang, lookupWord, settings.customDictionaries]);

  useEffect(() => {
    const container = wiktionaryResultRef.current;
    if (!container || lookup.state !== 'wiktionary') return;

    const handleDictionaryLink = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
        'a[rel="mw:WikiLink"]',
      );
      const title = link?.getAttribute('title');
      if (!title) return;
      event.preventDefault();
      setLookupWord(title);
    };

    container.addEventListener('click', handleDictionaryLink);
    return () => container.removeEventListener('click', handleDictionaryLink);
  }, [lookup.state]);

  // mdict 结果的 <img> 资源替换：渲染完成后从 .mdd 读取字节并换 object URL
  useEffect(() => {
    // 新查词开始（effect 因 lookup 换成新对象而重跑）：此前轮次的 object URL
    // 对应的图片已被新查词内容替换，先 revoke 再开始本轮，防止连续查词把
    // 图片 Blob 累积到弹窗关闭。settings.customDictionaries 等变化导致的
    // 重跑（lookup 对象同一）跳过 revoke，不打断当前正在显示的图片。
    // 卸载路径仍有兜底 revoke（见下方 unmount effect）。
    if (urlRoundLookupRef.current !== lookup) {
      const tracked = trackedUrlsRef.current;
      for (const url of tracked) URL.revokeObjectURL(url);
      tracked.length = 0;
      urlRoundLookupRef.current = lookup;
    }
    const container = wiktionaryResultRef.current;
    if (!container || lookup.state !== 'local' || !appService) return;

    const dictionaries = settings.customDictionaries ?? [];
    let cancelled = false;
    const resolveAll = async () => {
      // 每轮独立的 URL 列表：effect 因 lookup 切换重跑时，本轮的 object URL
      // 在本轮内 revoke（否则长阅读会话连续查词会累积图片 Blob 内存）。
      const roundUrls: string[] = [];
      try {
        for (const result of lookup.results) {
          if (cancelled) return;
          const dictionary = dictionaries.find((d) => d.id === result.dictionaryId);
          if (!dictionary || dictionary.kind !== 'mdict') continue;
          const article = container.querySelector<HTMLElement>(
            `article[data-dictionary-id="${result.dictionaryId}"]`,
          );
          if (!article) continue;
          try {
            await resolveMddResources(appService, dictionary, article, roundUrls);
          } catch (error) {
            console.warn('resolveMddResources failed', error);
          }
        }
      } finally {
        if (cancelled) {
          for (const url of roundUrls) URL.revokeObjectURL(url);
        } else {
          trackedUrlsRef.current.push(...roundUrls);
        }
      }
    };
    resolveAll();
    return () => {
      cancelled = true;
    };
  }, [appService, lookup, settings.customDictionaries]);

  // 卸载时 revoke mdict 资源 object URL
  useEffect(() => {
    const tracked = trackedUrlsRef.current;
    return () => {
      for (const url of tracked) URL.revokeObjectURL(url);
      tracked.length = 0;
    };
  }, []);

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        height={popupHeight}
        position={position}
        className='select-text'
        onDismiss={onDismiss}
      >
        <div className='flex h-full flex-col'>
          <main className='flex-grow overflow-y-auto p-4 font-sans'>
            {lookup.state === 'loading' && (
              <div className='flex h-full items-center justify-center'>
                <span className='loading loading-spinner' aria-label={_('Loading')} />
              </div>
            )}

            {lookup.state === 'local' && (
              <div ref={wiktionaryResultRef} className='space-y-5'>
                {lookup.results.map((result) => (
                  <article key={result.dictionaryId} data-dictionary-id={result.dictionaryId}>
                    <hgroup>
                      <h1 className='text-lg font-bold'>{result.headword}</h1>
                      <p className='text-sm italic opacity-75'>{result.dictionaryName}</p>
                      {lookup.viaPinyin && (
                        <p className='text-xs opacity-60'>{_('Searched by pinyin')}</p>
                      )}
                    </hgroup>
                    {result.format === 'm' || result.format === 't' ? (
                      <p className='mt-3 whitespace-pre-wrap'>{result.definition}</p>
                    ) : (
                      <div
                        className='mt-3'
                        dangerouslySetInnerHTML={sanitizedMarkup(result.definition)}
                      />
                    )}
                  </article>
                ))}
              </div>
            )}

            {lookup.state === 'wiktionary' && (
              <div ref={wiktionaryResultRef}>
                <hgroup>
                  <h1 className='text-lg font-bold'>{lookupWord}</h1>
                  <p className='text-sm italic opacity-75'>{lookup.results[0]!.language}</p>
                </hgroup>
                {lookup.results.map(({ partOfSpeech, definitions }, resultIndex) => (
                  <section key={`${partOfSpeech}-${resultIndex}`}>
                    <h2 className='mt-4 text-base font-semibold'>{partOfSpeech}</h2>
                    <ol className='list-decimal pl-8'>
                      {definitions.map(({ definition, examples }, definitionIndex) =>
                        definition ? (
                          <li key={definitionIndex}>
                            <span dangerouslySetInnerHTML={sanitizedMarkup(definition)} />
                            {examples?.length ? (
                              <ul className='list-disc pl-8 text-sm italic opacity-75'>
                                {examples.map((example, exampleIndex) => (
                                  <li
                                    key={exampleIndex}
                                    dangerouslySetInnerHTML={sanitizedMarkup(example)}
                                  />
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ) : null,
                      )}
                    </ol>
                  </section>
                ))}
                {lookup.wikipedia && <WikipediaSection summary={lookup.wikipedia} />}
                <WebLinksSection word={lookupWord} lang={bookLang} />
              </div>
            )}

            {lookup.state === 'fallback' && (
              <div className='flex flex-col'>
                <div className='text-center'>
                  {lookup.wiktionaryError ? (
                    <>
                      <h1 className='text-lg font-bold'>{_('Error')}</h1>
                      <p className='mt-1 text-sm opacity-75'>
                        {_('Unable to load the word. Try searching directly on Wiktionary.')}
                      </p>
                    </>
                  ) : (
                    <>
                      <h1 className='text-lg font-bold'>{_('Not found')}</h1>
                      <p className='mt-1 text-sm opacity-75'>
                        {_('No exact match for')}{' '}
                        <span className='font-semibold'>{lookupWord}</span>
                      </p>
                    </>
                  )}
                </div>
                {lookup.wikipedia && <WikipediaSection summary={lookup.wikipedia} />}
                <WebLinksSection word={lookupWord} lang={bookLang} />
              </div>
            )}

            {lookup.state === 'suggestions' && (
              <div className='flex h-full flex-col items-center justify-center gap-3 text-center'>
                <h1 className='text-lg font-bold'>{_('Not found')}</h1>
                <p className='text-sm opacity-75'>
                  {_('No exact match for')}{' '}
                  <span className='font-semibold'>{lookupWord}</span>
                </p>
                {lookup.viaPinyin && (
                  <p className='text-xs opacity-60'>{_('Searched by pinyin')}</p>
                )}
                <div className='flex flex-wrap justify-center gap-2'>
                  {lookup.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type='button'
                      className='btn btn-ghost btn-sm'
                      onClick={() => setLookupWord(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <p className='text-xs opacity-60'>
                  {_('Did you mean one of these?')}{' '}
                  <a
                    href={`https://en.wiktionary.org/w/index.php?search=${encodeURIComponent(lookupWord)}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='text-primary underline'
                  >
                    Wiktionary
                  </a>
                </p>
              </div>
            )}
          </main>
          {(lookup.state === 'wiktionary' || lookup.state === 'fallback') && (
            <footer className='mt-auto'>
              <div className='flex items-center px-4 py-2 text-sm opacity-60'>
                Source: Wiktionary (CC BY-SA)
              </div>
            </footer>
          )}
        </div>
      </Popup>
    </div>
  );
};

export default WiktionaryPopup;