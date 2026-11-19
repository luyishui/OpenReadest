import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NoteEditor from '@/app/reader/components/notebook/NoteEditor';
import { useNotebookStore } from '@/store/notebookStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { TextSelection } from '@/utils/sel';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

vi.mock('@/i18n/i18n', () => ({ default: { changeLanguage: vi.fn() } }));

const selection = {
  key: 'book-a',
  text: 'Read',
  index: 0,
  range: document.createRange(),
} as TextSelection;

beforeEach(() => {
  useNotebookStore.setState({
    notebookNewAnnotation: selection,
    notebookEditAnnotation: null,
    notebookAnnotationDrafts: {},
  });
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, wordNotes: [] },
  });
});
afterEach(cleanup);

describe('word note scope in the editor', () => {
  it('defaults to local notes and passes the selected scope when saved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NoteEditor onSave={onSave} onEdit={vi.fn()} />);
    const scope = screen.getByRole('checkbox', {
      name: 'Apply to the same word in all books',
    }) as HTMLInputElement;
    expect(scope.checked).toBe(false);
    fireEvent.change(screen.getByPlaceholderText('Add your notes here...'), {
      target: { value: '/riːd/' },
    });
    fireEvent.click(scope);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(selection, '/riːd/', true));
  });

  it('uses the current global scope when saving with the keyboard shortcut', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NoteEditor onSave={onSave} onEdit={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/riːd/' } });
    fireEvent.click(screen.getByRole('checkbox'));
    screen.getByRole('textbox').blur();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(selection, '/riːd/', true));
  });

  it('does not offer global scope for a phrase', () => {
    useNotebookStore.setState({ notebookNewAnnotation: { ...selection, text: 'read books' } });
    render(<NoteEditor onSave={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('loads the current shared content when editing a linked note without mutating it', async () => {
    const local = {
      id: 'local',
      type: 'annotation' as const,
      cfi: 'cfi',
      text: 'Read',
      note: 'old',
      wordNoteId: 'shared',
      createdAt: 1,
      updatedAt: 1,
    };
    useNotebookStore.setState({ notebookNewAnnotation: null, notebookEditAnnotation: local });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        wordNotes: [
          { id: 'shared', word: 'read', note: 'current pronunciation', createdAt: 1, updatedAt: 2 },
        ],
      },
    });
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<NoteEditor onSave={vi.fn()} onEdit={onEdit} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'current pronunciation',
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ note: 'updated' }), true),
    );
    expect(local.note).toBe('old');
  });

  it('keeps the draft and shows an error when saving fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <NoteEditor onSave={vi.fn().mockRejectedValue(new Error('Disk full'))} onEdit={vi.fn()} />,
      );
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my pronunciation' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
      });
      expect(screen.getByRole('alert').textContent).toContain('Failed to save note');
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my pronunciation');
      expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    } finally {
      spy.mockRestore();
    }
  });
});
