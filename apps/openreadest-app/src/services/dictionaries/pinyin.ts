/**
 * Chinese pinyin -> Hanzi query service (offline).
 *
 * Lets a reader look up a word by typing pinyin ("pingguo", "píngguǒ", with
 * or without tone marks/spaces). The pinyin string is normalized and split
 * into syllables, then mapped to real-word candidates from the bundled
 * dataset (see ./pinyinData.ts for sources & license), with a char-level
 * combinatorial fallback for words that are not in the word list. The
 * resulting Hanzi candidates are looked up in the user's imported local
 * dictionaries — conversion itself is always offline, no external API.
 *
 * Design notes:
 *  - The candidate list is intentionally *over-generated* (mirrors
 *    buildLookupCandidates): the dictionary lookup is the validator, so an
 *    extra candidate simply misses. Real words always come first, ordered by
 *    frequency; traditional-variant heads (蘋果) are interleaved right after
 *    their simplified form so that traditional-only dictionaries (漢典 mdx)
 *    resolve too; synthetic char combos are appended last.
 *  - A query is only treated as pinyin when at least one *real word* matches
 *    the syllables ("banana" splits into ba-na-na, but no such word exists,
 *    so it falls through to the normal English lookup path; "pingguo" has
 *    苹果 and is treated as pinyin).
 *  - The 1 MB dataset module is loaded lazily via dynamic import on first
 *    use (Next.js code-splits it; the reader bundle does not pay the cost
 *    unless pinyin lookup actually runs).
 */

// Tone marks + edge readings normalize to the same naked syllables:
// píngguǒ -> pingguo, lǜ -> lv (ü canonicalized to v in the dataset).
const TONE_STRIP: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v', ü: 'v',
  ń: 'n', ň: 'n', ǹ: 'n', ḿ: 'm',
};

/**
 * Fold an input into a plain lowercase letter string ("píng guǒ2" -> "pingguo")
 * or return null when it cannot be pinyin (contains CJK/other letters, or is
 * too short — single letters like "a" stay on the normal lookup path).
 */
export const normalizePinyinInput = (input: string): string | null => {
  const lower = input.trim().toLowerCase();
  if (!lower || lower.length < 2) return null;
  let out = '';
  for (const ch of lower) {
    if (ch >= 'a' && ch <= 'z') {
      out += ch;
      continue;
    }
    const mapped = TONE_STRIP[ch];
    if (mapped) {
      out += mapped;
      continue;
    }
    // Separators and numeric tones (ping2guo3) are ignored…
    if (
      ch === ' ' || ch === "'" || ch === '’' || ch === '-' || ch === '·' ||
      (ch >= '0' && ch <= '9')
    ) {
      continue;
    }
    return null; // …anything else (CJK, punctuation) is not pinyin.
  }
  // Length cap (defensive layer ①): real pinyin queries top out around
  // ~8 syllables × 6 letters; anything longer cannot be pinyin and would
  // risk combinatorial blowup in the split DFS below (e.g. a long English
  // word pasted into the lookup box reaches this path before rejection).
  if (out.length > MAX_PINYIN_INPUT_LETTERS) return null;
  return out.length >= 2 ? out : null;
};

/** Defensive layer ①: letter strings longer than this are never pinyin. */
const MAX_PINYIN_INPUT_LETTERS = 32;
/** Max complete syllable splits explored; inputs beyond this are not pinyin. */
const MAX_SPLITS = 12;
/** Defensive layer ③: global DFS step budget (safety net over layer ②). */
const MAX_SPLIT_STEPS = 5000;
/** Per-syllable chars considered for the synthetic fallback. */
const MAX_SYNTHETIC_PER_SYLLABLE = 4;
/** Cap for synthetic (char-combo) candidates. */
const MAX_SYNTHETIC_WORDS = 24;
/** Suggestion list length used by the popup. */
export const PINYIN_SUGGESTION_LIMIT = 8;

type WordEntry = { word: string; traditional: string };

interface PinyinIndex {
  /** All syllables, longest first (drives the greedy split). */
  syllableList: string[];
  /** "ping guo" -> real words, in descending frequency order. */
  wordIndex: Map<string, WordEntry[]>;
  /** char -> its readings (already canonical, ü as v). */
  charSyllables: Map<string, string[]>;
  /** char -> rank of the most frequent word containing it (0 = most common). */
  charWeight: Map<string, number>;
}

let indexPromise: Promise<PinyinIndex> | undefined;

const getPinyinIndex = (): Promise<PinyinIndex> => {
  indexPromise ??= (async () => {
    // Lazy: the dataset module (~1 MB) is code-split and only loaded here.
    const { PINYIN_CHARS, PINYIN_WORDS } = await import('./pinyinData');
    const charSyllables = new Map<string, string[]>();
    const syllableSet = new Set<string>();
    for (const [ch, syls] of PINYIN_CHARS) {
      const parts = syls.split(' ');
      charSyllables.set(ch, parts);
      for (const s of parts) syllableSet.add(s);
    }
    const wordIndex = new Map<string, WordEntry[]>();
    const charWeight = new Map<string, number>();
    PINYIN_WORDS.forEach(([word, variants, traditional], rank) => {
      for (const variant of variants.split('|')) {
        const list = wordIndex.get(variant) ?? [];
        list.push({ word, traditional });
        wordIndex.set(variant, list);
      }
      for (const ch of word) {
        const prev = charWeight.get(ch);
        if (prev === undefined || rank < prev) charWeight.set(ch, rank);
      }
    });
    return {
      syllableList: [...syllableSet].sort((a, b) => b.length - a.length),
      wordIndex,
      charSyllables,
      charWeight,
    };
  })();
  return indexPromise;
};

/**
 * All complete syllable splits, longest-first (so "wanguo" prefers
 * wang+uo — invalid — then backtracks to wan+guo). Capped at MAX_SPLITS.
 *
 * Defensive layers ②/③ against combinatorial blowup (e.g. a long letter
 * string whose tail cannot match any syllable — plain English reaches this
 * path before being rejected as "not pinyin"):
 *  ② `failedSuffixes` memoization — every `rest` is a suffix of the input
 *     (keyed by its length, which identifies it uniquely within one call);
 *     a suffix from which no complete split exists is never re-explored.
 *  ③ a global step budget stops collection entirely once exceeded.
 * Both degrade safely: buildPinyinCandidates returns null for insufficient
 * splits, so a partial/empty result keeps the normal English lookup path.
 */
const splitIntoSyllables = (text: string, syllableList: string[]): string[][] => {
  const results: string[][] = [];
  const failedSuffixes = new Set<number>();
  let steps = 0;
  const dfs = (rest: string, acc: string[]): void => {
    if (results.length >= MAX_SPLITS) return;
    if (!rest) {
      results.push(acc);
      return;
    }
    // rest is always a suffix of the input; its length identifies it.
    if (failedSuffixes.has(rest.length)) return;
    if (++steps > MAX_SPLIT_STEPS) return;
    const resultsBefore = results.length;
    for (const syllabus of syllableList) {
      if (rest.startsWith(syllabus)) {
        dfs(rest.slice(syllabus.length), [...acc, syllabus]);
        if (results.length >= MAX_SPLITS) return;
      }
    }
    // No split completed through this suffix → never retry it (②).
    if (results.length === resultsBefore) failedSuffixes.add(rest.length);
  };
  dfs(text, []);
  return results;
};

const pushUnique = (out: string[], seen: Set<string>, value: string): void => {
  if (!seen.has(value)) {
    seen.add(value);
    out.push(value);
  }
};

/**
 * Convert a pinyin query to an ordered list of Hanzi candidate words.
 * Returns null when the input is not pinyin (no valid syllable split, or no
 * real-word match — the caller then keeps its normal English fallback).
 */
export const buildPinyinCandidates = async (query: string): Promise<string[] | null> => {
  const letters = normalizePinyinInput(query);
  if (!letters) return null;
  const index = await getPinyinIndex();
  const splits = splitIntoSyllables(letters, index.syllableList);
  if (splits.length === 0) return null;

  // First split that resolves to real words wins (e.g. chang-an before chan-gan).
  let split: string[] | null = null;
  let entries: WordEntry[] | null = null;
  for (const candidate of splits) {
    const hit = index.wordIndex.get(candidate.join(' '));
    if (hit && hit.length > 0) {
      split = candidate;
      entries = hit;
      break;
    }
  }
  if (!split || !entries) return null;

  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    pushUnique(out, seen, entry.word);
    if (entry.traditional) pushUnique(out, seen, entry.traditional);
  }

  // Synthetic fallback for words missing from the bundled list (rare words in
  // the user's dictionaries): combine frequent per-syllable chars. Multi-syllable
  // products blow up, so only single/two/three-syllable queries get combos.
  if (split.length <= 3) {
    let combos = [''];
    outer: for (const syllabus of split) {
      // per-syllable chars, most frequent first
      const ranked = [...index.charSyllables.keys()]
        .filter((ch) => index.charSyllables.get(ch)!.includes(syllabus))
        .sort((a, b) => (index.charWeight.get(a) ?? Infinity) - (index.charWeight.get(b) ?? Infinity))
        .slice(0, MAX_SYNTHETIC_PER_SYLLABLE);
      const next: string[] = [];
      for (const combo of combos) {
        for (const ch of ranked) {
          next.push(combo + ch);
          if (next.length >= MAX_SYNTHETIC_WORDS) break outer;
        }
      }
      combos = next;
    }
    for (const combo of combos) pushUnique(out, seen, combo);
  }

  return out;
};