import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { WordNote } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { useWordNotes } from '@/app/reader/hooks/useWordNotes';

vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { underline: () => {} } }));
afterEach(cleanup);

const note: WordNote = { id: 'one', word: 'read', note: '/riːd/', createdAt: 1, updatedAt: 1 };

const book = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const marks = new Map<string, Range>();
  return {
    doc,
    index: 0,
    overlayer: {
      add: (key: string, range: Range) => marks.set(key, range),
      remove: (key: string) => marks.delete(key),
    },
    marks,
  };
};

const reader = (initial: ReturnType<typeof book>[]) => {
  let contents = initial;
  const events = new EventTarget();
  return {
    view: Object.assign(events, {
      renderer: { getContents: () => contents },
    }) as unknown as FoliateView,
    replaceContents: (next: typeof contents) => {
      contents = next;
    },
  };
};

describe('automatic word note overlays', () => {
  it('updates matches after translated content changes and stops observing on unmount', async () => {
    const a = book('<p>read</p>');
    const { view } = reader([a]);
    const { unmount } = renderHook(() => useWordNotes(view, [note], vi.fn()));
    await act(async () => {
      a.doc.body.insertAdjacentHTML('beforeend', '<p>Read read</p>');
    });
    expect(a.marks.size).toBe(3);
    await act(async () => {
      a.doc.body.lastElementChild!.textContent = 'reader';
    });
    expect(a.marks.size).toBe(1);
    unmount();
    await act(async () => {
      a.doc.body.textContent = 'read';
    });
    expect(a.marks.size).toBe(0);
  });
  it('marks every match in all loaded chapters and removes marks when disabled', () => {
    const a = book('<p>Read reader read</p>');
    const b = book('<p>We <em>re</em>ad.</p>');
    const { view } = reader([a, b]);
    const { rerender } = renderHook(({ notes }) => useWordNotes(view, notes, vi.fn()), {
      initialProps: { notes: [note] },
    });
    expect([...a.marks.values()].map((range) => range.toString())).toEqual(['Read', 'read']);
    expect([...b.marks.values()].map((range) => range.toString())).toEqual(['read']);
    rerender({ notes: [] });
    expect(a.marks.size + b.marks.size).toBe(0);
  });

  it('handles a new chapter after create-overlay and releases unloaded chapters', async () => {
    const a = book('<p>read</p>');
    const b = book('<p>Read read</p>');
    const { view, replaceContents } = reader([a]);
    renderHook(() => useWordNotes(view, [note], vi.fn()));
    replaceContents([b]);
    await act(async () => {
      view.dispatchEvent(new CustomEvent('create-overlay'));
    });
    expect(a.marks.size).toBe(0);
    expect(b.marks.size).toBe(2);
    await act(async () => {
      view.dispatchEvent(new CustomEvent('relocate'));
    });
    expect(b.marks.size).toBe(2);
  });

  it('shows the word note when an existing book highlight overlaps the same word', () => {
    const a = book('<p>read</p>');
    const { view } = reader([a]);
    const show = vi.fn();
    renderHook(() => useWordNotes(view, [note], show));
    const range = [...a.marks.values()][0]!;
    act(() => {
      view.dispatchEvent(
        new CustomEvent('show-annotation', {
          detail: { value: 'epubcfi(/6/2)', range, index: 0 },
        }),
      );
    });
    expect(show).toHaveBeenCalledWith(note, range, 0);
  });

  it('opens the clicked match with the latest note after editing', () => {
    const a = book('<p>read</p>');
    const { view } = reader([a]);
    const show = vi.fn();
    const { rerender, unmount } = renderHook(({ notes }) => useWordNotes(view, notes, show), {
      initialProps: { notes: [note] },
    });
    rerender({ notes: [{ ...note, note: 'updated pronunciation' }] });
    const [value, range] = [...a.marks.entries()][0]!;
    act(() => {
      view.dispatchEvent(
        new CustomEvent('show-annotation', { detail: { value, range, index: 3 } }),
      );
    });
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'updated pronunciation' }),
      range,
      3,
    );
    unmount();
    expect(a.marks.size).toBe(0);
    view.dispatchEvent(new CustomEvent('show-annotation', { detail: { value, range, index: 3 } }));
    expect(show).toHaveBeenCalledTimes(1);
  });
});
