import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import enTranslation from '../../../../public/locales/en/translation.json';
import type { BookDetail, BookRankingEntry, StatsTotals } from '@/types/statisticsQueries';
import type { DatabaseService } from '@/types/database';
import {
  createGatedStatsDataSource,
  type StatsDataSource,
  type StatsOverviewData,
} from '@/app/library/components/stats/statsDataSource';
import { ReadingStatsPill } from '@/app/library/components/stats/ReadingStatsPill';
import { StatsBookDetail } from '@/app/library/components/stats/StatsBookDetail';
import {
  BAR_FILLED_CLASS,
  HEAT_CLASSES,
} from '@/app/library/components/stats/StatsCharts';

const rtl = vi.hoisted(() => ({ dir: 'ltr' as 'ltr' | 'rtl' }));
vi.mock('@/utils/rtl', () => ({ getDirFromUILanguage: () => rtl.dir }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts: Record<string, string | number> = {}) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts[name] ?? '')),
}));
vi.mock('@/components/Dialog', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ isOpen, children }: { isOpen: boolean; children?: React.ReactNode }) =>
      isOpen ? createElement('div', { 'data-testid': 'mobile-sheet' }, children) : null,
  };
});

const TOTALS: StatsTotals = {
  todaySeconds: 34 * 60,
  weekSeconds: 5 * 3600 + 12 * 60,
  totalSeconds: 128 * 3600,
  weekStartDate: '2026-10-26',
};

const dateKey = (month: number, day: number) =>
  '2026-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');

const ENTRY: BookRankingEntry = {
  bookMd5: 'a',
  title: 'Project Hail Mary',
  authors: 'Andy Weir',
  totalSeconds: 13200,
  lastReadTime: 1_800_000_000,
  deletedFromLibrary: false,
};

const OVERVIEW: StatsOverviewData = {
  totals: TOTALS,
  streak: { currentDays: 12, longestDays: 31 },
  heatmap: Array.from({ length: 28 }, (_, i) => ({ date: dateKey(10, i + 1), seconds: i % 5 ? 0 : 600 })),
  hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? 3600 : 0)),
  ranking: [ENTRY],
};

const DETAIL: BookDetail = {
  bookMd5: 'a',
  title: 'Project Hail Mary',
  authors: 'Andy Weir',
  totalSeconds: 3 * 3600 + 40 * 60,
  daysRead: 9,
  sessionCount: 1,
  averageSessionSeconds: 24 * 60,
  firstReadTime: 1_799_000_000,
  lastReadTime: 1_800_000_000,
  progressPercent: 78,
  last30Days: Array.from({ length: 30 }, (_, i) => ({ date: dateKey(10, i + 1), seconds: i * 60 })),
  sessions: [
    {
      startTime: 1_800_000_000,
      endTime: 1_800_001_800,
      durationSeconds: 1800,
      startPage: 74,
      endPage: 78,
      progressDeltaPercent: 4,
    },
  ],
};

const fakeSource = (): StatsDataSource => ({
  getTotals: vi.fn(async () => TOTALS),
  getOverview: vi.fn(async () => OVERVIEW),
  getBookDetail: vi.fn(async () => DETAIL),
});

const LIBRARY = new Set(['a']);

beforeEach(() => {
  rtl.dir = 'ltr';
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('stats switch gating', () => {
  it('builds no data source and never opens the DB when the switch is off', () => {
    const openDb = vi.fn(async () => ({}) as DatabaseService);
    expect(createGatedStatsDataSource({}, false, openDb)).toBeNull();
    expect(createGatedStatsDataSource(null, true, openDb)).toBeNull();
    expect(openDb).not.toHaveBeenCalled();
  });

  it('opens the DB lazily through the data source when the switch is on', async () => {
    const openDb = vi.fn(async () => {
      throw new Error('no db in test');
    });
    const source = createGatedStatsDataSource({}, true, openDb);
    expect(source).not.toBeNull();
    expect(openDb).not.toHaveBeenCalled();
    await expect(source!.getTotals()).rejects.toThrow('no db in test');
    expect(openDb).toHaveBeenCalledTimes(1);
  });
});

describe('e-ink class mapping', () => {
  const einkTokens = (cls: string) => cls.split(/\s+/).filter((t) => t.startsWith('eink:'));

  it('gives levels 1-4 distinct visible e-ink fills', () => {
    const levels = HEAT_CLASSES.slice(1);
    expect(levels).toHaveLength(4);
    const signatures = levels.map((cls) => einkTokens(cls).sort().join(' '));
    expect(new Set(signatures).size).toBe(4);
    for (const cls of levels) {
      // An exact bg-primary token is repainted as an outline by globals.css on e-ink.
      expect(cls.split(/\s+/)).not.toContain('bg-primary');
      expect(einkTokens(cls).some((t) => t.startsWith('eink:bg-') && t !== 'eink:bg-transparent')).toBe(true);
      expect(cls).not.toContain('eink:border-dashed');
    }
    expect(levels[3]).toContain('eink:bg-base-content');
  });

  it('keeps filled bars solid on e-ink', () => {
    expect(BAR_FILLED_CLASS).toContain('eink:bg-base-content');
    expect(BAR_FILLED_CLASS.split(/\s+/)).not.toContain('bg-primary');
  });
});

describe('RTL', () => {
  it('mirrors the pill and panel anchor and isolates duration text in bdi', async () => {
    rtl.dir = 'rtl';
    render(<ReadingStatsPill dataSource={fakeSource()} libraryMd5s={LIBRARY} isEink={false} isMobile={false} />);
    const pill = screen.getByTestId('stats-pill');
    expect(pill.className).toContain('left-6');
    expect(pill.className).not.toContain('right-6');
    expect(screen.getByTestId('stats-pill-label').tagName).toBe('BDI');

    fireEvent.click(pill);
    const panel = await screen.findByTestId('stats-panel');
    expect(panel.className).toContain('left-6');
    expect(panel.className).toContain('origin-bottom-left');

    const tiles = await screen.findAllByTestId('stat-tile-value');
    expect(tiles.length).toBe(3);
    for (const t of tiles) expect(t.tagName).toBe('BDI');
    expect((await screen.findByTestId('stats-book-time')).tagName).toBe('BDI');

    fireEvent.click(screen.getByTestId('stats-book-row'));
    expect((await screen.findByTestId('stats-session-time')).tagName).toBe('BDI');
  });
});

describe('chart accessibility', () => {
  it('labels the heatmap and hour chart as images', async () => {
    render(<ReadingStatsPill dataSource={fakeSource()} libraryMd5s={LIBRARY} isEink={false} isMobile={false} />);
    fireEvent.click(screen.getByTestId('stats-pill'));
    const heatmap = await screen.findByTestId('stats-heatmap');
    expect(heatmap.getAttribute('role')).toBe('img');
    expect(heatmap.getAttribute('aria-label')).toContain('近 26 周');
    const hours = screen.getByTestId('stats-hours');
    expect(hours.getAttribute('role')).toBe('img');
    expect(hours.getAttribute('aria-label')).toContain('时段分布');
  });
});

describe('StatsBookDetail', () => {
  it('renders with an empty last30Days and no sessions', () => {
    render(<StatsBookDetail detail={{ ...DETAIL, last30Days: [], sessions: [] }} now={1_800_000_000} />);
    expect(screen.getByTestId('stats-book-detail')).toBeTruthy();
    expect(screen.getByTestId('stats-daily').children).toHaveLength(0);
    expect(screen.getByText('暂无阅读记录')).toBeTruthy();
    expect(screen.getByTestId('stats-cover').dataset['hasCover']).toBeUndefined();
  });
});

describe('mobile detail navigation', () => {
  it('pushes the book detail and returns to the overview on Back', async () => {
    render(<ReadingStatsPill dataSource={fakeSource()} libraryMd5s={LIBRARY} isEink={false} isMobile />);
    fireEvent.click(screen.getByTestId('stats-pill'));
    await screen.findByTestId('mobile-sheet');
    fireEvent.click(await screen.findByTestId('stats-book-row'));
    expect(await screen.findByTestId('stats-book-detail')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Back'));
    expect(screen.queryByTestId('stats-book-detail')).toBeNull();
    expect(await screen.findByTestId('stats-book-row')).toBeTruthy();
  });
});

describe('English day plurals', () => {
  it('has _one and _other forms for every day string', () => {
    const en = enTranslation as Record<string, string>;
    for (const key of ['{{days}} 天', '连续阅读 {{days}} 天', '最长 {{days}} 天']) {
      expect(en[key + '_one']).toBeTruthy();
      expect(en[key + '_other']).toBeTruthy();
    }
    expect(en['{{days}} 天_one']).toBe('{{days}} day');
  });
});
