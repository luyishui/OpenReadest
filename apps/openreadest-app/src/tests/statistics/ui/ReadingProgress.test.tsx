import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import type { Book } from '@/types/book';
import ReadingProgress from '@/app/library/components/ReadingProgress';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts: Record<string, string | number> = {}) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts[name] ?? '')),
}));

const book = (progress: [number, number] | undefined) =>
  ({ hash: 'h1', updatedAt: 1, progress }) as unknown as Book;

afterEach(() => {
  cleanup();
});

describe('library ReadingProgress remaining time', () => {
  it('shows percent and remaining time at the median page pace from the batched map', () => {
    const { container } = render(<ReadingProgress book={book([40, 100])} medianPageSecs={30} />);
    expect(container.textContent).toBe('40% · 还剩 30 分');
  });

  it('is not a live region (no role=status on every card)', () => {
    render(<ReadingProgress book={book([40, 100])} medianPageSecs={30} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hides the estimate when there is no median (stats off or too little data)', () => {
    const { container } = render(<ReadingProgress book={book([40, 100])} />);
    expect(container.textContent).toBe('40%');
  });

  it('hides the estimate for a finished book', () => {
    const { container } = render(<ReadingProgress book={book([100, 100])} medianPageSecs={30} />);
    expect(container.textContent).toBe('100%');
  });

  it('re-renders when the median prop changes (library batch refresh)', () => {
    const b = book([40, 100]);
    const { container, rerender } = render(<ReadingProgress book={b} medianPageSecs={30} />);
    rerender(<ReadingProgress book={b} medianPageSecs={60} />);
    expect(container.textContent).toBe('40% · 还剩 1 时');
  });

  it('renders nothing without progress', () => {
    const { container } = render(<ReadingProgress book={book(undefined)} medianPageSecs={30} />);
    expect(container.textContent).toBe('');
  });
});
