import type { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { removeWordNote } from './wordNotes';
import { getWordNoteById } from '@/utils/wordNotes';

export const deleteWordNote = async (envConfig: EnvConfigType, id: string) => {
  const appService = await envConfig.getAppService();
  const settings = useSettingsStore.getState().settings;
  const target = getWordNoteById(settings.wordNotes ?? [], id);
  const linkedIds = new Set([id, ...(target ? [target.id, ...(target.aliases ?? [])] : [])]);
  for (const book of useLibraryStore.getState().library) {
    if (book.deletedAt) continue;
    const openConfig = useBookDataStore.getState().getConfig(book.hash);
    const config = openConfig ?? (await appService.loadBookConfig(book, settings));
    const notes = config.booknotes ?? [];
    const sources = notes.filter((note) => linkedIds.has(note.wordNoteId ?? '') && !note.deletedAt);
    if (!sources.length) continue;
    const ids = new Set(sources.map((note) => note.id));
    const locations = new Set(sources.map((note) => note.cfi));
    const remainingNote = (cfi: string) =>
      notes.some(
        (note) =>
          !ids.has(note.id) &&
          !note.deletedAt &&
          note.type === 'annotation' &&
          note.cfi === cfi &&
          note.note.trim(),
      );
    const now = Date.now();
    const updated = notes.map((note) =>
      ids.has(note.id) ||
      (locations.has(note.cfi) &&
        note.type === 'annotation' &&
        note.style &&
        !note.note &&
        !remainingNote(note.cfi))
        ? { ...note, deletedAt: now, updatedAt: now }
        : note,
    );
    await appService.saveBookConfig(
      book,
      { ...config, booknotes: updated, updatedAt: now },
      settings,
    );
    if (openConfig) useBookDataStore.getState().updateBooknotes(book.hash, updated);
    for (const source of sources) {
      const remaining = updated.filter(
        (note) => note.cfi === source.cfi && note.type === 'annotation' && !note.deletedAt,
      );
      for (const view of useReaderStore.getState().getViewsById(book.hash)) {
        if (!remaining.some((note) => note.style)) view?.addAnnotation(source, true);
        if (!remaining.some((note) => note.note.trim())) {
          view?.addAnnotation({ ...source, value: `foliate-note:${source.cfi}` }, true);
        }
      }
    }
  }
  await removeWordNote(envConfig, id);
};
