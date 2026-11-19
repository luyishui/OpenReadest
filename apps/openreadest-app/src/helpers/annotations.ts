import type { BookNote } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { removeWordNote } from './wordNotes';

const NOTE_PREFIX = 'foliate-note:';

export const deleteBooknote = async (envConfig: EnvConfigType, bookKey: string, note: BookNote) => {
  const { getConfig, updateBooknotes, saveConfig } = useBookDataStore.getState();
  const config = getConfig(bookKey);
  if (!config) return;
  const notes = config.booknotes ?? [];
  const target = notes.find((entry) => entry.id === note.id);
  if (!target) return;
  const remainingNote = notes.some(
    (entry) =>
      entry.id !== target.id &&
      entry.cfi === target.cfi &&
      entry.type === 'annotation' &&
      entry.note.trim() &&
      !entry.deletedAt,
  );
  const now = Date.now();
  const updated = notes.map((entry) =>
    entry.id === target.id ||
    (target.type === 'annotation' &&
      !remainingNote &&
      entry.type === 'annotation' &&
      entry.cfi === target.cfi &&
      entry.style &&
      !entry.note)
      ? { ...entry, deletedAt: now, updatedAt: now }
      : entry,
  );
  if (target.wordNoteId) await removeWordNote(envConfig, target.wordNoteId);
  const updatedConfig = updateBooknotes(bookKey, updated);
  if (updatedConfig)
    await saveConfig(envConfig, bookKey, updatedConfig, useSettingsStore.getState().settings);
  if (!remainingNote || target.type !== 'annotation') {
    for (const view of useReaderStore.getState().getViewsById(bookKey.split('-')[0]!)) {
      view?.addAnnotation(target, true);
      view?.addAnnotation({ ...target, value: NOTE_PREFIX + target.cfi }, true);
    }
  }
};
