import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteBooknote } from '@/helpers/annotations';
import type { BookNote } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';

const state = vi.hoisted(() => ({
  notes: [] as BookNote[],
  wordNotes: [] as { id: string }[],
  removed: [] as string[],
  save: vi.fn(),
  removeShared: vi.fn(),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getConfig: () => ({ booknotes: state.notes }),
      updateBooknotes: (_key: string, notes: BookNote[]) => {
        state.notes = notes;
        return { booknotes: notes };
      },
      saveConfig: state.save,
    }),
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { wordNotes: state.wordNotes } }) },
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getViewsById: () =>
        [0, 1].map(() => ({
          addAnnotation: (note: BookNote & { value?: string }, remove: boolean) => {
            if (remove) state.removed.push(note.value ?? note.cfi);
          },
        })),
    }),
  },
}));
vi.mock('@/helpers/wordNotes', () => ({
  removeWordNote: (...args: unknown[]) => state.removeShared(...args),
}));

const local: BookNote = {
  id: 'note',
  type: 'annotation',
  cfi: 'cfi-a',
  text: 'は',
  note: 'ha',
  createdAt: 1,
  updatedAt: 1,
};
const highlight: BookNote = {
  ...local,
  id: 'highlight',
  style: 'highlight',
  color: 'yellow',
  note: '',
};
const env = {} as EnvConfigType;
beforeEach(() => {
  state.notes = [highlight, local, { ...highlight, id: 'other-place', cfi: 'cfi-b' }];
  state.removed = [];
  state.save.mockReset().mockResolvedValue(undefined);
  state.removeShared.mockReset().mockResolvedValue(undefined);
});

describe('deleting annotations', () => {
  it('deletes a legacy separate highlight and the note while preserving other locations', async () => {
    await deleteBooknote(env, 'book-view', local);
    expect(state.notes.find((n) => n.id === 'note')!.deletedAt).toBeTruthy();
    expect(state.notes.find((n) => n.id === 'highlight')!.deletedAt).toBeTruthy();
    expect(state.notes.find((n) => n.id === 'other-place')!.deletedAt).toBeUndefined();
    expect(state.removed.filter((value) => value === 'cfi-a')).toHaveLength(2);
    expect(state.removed.filter((value) => value === 'foliate-note:cfi-a')).toHaveLength(2);
  });
  it('removes the linked shared entry when deleting its source note', async () => {
    const linked = { ...local, wordNoteId: 'shared' };
    state.notes = [highlight, linked];
    await deleteBooknote(env, 'book-view', linked);
    expect(state.removeShared).toHaveBeenCalledWith(env, 'shared');
  });
  it('keeps a highlight that is still used by another note at the same selection', async () => {
    state.notes.push({ ...local, id: 'second-note', note: 'another note' });
    await deleteBooknote(env, 'book-view', local);
    expect(state.notes.find((n) => n.id === 'highlight')!.deletedAt).toBeUndefined();
    expect(state.removed).not.toContain('cfi-a');
    expect(state.removed).not.toContain('foliate-note:cfi-a');
  });
  it('does not change notes or visual marks when removing the shared entry fails', async () => {
    const linked = { ...local, wordNoteId: 'shared' };
    state.notes = [highlight, linked];
    state.removeShared.mockRejectedValue(new Error('Disk full'));
    await expect(deleteBooknote(env, 'book-view', linked)).rejects.toThrow('Disk full');
    expect(state.notes.every((n) => !n.deletedAt)).toBe(true);
    expect(state.removed).toEqual([]);
  });
});
