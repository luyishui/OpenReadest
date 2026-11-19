import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WordNotePopup from '@/app/reader/components/annotator/WordNotePopup';
import { deleteWordNote } from '@/helpers/deleteWordNote';
import { removeWordNote } from '@/helpers/wordNotes';
import type { Position } from '@/utils/sel';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/helpers/deleteWordNote', () => ({
  deleteWordNote: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/helpers/wordNotes', () => ({
  removeWordNote: vi.fn().mockResolvedValue(undefined),
  saveWordNote: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const position: Position = { dir: 'down', point: { x: 100, y: 100 } };
const show = () => {
  const dismiss = vi.fn();
  render(
    <WordNotePopup
      note={{ id: 'shared', word: 'は', note: 'ha', createdAt: 1, updatedAt: 1 }}
      width={360}
      position={position}
      trianglePosition={position}
      onDismiss={dismiss}
    />,
  );
  return dismiss;
};
describe('word note popup actions', () => {
  it('deletes the note and its source annotations with a separate Delete button', async () => {
    const dismiss = show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalled());
    expect(deleteWordNote).toHaveBeenCalledWith({}, 'shared');
    expect(removeWordNote).not.toHaveBeenCalled();
  });
  it('keeps Stop applying to all books separate from deleting the source notes', async () => {
    const dismiss = show();
    fireEvent.click(screen.getByRole('button', { name: 'Stop applying to all books' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalled());
    expect(removeWordNote).toHaveBeenCalledWith({}, 'shared');
    expect(deleteWordNote).not.toHaveBeenCalled();
  });
  it('keeps the popup open and reports a failed deletion', async () => {
    vi.mocked(deleteWordNote).mockRejectedValueOnce(new Error('Disk full'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dismiss = show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Failed to save note. Please try again.',
    );
    expect(dismiss).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
