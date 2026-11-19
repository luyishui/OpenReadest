import React, { useEffect, useRef, useState } from 'react';
import type { WordNote } from '@/types/book';
import type { Position } from '@/utils/sel';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { removeWordNote, saveWordNote } from '@/helpers/wordNotes';
import { deleteWordNote } from '@/helpers/deleteWordNote';
import Popup from '@/components/Popup';
import TextButton from '@/components/TextButton';

interface WordNotePopupProps {
  note: WordNote;
  position: Position;
  trianglePosition: Position;
  width: number;
  onDismiss: () => void;
}

const WordNotePopup = ({
  note,
  position,
  trianglePosition,
  width,
  onDismiss,
}: WordNotePopupProps) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
    else dialogRef.current?.focus();
  }, [editing]);

  const persist = async (action: 'save' | 'stop' | 'delete' = 'save') => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (action !== 'save') {
        if (action === 'delete') await deleteWordNote(envConfig, note.id);
        else await removeWordNote(envConfig, note.id);
        onDismiss();
      } else {
        await saveWordNote(envConfig, note.word, draft);
        setEditing(false);
      }
    } catch (error) {
      console.error('Failed to save word note:', error);
      setError(_('Failed to save note. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popup
      width={width}
      position={position}
      trianglePosition={trianglePosition}
      onDismiss={onDismiss}
      className='bg-base-100 text-base-content overflow-y-auto p-4'
    >
      <div ref={dialogRef} tabIndex={-1} role='dialog' aria-label={_('Word note for all books')}>
        <div className='mb-2 flex items-center justify-between gap-2'>
          <strong dir='auto' className='break-all'>
            {note.word}
          </strong>
          <TextButton onClick={onDismiss} disabled={saving}>
            {_('Close')}
          </TextButton>
        </div>
        <p className='mb-3 text-xs opacity-70'>{_('Applies to the same word in all books')}</p>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={_('Word note')}
            disabled={saving}
            className='textarea textarea-bordered w-full'
            rows={4}
          />
        ) : (
          <p dir='auto' className='whitespace-pre-wrap break-words'>
            {note.note}
          </p>
        )}
        {error && (
          <p role='alert' className='text-error mt-2 text-sm'>
            {error}
          </p>
        )}
        <div className='mt-3 flex flex-wrap justify-end gap-3'>
          {editing ? (
            <>
              <TextButton disabled={saving} onClick={() => setEditing(false)}>
                {_('Cancel')}
              </TextButton>
              <TextButton disabled={saving || !draft.trim()} onClick={() => void persist()}>
                {_('Save')}
              </TextButton>
            </>
          ) : (
            <>
              <TextButton
                disabled={saving}
                variant='danger'
                className='me-auto'
                onClick={() => void persist('delete')}
              >
                {_('Delete')}
              </TextButton>
              <TextButton disabled={saving} onClick={() => void persist('stop')}>
                {_('Stop applying to all books')}
              </TextButton>
              <TextButton
                disabled={saving}
                onClick={() => {
                  setDraft(note.note);
                  setEditing(true);
                }}
              >
                {_('Edit')}
              </TextButton>
            </>
          )}
        </div>
      </div>
    </Popup>
  );
};

export default WordNotePopup;
