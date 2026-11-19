import { describe, expect, it } from 'vitest';
import { findWordNoteRanges, normalizeWord, upsertWordNote } from '@/utils/wordNotes';
import type { WordNote } from '@/types/book';

const note: WordNote = {
  id: 'word-1',
  word: 'read',
  note: '/riːd/',
  createdAt: 1,
  updatedAt: 1,
};
const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('word notes', () => {
  it('normalizes case, Unicode width, and apostrophes but rejects phrases', () => {
    expect(normalizeWord('  Ｒｅａｄ  ')).toBe('read');
    expect(normalizeWord('can’t')).toBe("can't");
    expect(normalizeWord('two words')).toBe('');
    expect(normalizeWord('read!')).toBe('');
    expect(normalizeWord('123')).toBe('');
  });

  it('matches every occurrence in different books without matching word fragments', () => {
    for (const html of ['<p>Read reader READ. reread read</p>', '<p>We read.</p>']) {
      const ranges = findWordNoteRanges(doc(html), [note]);
      expect(ranges.map(({ range }) => range.toString())).toEqual(
        html.includes('reader') ? ['Read', 'READ', 'read'] : ['read'],
      );
      expect(ranges.every((match) => match.note.id === note.id)).toBe(true);
    }
  });

  it('finds words split across inline markup without changing the document', () => {
    const book = doc('<p>We <em>re</em>ad and r<strong>ea</strong>d.</p>');
    const before = book.body.innerHTML;
    expect(findWordNoteRanges(book, [note]).map(({ range }) => range.toString())).toEqual([
      'read',
      'read',
    ]);
    expect(book.body.innerHTML).toBe(before);
  });

  it('does not join words across paragraphs or include hidden content and ruby pronunciation', () => {
    const book = doc(
      '<p>re</p><p>ad</p><p hidden>read</p><script>read</script><style>read</style><ruby>read<rt>read</rt></ruby>',
    );
    expect(findWordNoteRanges(book, [note]).map(({ range }) => range.toString())).toEqual(['read']);
  });

  it('does not join fragments across explicit line breaks', () => {
    expect(findWordNoteRanges(doc('<p>re<br/>ad</p><p>re<hr/>ad</p>'), [note])).toEqual([]);
  });

  it('keeps apostrophes and hyphens inside words and preserves accents', () => {
    const notes = [note, { ...note, id: '2', word: "can't" }, { ...note, id: '3', word: 'café' }];
    const book = doc("<p>can't can’t read-only café cafe</p>");
    expect(findWordNoteRanges(book, notes).map(({ range }) => range.toString())).toEqual([
      "can't",
      'can’t',
      'café',
    ]);
  });

  it('updates one shared entry for the same word without discarding unrelated notes', () => {
    const other = { ...note, id: 'other', word: 'book' };
    const updated = upsertWordNote([note, other], 'READ', 'past: /red/', 42);
    expect(updated).toHaveLength(2);
    expect(updated[0]).toMatchObject({
      id: note.id,
      word: 'read',
      note: 'past: /red/',
      createdAt: 1,
      updatedAt: 42,
    });
    expect(updated[1]).toEqual(other);
    expect(() => upsertWordNote([], 'two words', 'note', 42)).toThrow();
    expect(() => upsertWordNote([], 'word', ' ', 42)).toThrow();
  });

  it('matches every Japanese particle inside unspaced sentences and across ruby markup', () => {
    const shared = { ...note, word: 'は', note: 'ha' };
    const book = doc(
      '<p>俺は放課後、西校舎へ向かいながら物思いにふける。</p><p>彼は本を読む。私は読む。</p><p><ruby>俺<rt>おれ</rt></ruby><span>は</span>読む。</p>',
    );
    expect(findWordNoteRanges(book, [shared]).map(({ range }) => range.toString())).toEqual([
      'は',
      'は',
      'は',
      'は',
    ]);
  });

  it('matches CJK words and Latin words adjacent to CJK without English fragment matches', () => {
    const shared = [{ ...note, word: '小麦色' }, note];
    const book = doc('<p>ターゲットは小麦色。小<span>麦</span>色。私はRead、reader。</p>');
    expect(findWordNoteRanges(book, shared).map(({ range }) => range.toString())).toEqual([
      '小麦色',
      '小麦色',
      'Read',
    ]);
  });

  it('normalizes halfwidth kana while preserving the original DOM range', () => {
    const shared = { ...note, word: 'カタカナ' };
    expect(
      findWordNoteRanges(doc('<p>このｶﾀｶﾅはカタカナです。</p>'), [shared]).map(({ range }) =>
        range.toString(),
      ),
    ).toEqual(['ｶﾀｶﾅ', 'カタカナ']);
  });

  it('removes all marks after the shared entry is removed', () => {
    expect(findWordNoteRanges(doc('<p>read Read</p>'), [])).toEqual([]);
  });
});
