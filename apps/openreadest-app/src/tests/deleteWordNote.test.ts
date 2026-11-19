import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteWordNote } from '@/helpers/deleteWordNote';
import type { BookConfig, BookNote } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';

const state = vi.hoisted(() => ({
  configs: {} as Record<string, BookConfig>,
  saved: vi.fn(),
  removed: vi.fn(),
  marks: vi.fn(),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ library: [{ hash: 'a' }, { hash: 'b' }] }) },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getConfig: (key: string) => (key === 'a' ? state.configs[key] : null),
      updateBooknotes: (key: string, booknotes: BookNote[]) => {
        state.configs[key] = { ...state.configs[key]!, booknotes };
        return state.configs[key];
      },
    }),
  },
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getViewsById: () => [{ addAnnotation: state.marks }],
    }),
  },
}));
vi.mock('@/helpers/wordNotes', () => ({
  removeWordNote: (...args: unknown[]) => state.removed(...args),
}));
const source: BookNote = {
  id: 'source',
  type: 'annotation',
  cfi: 'cfi-a',
  wordNoteId: 'shared',
  text: 'は',
  note: 'ha',
  createdAt: 1,
  updatedAt: 1,
};
const highlight: BookNote = {
  ...source,
  id: 'highlight',
  wordNoteId: undefined,
  note: '',
  style: 'highlight',
};
const app = {
  loadBookConfig: async (book: { hash: string }) => state.configs[book.hash],
  saveBookConfig: state.saved,
};
const env = { getAppService: async () => app } as unknown as EnvConfigType;
beforeEach(() => {
  state.configs = {
    a: {
      updatedAt: 1,
      booknotes: [
        source,
        highlight,
        { ...source, id: 'unrelated', wordNoteId: 'other', cfi: 'cfi-b' },
      ],
    },
    b: { updatedAt: 1, booknotes: [{ ...source, id: 'closed-book', style: 'highlight' }] },
  };
  state.saved.mockReset().mockResolvedValue(undefined);
  state.removed.mockReset().mockResolvedValue(undefined);
  state.marks.mockReset();
});
describe('deleting a shared word note', () => {
  it('deletes linked notes and legacy highlights in open and closed books, preserving unrelated notes', async () => {
    await deleteWordNote(env, 'shared');
    expect(state.saved).toHaveBeenCalledTimes(2);
    expect(state.configs['a']!.booknotes!.find((n) => n.id === 'source')!.deletedAt).toBeTruthy();
    expect(
      state.configs['a']!.booknotes!.find((n) => n.id === 'highlight')!.deletedAt,
    ).toBeTruthy();
    expect(
      state.configs['a']!.booknotes!.find((n) => n.id === 'unrelated')!.deletedAt,
    ).toBeUndefined();
    const closed = state.saved.mock.calls.find((args) => args[0].hash === 'b')![1] as BookConfig;
    expect(closed.booknotes![0]!.deletedAt).toBeTruthy();
    expect(state.removed).toHaveBeenCalledWith(env, 'shared');
    expect(state.marks).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'foliate-note:cfi-a' }),
      true,
    );
  });
  it('preserves a highlight still used by an unrelated note at the same location', async () => {
    state.configs['a']!.booknotes!.push({ ...source, id: 'same-location', wordNoteId: undefined });
    await deleteWordNote(env, 'shared');
    expect(
      state.configs['a']!.booknotes!.find((n) => n.id === 'highlight')!.deletedAt,
    ).toBeUndefined();
  });
  it('keeps the shared entry available for retry if saving a source book fails', async () => {
    state.saved.mockRejectedValue(new Error('Disk full'));
    await expect(deleteWordNote(env, 'shared')).rejects.toThrow('Disk full');
    expect(state.removed).not.toHaveBeenCalled();
  });
});
