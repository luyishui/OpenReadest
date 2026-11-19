import React, { useEffect, useRef, useState } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { TextSelection } from '@/utils/sel';
import { md5Fingerprint } from '@/utils/md5';
import { BookNote } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { getWordNoteById, normalizeWord, resolveWordNote } from '@/utils/wordNotes';
import useShortcuts from '@/hooks/useShortcuts';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';
import TextButton from '@/components/TextButton';

interface NoteEditorProps {
  onSave: (selection: TextSelection, note: string, allBooks: boolean) => Promise<void>;
  onEdit: (annotation: BookNote, allBooks: boolean) => Promise<void>;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ onSave, onEdit }) => {
  const _ = useTranslation();
  const {
    notebookNewAnnotation,
    notebookEditAnnotation,
    setNotebookNewAnnotation,
    setNotebookEditAnnotation,
    saveNotebookAnnotationDraft,
    getNotebookAnnotationDraft,
  } = useNotebookStore();

  const editorRef = useRef<TextEditorRef>(null);
  const [note, setNote] = useState('');
  const [allBooks, setAllBooks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const separatorWidth = useResponsiveSize(3);

  useEffect(() => {
    setError('');
    const wordNotes = useSettingsStore.getState().settings.wordNotes ?? [];
    setAllBooks(Boolean(getWordNoteById(wordNotes, notebookEditAnnotation?.wordNoteId)));
    if (notebookEditAnnotation) {
      const noteText = resolveWordNote(notebookEditAnnotation, wordNotes).note;
      setNote(noteText);
      editorRef.current?.setValue(noteText);
      editorRef.current?.focus();
    } else if (notebookNewAnnotation) {
      const noteText = getAnnotationText();
      if (noteText) {
        const draftNote = getNotebookAnnotationDraft(md5Fingerprint(noteText)) || '';
        setNote(draftNote);
        editorRef.current?.setValue(draftNote);
        editorRef.current?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookNewAnnotation, notebookEditAnnotation]);

  const getAnnotationText = () => {
    return notebookEditAnnotation?.text || notebookNewAnnotation?.text || '';
  };

  const handleNoteChange = (value: string) => {
    setNote(value);
  };

  const handleBlur = () => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      const noteText = getAnnotationText();
      if (noteText) {
        saveNotebookAnnotationDraft(md5Fingerprint(noteText), currentValue);
      }
    }
  };

  const handleSaveNote = async () => {
    const currentValue = editorRef.current?.getValue();
    if (!currentValue?.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      if (notebookNewAnnotation) {
        await onSave(notebookNewAnnotation, currentValue, allBooks);
      } else if (notebookEditAnnotation) {
        await onEdit({ ...notebookEditAnnotation, note: currentValue }, allBooks);
      }
    } catch (error) {
      console.error('Failed to save note:', error);
      setError(_('Failed to save note. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleEscape = () => {
    if (notebookNewAnnotation) {
      setNotebookNewAnnotation(null);
    }
    if (notebookEditAnnotation) {
      setNotebookEditAnnotation(null);
    }
  };

  useShortcuts(
    {
      onSaveNote: () => {
        const currentValue = editorRef.current?.getValue();
        if (currentValue) {
          handleSaveNote();
        }
      },
      onEscape: handleEscape,
    },
    [notebookNewAnnotation, notebookEditAnnotation, allBooks, saving],
  );

  const canSave = Boolean(note.trim()) && !saving;
  const isSingleWord = Boolean(normalizeWord(getAnnotationText()));

  return (
    <div className='content booknote-item note-editor-container bg-base-100 mt-2 rounded-md p-2'>
      <div className='flex w-full'>
        <TextEditor
          ref={editorRef}
          value={note}
          onChange={handleNoteChange}
          onBlur={handleBlur}
          onSave={handleSaveNote}
          onEscape={handleEscape}
          placeholder={_('Add your notes here...')}
          spellCheck={false}
        />
      </div>

      <div className='flex items-center pt-2'>
        <div
          className='me-2 mt-0.5 min-h-full self-stretch rounded-xl bg-gray-300'
          style={{
            minWidth: `${separatorWidth}px`,
          }}
        ></div>
        <div className='content font-size-sm line-clamp-3'>
          <span className='content font-size-xs text-gray-500'>{getAnnotationText()}</span>
        </div>
      </div>

      {isSingleWord && (
        <label className='mt-3 flex cursor-pointer items-start gap-2 text-sm'>
          <input
            type='checkbox'
            className='checkbox checkbox-sm mt-0.5'
            checked={allBooks}
            onChange={(event) => setAllBooks(event.target.checked)}
            disabled={saving}
          />
          <span>{_('Apply to the same word in all books')}</span>
        </label>
      )}
      {allBooks && (
        <p className='mt-2 text-xs opacity-70'>{_('Changes update this word note in all books')}</p>
      )}
      {error && (
        <p role='alert' className='text-error mt-2 text-sm'>
          {error}
        </p>
      )}
      <div className='flex justify-end space-x-3 p-2' dir='ltr'>
        <TextButton onClick={handleEscape} disabled={saving}>
          {_('Cancel')}
        </TextButton>
        <TextButton onClick={handleSaveNote} disabled={!canSave}>
          {_('Save')}
        </TextButton>
      </div>
    </div>
  );
};

export default NoteEditor;
