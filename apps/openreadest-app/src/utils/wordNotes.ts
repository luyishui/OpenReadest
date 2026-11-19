import type { BookNote, WordNote, WordNoteTombstone } from '@/types/book';

export interface WordNotesData {
  wordNotes?: WordNote[];
  wordNoteTombstones?: WordNoteTombstone[];
}

export const getWordNoteById = (notes: WordNote[], id?: string | null) =>
  id ? notes.find((entry) => entry.id === id || entry.aliases?.includes(id)) : undefined;

const compare = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

// Merge by normalized word, retaining old IDs so source annotations stay linked.
// A deletion wins ties; a later explicit edit can recreate the word.
export const mergeWordNotesData = (...sources: WordNotesData[]): Required<WordNotesData> => {
  const deleted = new Map<string, number>();
  for (const source of sources) {
    for (const tombstone of source.wordNoteTombstones ?? []) {
      deleted.set(tombstone.word, Math.max(deleted.get(tombstone.word) ?? 0, tombstone.deletedAt));
    }
  }
  const groups = new Map<string, WordNote[]>();
  for (const source of sources) {
    for (const note of source.wordNotes ?? []) {
      if (deleted.has(note.word) && note.updatedAt <= deleted.get(note.word)!) continue;
      const group = groups.get(note.word) ?? [];
      group.push(note);
      groups.set(note.word, group);
    }
  }
  const wordNotes = [...groups.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([word, notes]) => {
      const winner = [...notes].sort(
        (a, b) =>
          compare(b.updatedAt, a.updatedAt) || compare(b.note, a.note) || compare(b.id, a.id),
      )[0]!;
      const ids = [...new Set(notes.flatMap((note) => [note.id, ...(note.aliases ?? [])]))].sort();
      return {
        id: ids[0]!,
        ...(ids.length > 1 ? { aliases: ids.slice(1) } : {}),
        word,
        note: winner.note,
        createdAt: Math.min(...notes.map((note) => note.createdAt)),
        updatedAt: winner.updatedAt,
      };
    });
  return {
    wordNotes,
    wordNoteTombstones: [...deleted.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([word, deletedAt]) => ({ word, deletedAt })),
  };
};

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_CHARACTERS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

const WORD_PATTERN = /[\p{L}\p{N}\p{M}]+(?:['’\-‐‑][\p{L}\p{N}\p{M}]+)*/gu;

export const normalizeWord = (text: string): string => {
  const word = text.trim().normalize('NFKC').replace(/’/g, "'").replace(/[‐‑]/g, '-').toLowerCase();
  return /^[\p{L}\p{N}\p{M}]+(?:['-][\p{L}\p{N}\p{M}]+)*$/u.test(word) && /\p{L}/u.test(word)
    ? word
    : '';
};

export const upsertWordNote = (
  notes: WordNote[],
  text: string,
  content: string,
  now = Date.now(),
): WordNote[] => {
  const word = normalizeWord(text);
  if (!word || !content.trim()) throw new Error('A single word and a non-empty note are required');
  const existing = notes.find((note) => note.word === word);
  const updated: WordNote = {
    id: existing?.id ?? crypto.randomUUID(),
    ...(existing?.aliases?.length ? { aliases: existing.aliases } : {}),
    word,
    note: content.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return existing
    ? notes.map((note) => (note.id === existing.id ? updated : note))
    : [...notes, updated];
};

export const resolveWordNote = (note: BookNote, wordNotes: WordNote[] = []): BookNote => {
  const shared = getWordNoteById(wordNotes, note.wordNoteId);
  return shared ? { ...note, note: shared.note, updatedAt: shared.updatedAt } : note;
};

export interface WordNoteMatch {
  note: WordNote;
  range: Range;
}

// Read text without inserting elements or changing the book's CFI locations.
export const findWordNoteRanges = (doc: Document, notes: WordNote[]): WordNoteMatch[] => {
  if (!doc.body || !notes.length) return [];
  const index = new Map(notes.map((note) => [note.word, note]));
  const matches: WordNoteMatch[] = [];
  const cjkNotes = notes.filter((note) => CJK_PATTERN.test(note.word));
  const groups: Text[][] = [];
  let block: Element | null = null;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (
        element?.closest('script, style, noscript, textarea, rt, [hidden], [aria-hidden="true"]')
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.nodeType === Node.TEXT_NODE || element?.matches('br, hr'))
        return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) {
      block = null;
      continue;
    }
    const parent =
      node.parentElement?.closest(
        'p, div, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, section, article, body',
      ) ?? null;
    if (parent !== block || !groups.length) {
      groups.push([]);
      block = parent;
    }
    groups[groups.length - 1]!.push(node as Text);
  }
  for (const nodes of groups) {
    const text = nodes.map((node) => node.data).join('');
    const offsets: number[] = [];
    let length = 0;
    for (const node of nodes) {
      offsets.push(length);
      length += node.length;
    }
    const candidates: { note: WordNote; start: number; end: number }[] = [];
    // CJK sentences have no spaces. Keep Latin word boundaries without treating
    // adjacent kana/kanji as part of an English word.
    const latinText = text.replace(CJK_CHARACTERS, (char) => ' '.repeat(char.length));
    for (const match of latinText.matchAll(WORD_PATTERN)) {
      const note = index.get(normalizeWord(match[0]));
      if (note) candidates.push({ note, start: match.index, end: match.index + match[0].length });
    }
    if (cjkNotes.length) {
      let normalized = '';
      const starts: number[] = [];
      const ends: number[] = [];
      let fallbackOffset = 0;
      const segments =
        typeof Intl.Segmenter === 'function'
          ? new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)
          : Array.from(text).map((segment) => {
              const index = fallbackOffset;
              fallbackOffset += segment.length;
              return { segment, index };
            });
      for (const { segment, index: offset } of segments) {
        const value = segment
          .normalize('NFKC')
          .toLowerCase()
          .replace(/’/g, "'")
          .replace(/[‐‑]/g, '-');
        normalized += value;
        for (let i = 0; i < value.length; i++) {
          starts.push(offset);
          ends.push(offset + segment.length);
        }
      }
      for (const note of cjkNotes) {
        for (
          let at = normalized.indexOf(note.word);
          at >= 0;
          at = normalized.indexOf(note.word, at + 1)
        ) {
          candidates.push({ note, start: starts[at]!, end: ends[at + note.word.length - 1]! });
        }
      }
    }
    candidates.sort((a, b) => a.start - b.start || b.end - a.end);
    let startNode = 0;
    for (const { note, start, end } of candidates) {
      while (startNode + 1 < nodes.length && offsets[startNode + 1]! <= start) startNode++;
      let endNode = startNode;
      while (endNode + 1 < nodes.length && offsets[endNode + 1]! < end) endNode++;
      const range = doc.createRange();
      range.setStart(nodes[startNode]!, start - offsets[startNode]!);
      range.setEnd(nodes[endNode]!, end - offsets[endNode]!);
      matches.push({ note, range });
    }
  }
  return matches;
};
