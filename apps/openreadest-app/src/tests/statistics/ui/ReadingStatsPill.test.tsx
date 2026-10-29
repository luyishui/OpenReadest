import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import type { BookDetail, BookRankingEntry, StatsTotals } from '@/types/statisticsQueries';
import type { StatsDataSource, StatsOverviewData } from '@/app/library/components/stats/statsDataSource';
import { ReadingStatsPill } from '@/app/library/components/stats/ReadingStatsPill';

// Keys are the Chinese source strings; interpolate like i18next's defaultValue path.
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts: Record<string, string | number> = {}) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts[name] ?? '')),
}));
// Light stand-in for the mobile sheet: renders children and wires onClose, keeping
// Dialog's Tauri/store imports out of jsdom. vi.mock factories are hoisted above
// static imports, so React is imported inside the factory.
vi.mock('@/components/Dialog', async () => {
  const { createElement } = await import('react');
  return {
    default: ({
      isOpen,
      onClose,
      snapHeight,
      children,
    }: {
      isOpen: boolean;
      onClose: () => void;
      snapHeight?: number;
      children?: React.ReactNode;
    }) =>
      isOpen
        ? createElement(
            'div',
            { 'data-testid': 'mobile-sheet', 'data-snap-height': snapHeight },
            createElement('button', {
              type: 'button',
              'data-testid': 'sheet-dismiss',
              onClick: onClose,
            }),
            children,
          )
        : null,
  };
});

const TOTALS: StatsTotals = {
  todaySeconds: 34 * 60,
  weekSeconds: 5 * 3600 + 12 * 60,
  totalSeconds: 128 * 3600,
  weekStartDate: '2026-10-26',
};

const entry = (md5: string, title: string, seconds: number, deleted = false): BookRankingEntry => ({
  bookMd5: md5,
  title,
  authors: 'Author ' + md5,
  totalSeconds: seconds,
  lastReadTime: 1_800_000_000,
  deletedFromLibrary: deleted,
});

const overview = (ranking: BookRankingEntry[], totals = TOTALS): StatsOverviewData => ({
  totals,
  streak: { currentDays: 12, longestDays: 31 },
  heatmap: Array.from({ length: 182 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 4, 4 + i)).toISOString().slice(0, 10),
    seconds: i % 5 ? 0 : 600,
  })),
  hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? 3600 : 0)),
  ranking,
});

const DETAIL: BookDetail = {
  bookMd5: 'a',
  title: 'Project Hail Mary',
  authors: 'Andy Weir',
  totalSeconds: 3 * 3600 + 40 * 60,
  daysRead: 9,
  sessionCount: 2,
  averageSessionSeconds: 24 * 60,
  firstReadTime: 1_799_000_000,
  lastReadTime: 1_800_000_000,
  progressPercent: 78,
  last30Days: Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${i}`, seconds: i * 60 })),
  sessions: [
    {
      startTime: 1_800_000_000,
      endTime: 1_800_001_800,
      durationSeconds: 1800,
      startPage: 74,
      endPage: 78,
      progressDeltaPercent: 4,
    },
    {
      startTime: 1_799_900_000,
      endTime: 1_799_901_080,
      durationSeconds: 1080,
      startPage: 72,
      endPage: 74,
      progressDeltaPercent: 2,
    },
  ],
};

const fakeSource = (data: StatsOverviewData, detail: BookDetail | null = DETAIL): StatsDataSource => ({
  getTotals: vi.fn(async () => data.totals),
  getOverview: vi.fn(async () => data),
  getBookDetail: vi.fn(async () => detail),
});

const LIBRARY = new Set(['a', 'b']);

let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduced-motion') ? reducedMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPill = (source: StatsDataSource, isEink = false) =>
  render(
    <ReadingStatsPill dataSource={source} libraryMd5s={LIBRARY} isEink={isEink} isMobile={false} />,
  );

const renderMobilePill = (source: StatsDataSource) =>
  render(<ReadingStatsPill dataSource={source} libraryMd5s={LIBRARY} isEink={false} isMobile />);

const openPanel = async () => {
  fireEvent.click(screen.getByTestId('stats-pill'));
  return screen.findByTestId('stats-panel');
};

describe('ReadingStatsPill', () => {
  it("shows today's reading time from getTotals", async () => {
    renderPill(fakeSource(overview([])));
    expect(await screen.findByText('今日 34 分')).toBeTruthy();
  });

  it('opens with the morph animation and closes on outside click after it shrinks back', async () => {
    renderPill(fakeSource(overview([entry('a', 'Project Hail Mary', 13200)])));
    const panel = await openPanel();
    expect(panel.dataset['animated']).toBe('true');
    expect(panel.className).toContain('origin-bottom-right');
    await waitFor(() => expect(panel.className).toContain('scale-100'));
    expect(await screen.findByText('阅读统计')).toBeTruthy();

    fireEvent.pointerDown(panel);
    expect(screen.getByTestId('stats-panel')).toBeTruthy();

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByTestId('stats-panel')).toBeNull());
  });

  it('closes on Escape', async () => {
    reducedMotion = true;
    renderPill(fakeSource(overview([])));
    await openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('stats-panel')).toBeNull();
  });

  it('closes from the header close button', async () => {
    reducedMotion = true;
    renderPill(fakeSource(overview([])));
    await openPanel();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('stats-panel')).toBeNull();
  });

  it('renders the empty state with zero tiles and no ranking rows', async () => {
    const empty = overview([], { ...TOTALS, todaySeconds: 0, weekSeconds: 0, totalSeconds: 0 });
    renderPill(fakeSource({ ...empty, streak: { currentDays: 0, longestDays: 0 } }));
    await openPanel();
    expect(await screen.findByText('暂无阅读记录')).toBeTruthy();
    expect(screen.getAllByText('0 分').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('连续阅读 0 天')).toBeTruthy();
    expect(screen.queryAllByTestId('stats-book-row')).toHaveLength(0);
  });

  it('greys out books no longer in the library', async () => {
    renderPill(
      fakeSource(
        overview([entry('a', 'Project Hail Mary', 13200), entry('gone', 'Removed Book', 600, true)]),
      ),
    );
    await openPanel();
    const rows = await screen.findAllByTestId('stats-book-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.className).not.toContain('opacity-50');
    expect(rows[1]!.dataset['deleted']).toBe('true');
    expect(rows[1]!.className).toContain('opacity-50');
    expect(screen.getByText('已不在书库')).toBeTruthy();
  });

  it('pushes the book detail in and restores the overview scroll position on back', async () => {
    reducedMotion = true;
    const source = fakeSource(overview([entry('a', 'Project Hail Mary', 13200)]));
    renderPill(source);
    await openPanel();
    const row = await screen.findByTestId('stats-book-row');
    const scroller = screen.getByTestId('stats-scroll');
    // jsdom has no layout; give the scroller a real, writable scrollTop.
    Object.defineProperty(scroller, 'scrollTop', { value: 240, writable: true, configurable: true });

    fireEvent.click(row);
    expect(await screen.findByTestId('stats-book-detail')).toBeTruthy();
    expect(source.getBookDetail).toHaveBeenCalledWith('a');
    expect(screen.getByText('Project Hail Mary')).toBeTruthy();
    expect(screen.getByText('已读 78%')).toBeTruthy();
    expect(screen.getByText('9 天')).toBeTruthy();
    expect(screen.getAllByTestId('stats-session-row')).toHaveLength(2);
    expect(screen.getByText('+4%')).toBeTruthy();
    expect(screen.getByTestId('stats-daily').children).toHaveLength(30);
    expect(scroller.scrollTop).toBe(0);

    fireEvent.click(screen.getByLabelText('Back'));
    expect(await screen.findByTestId('stats-book-row')).toBeTruthy();
    expect(screen.queryByTestId('stats-book-detail')).toBeNull();
    expect(screen.getByTestId('stats-scroll')).toBe(scroller);
    expect(scroller.scrollTop).toBe(240);
    // Overview data is kept, not refetched, when returning.
    expect(source.getOverview).toHaveBeenCalledTimes(1);
  });

  it('skips the animation under prefers-reduced-motion', async () => {
    reducedMotion = true;
    renderPill(fakeSource(overview([])));
    const panel = await openPanel();
    expect(panel.dataset['animated']).toBeUndefined();
    expect(panel.className).not.toContain('transition-');
    expect(panel.className).not.toMatch(/\b(scale-|opacity-)/);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('stats-panel')).toBeNull();
  });

  it('skips the animation in e-ink mode', async () => {
    renderPill(fakeSource(overview([])), true);
    const panel = await openPanel();
    expect(panel.dataset['animated']).toBeUndefined();
    expect(panel.className).not.toContain('transition-');
    expect(panel.className).not.toMatch(/\b(scale-|opacity-)/);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByTestId('stats-panel')).toBeNull();
  });

  it('moves focus into the panel on open and back to the pill on close', async () => {
    reducedMotion = true;
    renderPill(fakeSource(overview([])));
    const pill = screen.getByTestId('stats-pill');
    const panel = await openPanel();
    expect(document.activeElement).toBe(panel);
    expect(pill.tabIndex).toBe(-1);
    expect(pill.getAttribute('aria-hidden')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('stats-panel')).toBeNull();
    expect(document.activeElement).toBe(pill);
    expect(pill.tabIndex).toBe(0);
    expect(pill.getAttribute('aria-hidden')).toBeNull();
  });

  it('shows the load-failure message when the book detail rejects', async () => {
    reducedMotion = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source: StatsDataSource = {
      ...fakeSource(overview([entry('a', 'Project Hail Mary', 13200)])),
      getBookDetail: vi.fn(async (): Promise<BookDetail | null> => {
        throw new Error('boom');
      }),
    };
    renderPill(source);
    await openPanel();
    fireEvent.click(await screen.findByTestId('stats-book-row'));
    expect(await screen.findByText('统计数据加载失败')).toBeTruthy();
    expect(screen.queryByText('暂无阅读记录')).toBeNull();
    errorSpy.mockRestore();
  });

  it("refreshes today's time on window focus and on becoming visible", async () => {
    const source = fakeSource(overview([]));
    const { unmount } = renderPill(source);
    expect(await screen.findByText('今日 34 分')).toBeTruthy();
    expect(source.getTotals).toHaveBeenCalledTimes(1);
    vi.mocked(source.getTotals).mockResolvedValue({ ...TOTALS, todaySeconds: 50 * 60 });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByText('今日 50 分')).toBeTruthy();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(source.getTotals).toHaveBeenCalledTimes(3);
    unmount();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(source.getTotals).toHaveBeenCalledTimes(3);
    visibility.mockRestore();
  });

  it('does not flicker open when closed during the entering frames', async () => {
    renderPill(fakeSource(overview([])));
    fireEvent.click(screen.getByTestId('stats-pill'));
    expect(screen.getByTestId('stats-panel').className).toContain('scale-[0.08]');
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const panel = screen.queryByTestId('stats-panel');
    expect(panel?.className ?? '').not.toContain('scale-100');
    await waitFor(() => expect(screen.queryByTestId('stats-panel')).toBeNull());
  });

  it('returns focus to the pill after the close button', async () => {
    reducedMotion = true;
    renderPill(fakeSource(overview([])));
    const pill = screen.getByTestId('stats-pill');
    await openPanel();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('stats-panel')).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it('does not focus the pill after an outside pointerdown', async () => {
    reducedMotion = true;
    renderPill(fakeSource(overview([])));
    const pill = screen.getByTestId('stats-pill');
    await openPanel();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('stats-panel')).toBeNull();
    expect(document.activeElement).not.toBe(pill);
  });

  it('does not steal focus from another element outside the panel on Escape', async () => {
    reducedMotion = true;
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    renderPill(fakeSource(overview([])));
    await openPanel();
    outside.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('stats-panel')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('renders the e-ink panel without scale, opacity or transition classes', async () => {
    renderPill(fakeSource(overview([])), true);
    const panel = await openPanel();
    expect(panel.dataset['animated']).toBeUndefined();
    expect(panel.className).not.toMatch(/(^|\s)(scale-|opacity-|transition-)/);
    expect(panel.className).toContain('eink:shadow-none');
  });

  it('shows the load-failure message when the overview rejects', async () => {
    reducedMotion = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source: StatsDataSource = {
      ...fakeSource(overview([])),
      getOverview: vi.fn(async (): Promise<StatsOverviewData> => {
        throw new Error('boom');
      }),
    };
    renderPill(source);
    await openPanel();
    expect(await screen.findByText('统计数据加载失败')).toBeTruthy();
    expect(screen.queryByText('Loading...')).toBeNull();
    errorSpy.mockRestore();
  });

  describe('on mobile', () => {
    it('opens the bottom sheet at the design snap height instead of the floating panel', async () => {
      renderMobilePill(fakeSource(overview([entry('a', 'Project Hail Mary', 13200)])));
      const pill = screen.getByTestId('stats-pill');
      fireEvent.click(pill);
      const sheet = await screen.findByTestId('mobile-sheet');
      expect(sheet.dataset['snapHeight']).toBe('0.92');
      expect(screen.queryByTestId('stats-panel')).toBeNull();
      expect(await screen.findByTestId('stats-book-row')).toBeTruthy();
      expect(pill.getAttribute('aria-expanded')).toBe('true');
      expect(pill.getAttribute('aria-hidden')).toBeNull();
    });

    it('closes when the sheet dismisses itself', async () => {
      renderMobilePill(fakeSource(overview([])));
      fireEvent.click(screen.getByTestId('stats-pill'));
      await screen.findByTestId('mobile-sheet');
      fireEvent.click(screen.getByTestId('sheet-dismiss'));
      expect(screen.queryByTestId('mobile-sheet')).toBeNull();
      expect(screen.getByTestId('stats-pill').getAttribute('aria-expanded')).toBe('false');
    });

    it('closes from the header close button', async () => {
      renderMobilePill(fakeSource(overview([])));
      fireEvent.click(screen.getByTestId('stats-pill'));
      await screen.findByTestId('mobile-sheet');
      fireEvent.click(screen.getByLabelText('Close'));
      expect(screen.queryByTestId('mobile-sheet')).toBeNull();
    });
  });
});
