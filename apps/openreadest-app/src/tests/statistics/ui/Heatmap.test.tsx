import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import type { DailySeconds } from '@/types/statisticsQueries';
import { Heatmap } from '@/app/library/components/stats/StatsCharts';
import { HEATMAP_WEEKS } from '@/services/statistics/statisticsQueries';
import { localeWeekStart, type IsoWeekday } from '@/services/statistics/localTime';

const DAY_MS = 86_400_000;
const DAYS = HEATMAP_WEEKS * 7;
const TODAY_SECONDS = 1234;

// ISO weekday (1 = Monday ... 7 = Sunday) of a 'YYYY-MM-DD' key.
const isoWeekday = (date: string) => ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;

// Same shape getDailyHeatmap returns: HEATMAP_WEEKS full weeks from weekStart, future days flagged.
function queryShapedDays(today: string, weekStart: IsoWeekday): DailySeconds[] {
  const t = Date.parse(today + 'T00:00:00Z');
  const intoWeek = (isoWeekday(today) - weekStart + 7) % 7;
  const weekEnd = t + (6 - intoWeek) * DAY_MS;
  const out: DailySeconds[] = [];
  for (let i = 0; i < DAYS; i++) {
    const ms = weekEnd - (DAYS - 1 - i) * DAY_MS;
    const date = new Date(ms).toISOString().slice(0, 10);
    if (ms > t) out.push({ date, seconds: 0, future: true });
    else out.push({ date, seconds: ms === t ? TODAY_SECONDS : i % 3 ? 0 : 600 });
  }
  return out;
}

const describeDay = (d: DailySeconds) => d.date + ' ' + d.seconds;

const LOCALES = [
  { locale: 'zh-CN', weekStart: 1 },
  { locale: 'en-US', weekStart: 7 },
] as const;

const TODAYS = [
  { today: '2026-10-26', name: 'Monday' },
  { today: '2026-10-28', name: 'Wednesday' },
  { today: '2026-11-01', name: 'Sunday' },
];

function renderGrid(today: string, locale: string) {
  const days = queryShapedDays(today, localeWeekStart(locale));
  render(<Heatmap days={days} describe={describeDay} locale={locale} />);
  const grid = screen.getByTestId('stats-heatmap');
  const columns = Array.from(grid.children);
  return { days, grid, columns, cells: columns.flatMap((c) => Array.from(c.children)) };
}

describe('Heatmap grid', () => {
  afterEach(cleanup);

  it.each(LOCALES)('$locale weeks start on ISO weekday $weekStart', ({ locale, weekStart }) => {
    expect(localeWeekStart(locale)).toBe(weekStart);
  });

  describe.each(LOCALES)('$locale', ({ locale, weekStart }) => {
    it.each(TODAYS)('lays out 26 x 7 weekday rows when today is a $name', ({ today }) => {
      const { days, columns, cells } = renderGrid(today, locale);
      expect(columns).toHaveLength(HEATMAP_WEEKS);
      for (const col of columns) expect(col.children).toHaveLength(7);
      expect(cells).toHaveLength(182);
      // Row index is the weekday in locale order.
      days.forEach((d, i) => expect((isoWeekday(d.date) - weekStart + 7) % 7).toBe(i % 7));
      // First cell is the week start 25 weeks before the current week.
      expect(isoWeekday(days[0]!.date)).toBe(weekStart);
      expect(cells[0]!.getAttribute('title')).toBe(describeDay(days[0]!));
      expect(Date.parse(today) - Date.parse(days[0]!.date)).toBe(
        (25 * 7 + ((isoWeekday(today) - weekStart + 7) % 7)) * DAY_MS,
      );
    });

    it.each(TODAYS)("puts today at its weekday row in the last column when today is a $name", ({ today }) => {
      const { columns } = renderGrid(today, locale);
      const last = columns[columns.length - 1]!;
      const row = (isoWeekday(today) - weekStart + 7) % 7;
      const cell = last.children[row]!;
      expect(cell.getAttribute('title')).toBe(today + ' ' + TODAY_SECONDS);
      expect(cell.hasAttribute('data-today')).toBe(true);
      expect(cell.className).toMatch(/bg-primary/);
      expect(cell.className).toMatch(/outline/);
    });

    it.each(TODAYS)('renders the rest of the week as hollow placeholders when today is a $name', ({ today }) => {
      const { grid, columns } = renderGrid(today, locale);
      const remaining = 6 - ((isoWeekday(today) - weekStart + 7) % 7);
      const future = Array.from(grid.querySelectorAll('[data-future]'));
      expect(future).toHaveLength(remaining);
      const last = Array.from(columns[columns.length - 1]!.children);
      expect(last.slice(7 - remaining)).toEqual(future);
      for (const cell of future) {
        expect(cell.getAttribute('aria-hidden')).toBe('true');
        expect(cell.hasAttribute('title')).toBe(false);
        expect(cell.className).toMatch(/border-dashed/);
        expect(cell.className).not.toMatch(/bg-base-300/);
      }
    });
  });

  it('keeps zero-read past days solid and borderless', () => {
    const { cells, days } = renderGrid('2026-10-28', 'zh-CN');
    const zero = cells[days.findIndex((d) => !d.future && d.seconds === 0)]!;
    expect(zero.className).toMatch(/bg-base-300/);
    expect(zero.className).not.toMatch(/border-dashed/);
  });

  it('labels alternate weekday rows in locale order', () => {
    renderGrid('2026-10-28', 'zh-CN');
    expect(screen.getAllByTestId('stats-heatmap-weekday').map((e) => e.textContent)).toEqual([
      '一',
      '',
      '三',
      '',
      '五',
      '',
      '日',
    ]);
  });

  it('labels the first column of each month', () => {
    const { days } = renderGrid('2026-10-28', 'en-US');
    const labels = screen.getAllByTestId('stats-heatmap-month').map((e) => e.textContent);
    expect(labels).toHaveLength(HEATMAP_WEEKS);
    const octWeek = Math.floor(days.findIndex((d) => d.date === '2026-10-01') / 7);
    expect(labels[octWeek]).toBe('Oct');
    expect(labels.filter(Boolean)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
  });

  it('shows a less-to-more legend with a future swatch', () => {
    const days = queryShapedDays('2026-10-28', 1);
    render(
      <Heatmap days={days} describe={describeDay} locale='zh-CN' legend={{ less: '少', more: '多', future: '未来' }} />,
    );
    const legend = screen.getByTestId('stats-heatmap-legend');
    expect(legend.textContent).toBe('少多未来');
    expect(legend.querySelectorAll('.border-dashed')).toHaveLength(1);
  });
});
