import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookNote } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';
import {
  createWordNotesSyncStore,
  saveNoteScope,
  saveWordNote,
  removeWordNote,
} from '@/helpers/wordNotes';
import { resolveWordNote } from '@/utils/wordNotes';

vi.mock('@/i18n/i18n', () => ({ default: { changeLanguage: vi.fn() } }));
const saveSettings = vi.fn();
const env = { getAppService: async () => ({ saveSettings }) } as unknown as EnvConfigType;
const local: BookNote = {
  id: 'local',
  cfi: 'epubcfi(/6/2)',
  type: 'annotation',
  text: 'Read',
  note: '/riːd/',
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  saveSettings.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      wordNotes: undefined,
      wordNoteTombstones: undefined,
    },
  });
});

describe('word note persistence', () => {
  it('keeps ordinary annotations local by default', async () => {
    const saved = await saveNoteScope(env, local, false);
    expect(saved.wordNoteId).toBeUndefined();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('persists shared notes and restores them without opening the source book', async () => {
    const saved = await saveNoteScope(env, local, true);
    const snapshot = JSON.parse(JSON.stringify(saveSettings.mock.calls[0]![0]));
    useSettingsStore.setState({ settings: snapshot });
    expect(snapshot.wordNotes[0]).toMatchObject({
      id: saved.wordNoteId,
      word: 'read',
      note: '/riːd/',
    });
    expect(resolveWordNote(saved, snapshot.wordNotes).note).toBe('/riːd/');
  });

  it('updates the same shared note and resolves linked annotations to the new content', async () => {
    const saved = await saveNoteScope(env, local, true);
    await saveWordNote(env, 'READ', '/red/ in the past tense');
    const notes = useSettingsStore.getState().settings.wordNotes!;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(saved.wordNoteId);
    expect(resolveWordNote(saved, notes).note).toBe('/red/ in the past tense');
  });

  it('stops sharing while preserving the source annotation', async () => {
    const shared = await saveNoteScope(env, local, true);
    const detached = await saveNoteScope(env, shared, false);
    expect(detached).toMatchObject({ id: local.id, cfi: local.cfi, note: local.note });
    expect(detached.wordNoteId).toBeUndefined();
    expect(useSettingsStore.getState().settings.wordNotes).toEqual([]);
    expect(useSettingsStore.getState().settings.wordNoteTombstones).toEqual([
      { word: 'read', deletedAt: expect.any(Number) },
    ]);
  });

  it('does not remove a global word note when saving an unrelated local annotation', async () => {
    const shared = await saveNoteScope(env, local, true);
    await saveNoteScope(env, { ...local, id: 'another' }, false);
    expect(useSettingsStore.getState().settings.wordNotes![0]!.id).toBe(shared.wordNoteId);
  });

  it('keeps state unchanged when saving or deleting fails', async () => {
    const shared = await saveNoteScope(env, local, true);
    const before = useSettingsStore.getState().settings.wordNotes;
    saveSettings.mockRejectedValue(new Error('Disk full'));
    await expect(saveWordNote(env, 'read', 'new note')).rejects.toThrow('Disk full');
    expect(useSettingsStore.getState().settings.wordNotes).toBe(before);
    await expect(removeWordNote(env, shared.wordNoteId!)).rejects.toThrow('Disk full');
    expect(useSettingsStore.getState().settings.wordNotes).toBe(before);
  });

  it('preserves both entries when two saves happen concurrently', async () => {
    await Promise.all([saveWordNote(env, 'read', 'A'), saveWordNote(env, 'book', 'B')]);
    expect(
      useSettingsStore
        .getState()
        .settings.wordNotes!.map((n) => n.word)
        .sort(),
    ).toEqual(['book', 'read']);
    expect(saveSettings.mock.calls.at(-1)![0].wordNotes).toHaveLength(2);
  });

  it('merges a sync import with a local save that is still in progress', async () => {
    let finish!: () => void;
    saveSettings.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const localSave = saveWordNote(env, 'read', 'local');
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    const store = createWordNotesSyncStore(await env.getAppService());
    const importing = store.merge({
      wordNotes: [{ id: 'remote', word: 'book', note: 'remote', createdAt: 1, updatedAt: 2 }],
    });
    finish();
    await Promise.all([localSave, importing]);
    expect(useSettingsStore.getState().settings.wordNotes!.map((n) => n.word)).toEqual([
      'book',
      'read',
    ]);
    expect(saveSettings.mock.calls.at(-1)![0].wordNotes).toHaveLength(2);
  });

  it('keeps merged source IDs through editing and accepts an alias when removing', async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        wordNotes: [
          { id: 'a', aliases: ['b'], word: 'read', note: 'old', createdAt: 1, updatedAt: 2 },
        ],
      },
    });
    const note = await saveWordNote(env, 'read', 'new');
    expect(note.aliases).toEqual(['b']);
    await removeWordNote(env, 'b');
    expect(useSettingsStore.getState().settings.wordNotes).toEqual([]);
    expect(useSettingsStore.getState().settings.wordNoteTombstones).toEqual([
      { word: 'read', deletedAt: expect.any(Number) },
    ]);
  });
});
