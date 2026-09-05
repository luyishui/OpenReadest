/**
 * 网页词典 provider（Part 2.5）。
 *
 * 当本地词典（含拼音查词）未命中时，WiktionaryPopup 走网页兜底链：
 * Wiktionary REST（保留既有实现）→ Wikipedia 摘要（zh/en 按书籍语言）+
 * 模板化网页搜索链接卡片。本模块提供纯函数式的 URL 模板与 summary 抓取，
 * 不依赖 DOM/React，便于单测。
 *
 * 参考上游 readest 0.11.20：
 * - providers/wikipediaProvider.ts：REST summary API + 阅读链接
 * - providers/webSearchProvider.ts：`<a href>` 链接卡片（iframe 被
 *   X-Frame-Options 禁止，v1 一律外链打开）
 * - webSearchTemplates.ts：`%WORD%` 占位符 + encodeURIComponent
 *
 * 国内可达性说明（模板清单见 BUILTIN_WEB_SEARCHES）：
 * - Google（上游默认模板）：中国大陆不可直接访问，保留给海外用户；
 * - Bing（www.bing.com）：大陆部分网络可用但不稳定；
 * - 必应中国（cn.bing.com）+ 百度（www.baidu.com）：大陆可用替代。
 * UI 不做区域探测，全部入口平铺展示（保守策略，见 Part 2.5 决策）。
 */

export interface WikipediaSummary {
  /** 词条显示标题（display title）。 */
  title: string;
  /** 渲染后的摘要 HTML（Rest summary 的 extract_html，需 sanitize 后注入）。 */
  extractHtml: string;
  description?: string;
  /** 文章文本方向（rtl/ltr），透传给渲染容器。 */
  dir?: string;
  /** 规范文章链接（content_urls.desktop.page，缺失时按 URL 模板构造）。 */
  articleUrl: string;
  /** 缩略图源地址（可选）。 */
  thumbnailUrl?: string;
  /** 实际使用的语言代码（'zh'/'en'/…）。 */
  langCode: string;
}

/** 网页搜索模板条目。 */
export interface WebSearchEntry {
  id: string;
  /** 展示名（专有名词，不做翻译）。 */
  name: string;
  /** URL 模板，`%WORD%` 占位符在替换时 encodeURIComponent。 */
  urlTemplate: string;
  /** 中国大陆网络可达性（仅说明用途，UI 不平铺区域过滤）。 */
  chinaAccessible: boolean;
}

export const WEB_SEARCH_GOOGLE_ID = 'google';
export const WEB_SEARCH_BING_ID = 'bing';
export const WEB_SEARCH_BING_CN_ID = 'bing-cn';
export const WEB_SEARCH_BAIDU_ID = 'baidu';

/**
 * 内置网页搜索模板。
 * - Google：上游默认模板（define: 意图更准）；大陆不可达，保留海外用户；
 * - Bing：国际版；大陆部分网络不可达；
 * - Bing China（必应中国 cn.bing.com）：大陆可达替代；
 * - Baidu（百度）：大陆可达替代。
 */
export const BUILTIN_WEB_SEARCHES: WebSearchEntry[] = [
  {
    id: WEB_SEARCH_GOOGLE_ID,
    name: 'Google',
    chinaAccessible: false,
    urlTemplate: 'https://www.google.com/search?q=define:%WORD%&hl=en',
  },
  {
    id: WEB_SEARCH_BING_ID,
    name: 'Bing',
    chinaAccessible: false,
    urlTemplate: 'https://www.bing.com/search?q=%WORD%',
  },
  {
    id: WEB_SEARCH_BING_CN_ID,
    name: 'Bing China',
    chinaAccessible: true,
    urlTemplate: 'https://cn.bing.com/search?q=%WORD%',
  },
  {
    id: WEB_SEARCH_BAIDU_ID,
    name: 'Baidu',
    chinaAccessible: true,
    urlTemplate: 'https://www.baidu.com/s?wd=%WORD%',
  },
];

const BUILTIN_SEARCH_BY_ID = new Map(BUILTIN_WEB_SEARCHES.map((t) => [t.id, t]));

export const getBuiltinWebSearch = (id: string): WebSearchEntry | undefined =>
  BUILTIN_SEARCH_BY_ID.get(id);

/**
 * 替换 URL 模板中的 `%WORD%`（大小写不敏感）为 encodeURIComponent 后的词。
 * 兼容用户从编码工具粘贴导致的二次转义形式 `%25WORD%25`（对齐上游）。
 */
export const substituteUrlTemplate = (template: string, word: string): string => {
  const encoded = encodeURIComponent(word);
  return template.replace(/%25WORD%25/gi, encoded).replace(/%WORD%/gi, encoded);
};

/** 模板是否为合法可用的 URL 模板（http(s) + 含 %WORD% 占位符）。 */
export const isValidUrlTemplate = (template: string): boolean => {
  if (!/^https?:\/\//i.test(template.trim())) return false;
  return /%WORD%/i.test(template) || /%25WORD%25/i.test(template);
};

/**
 * 把书籍语言（'zh-CN'/'en-US'/'zh'/'en' 等）归一化为 Wikipedia 子域
 * 需要的语言代码（'zh'/'en'）。空值/未识别回退 'en'。
 */
export const normalizeBookLangCode = (lang?: string): string => {
  const code = (lang ?? '').split('-')[0]?.trim().toLowerCase();
  return code || 'en';
};

/** Wikipedia 词条链接：https://<lang>.wikipedia.org/wiki/<encoded> */
export const buildWikipediaUrl = (lang: string | undefined, word: string): string =>
  `https://${normalizeBookLangCode(lang)}.wikipedia.org/wiki/${encodeURIComponent(word)}`;

/** Wikipedia 站内搜索链接：https://<lang>.wikipedia.org/w/index.php?search=… */
export const buildWikipediaSearchUrl = (lang: string | undefined, word: string): string =>
  `https://${normalizeBookLangCode(lang)}.wikipedia.org/w/index.php?search=${encodeURIComponent(word)}`;

/**
 * Wiktionary 站内搜索链接。中文书籍（lang 以 zh 开头）走 zh.wiktionary.org，
 * 其余走 en.wiktionary.org（与 REST 兜底一致，REST 接口本身按词条语言
 * 返回全部语言释义，所以 REST URL 恒为 en 域）。
 */
export const buildWiktionarySearchUrl = (word: string, lang?: string): string => {
  const code = normalizeBookLangCode(lang);
  const host = code === 'zh' ? 'zh.wiktionary.org' : 'en.wiktionary.org';
  return `https://${host}/w/index.php?search=${encodeURIComponent(word)}`;
};

/** Wiktionary REST 释义接口（en.wiktionary.org 覆盖全部语言，保持既有兜底 URL）。 */
export const buildWiktionaryDefinitionUrl = (word: string): string =>
  `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;

interface WikipediaSummaryResponse {
  title?: string;
  titles?: { display?: string };
  description?: string;
  extract_html?: string;
  dir?: string;
  thumbnail?: { source?: string };
  content_urls?: {
    desktop?: { page?: string };
    mobile?: { page?: string };
  };
}

/**
 * 抓取 <lang>.wikipedia.org REST summary 摘要。best-effort：任何失败
 * （网络/HTTP 非 2xx/返回结构异常/被 abort）都返回 null 而不是抛错，
 * 便于与 Wiktionary 兜底 Promise.all 并行而不互相拖累。
 */
export const lookupWikipediaSummary = async (
  word: string,
  lang?: string,
  signal?: AbortSignal,
): Promise<WikipediaSummary | null> => {
  const langCode = normalizeBookLangCode(lang);
  try {
    const response = await fetch(
      `https://${langCode}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`,
      { signal },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as WikipediaSummaryResponse;
    // 缺 title 视为非摘要响应（如 404 风格的错误 JSON），不展示
    if (!data || typeof data !== 'object' || !data.title) return null;
    const articleUrl: string =
      data.content_urls?.desktop?.page ??
      data.content_urls?.mobile?.page ??
      buildWikipediaUrl(langCode, word);
    return {
      title: data.titles?.display ?? data.title,
      extractHtml: data.extract_html ?? '',
      ...(data.description ? { description: data.description } : {}),
      ...(data.dir ? { dir: data.dir } : {}),
      articleUrl,
      ...(data.thumbnail?.source ? { thumbnailUrl: data.thumbnail.source } : {}),
      langCode,
    };
  } catch {
    // abort / 网络错误：兜底入口是锦上添花，静默忽略
    return null;
  }
};