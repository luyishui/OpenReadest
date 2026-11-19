import type { BookNote } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { WordNotesSyncStore } from '@/services/webdav/sync/wordNotesSync';
import { useSettingsStore } from '@/store/settingsStore';
import {
  getWordNoteById,
  mergeWordNotesData,
  normalizeWord,
  upsertWordNote,
  type WordNotesData,
} from '@/utils/wordNotes';

let pendingWrite: Promise<unknown> = Promise.resolve();

// Local edits and sync imports share a queue and always merge against the latest
// state inside it. An edit made during a download must not be overwritten.
const updateWordNotes = (
  appService: AppService,
  update: (data: WordNotesData) => WordNotesData,
) => {
  const operation = pendingWrite.then(async () => {
    const { settings } = useSettingsStore.getState();
    const data = update(settings);
    if (
      Object.entries(data).every(
        ([key, value]) =>
          JSON.stringify(settings[key as keyof WordNotesData]) === JSON.stringify(value),
      )
    )
      return data;
    await appService.saveSettings({ ...settings, ...data });
    useSettingsStore.getState().setSettings({ ...useSettingsStore.getState().settings, ...data });
    return data;
  });
  pendingWrite = operation.catch(() => {});
  return operation;
};

export const createWordNotesSyncStore = (appService: AppService): WordNotesSyncStore => ({
  read: async () => {
    await pendingWrite;
    const { wordNotes, wordNoteTombstones } = useSettingsStore.getState().settings;
    return { wordNotes, wordNoteTombstones };
  },
  merge: (remote) => updateWordNotes(appService, (local) => mergeWordNotesData(local, remote)),
});

export const saveWordNote = async (envConfig: EnvConfigType, word: string, content: string) => {
  const appService = await envConfig.getAppService();
  const data = await updateWordNotes(appService, (local) => {
    const key = normalizeWord(word);
    const existing = local.wordNotes?.find((note) => note.word === key);
    const deletedAt = local.wordNoteTombstones?.find((note) => note.word === key)?.deletedAt ?? 0;
    const now = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1, deletedAt + 1);
    return { wordNotes: upsertWordNote(local.wordNotes ?? [], word, content, now) };
  });
  return data.wordNotes!.find((note) => note.word === normalizeWord(word))!;
};

export const removeWordNote = async (envConfig: EnvConfigType, id: string) => {
  const appService = await envConfig.getAppService();
  await updateWordNotes(appService, (local) => {
    const notes = local.wordNotes ?? [];
    const target = getWordNoteById(notes, id);
    if (!target) return { wordNotes: notes, wordNoteTombstones: local.wordNoteTombstones ?? [] };
    const previous =
      local.wordNoteTombstones?.find((note) => note.word === target.word)?.deletedAt ?? 0;
    return {
      wordNotes: notes.filter((note) => note.word !== target.word),
      wordNoteTombstones: [
        ...(local.wordNoteTombstones ?? []).filter((note) => note.word !== target.word),
        { word: target.word, deletedAt: Math.max(Date.now(), target.updatedAt + 1, previous + 1) },
      ],
    };
  });
};

export const saveNoteScope = async (
  envConfig: EnvConfigType,
  annotation: BookNote,
  allBooks: boolean,
): Promise<BookNote> => {
  if (allBooks) {
    const shared = await saveWordNote(envConfig, annotation.text ?? '', annotation.note);
    return { ...annotation, wordNoteId: shared.id };
  }
  if (annotation.wordNoteId) await removeWordNote(envConfig, annotation.wordNoteId);
  return { ...annotation, wordNoteId: undefined };
};
