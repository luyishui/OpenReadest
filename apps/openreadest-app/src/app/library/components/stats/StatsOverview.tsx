import clsx from 'clsx';
import React from 'react';
import { MdChevronLeft, MdChevronRight, MdLocalFireDepartment } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { getDirFromUILanguage } from '@/utils/rtl';
import type { Book } from '@/types/book';
import type { BookRankingEntry } from '@/types/statisticsQueries';
import type { StatsOverviewData } from './statsDataSource';
import { BarChart, Heatmap, StatTile, StatsCard } from './StatsCharts';
import { StatsCover } from './StatsCover';
import { formatDuration, formatNumber, longDate } from './format';

const HOUR_AXIS = [0, 6, 12, 18, 24];

interface StatsOverviewProps {
  data: StatsOverviewData;
  onOpenBook: (entry: BookRankingEntry) => void;
  /** Library books by md5 (Book.hash) so ranking rows show the real cover. */
  booksByMd5?: ReadonlyMap<string, Book>;
}

/** One scrolling overview page, laid out per designs/library-stats.pen StatsPanel/Body. */
export const StatsOverview: React.FC<StatsOverviewProps> = ({ data, onOpenBook, booksByMd5 }) => {
  const _ = useTranslation();
  const { totals, streak, heatmap, hours, ranking } = data;
  const isRtl = getDirFromUILanguage() === 'rtl';
  const Chevron = isRtl ? MdChevronLeft : MdChevronRight;
  const daysRead = heatmap.filter((d) => d.seconds > 0).length;
  const heatmapSeconds = heatmap.reduce((sum, d) => sum + d.seconds, 0);
  const peakHour = hours.reduce((best, v, h) => (v > (hours[best] ?? 0) ? h : best), 0);
  const peakSeconds = hours[peakHour] ?? 0;
  const heatmapLabel =
    _('近 26 周') +
    ': ' +
    _('阅读天数') +
    ' ' +
    formatNumber(daysRead) +
    ', ' +
    _('累计') +
    ' ' +
    formatDuration(heatmapSeconds, _);
  const hoursLabel =
    peakSeconds > 0
      ? _('时段分布') + ': ' + formatNumber(peakHour) + ':00 ' + formatDuration(peakSeconds, _)
      : _('时段分布') + ': ' + _('暂无阅读记录');
  return (
    <div className='flex w-full flex-col gap-4'>
      <div className='flex w-full gap-2'>
        <StatTile label={_('今日')} value={formatDuration(totals.todaySeconds, _)} />
        <StatTile label={_('本周')} value={formatDuration(totals.weekSeconds, _)} />
        <StatTile label={_('累计')} value={formatDuration(totals.totalSeconds, _)} />
      </div>

      <section
        className={clsx(
          'flex w-full items-center justify-between rounded-xl p-3',
          'not-eink:bg-base-200 eink:bg-base-100 eink:border eink:border-base-content',
        )}
      >
        <div className='flex items-center gap-2'>
          <MdLocalFireDepartment size={18} className='text-primary' aria-hidden />
          <bdi className='text-base-content text-sm font-medium'>
            {_('连续阅读 {{days}} 天', {
              days: formatNumber(streak.currentDays),
              count: streak.currentDays,
            })}
          </bdi>
        </div>
        <bdi className='text-base-content/60 text-xs'>
          {_('最长 {{days}} 天', {
            days: formatNumber(streak.longestDays),
            count: streak.longestDays,
          })}
        </bdi>
      </section>

      <StatsCard label={_('近 26 周')}>
        <Heatmap
          days={heatmap}
          label={heatmapLabel}
          legend={{ less: _('少'), more: _('多'), future: _('未来') }}
          describe={(d) => longDate(d.date) + ' ' + formatDuration(d.seconds, _)}
        />
      </StatsCard>

      <StatsCard label={_('时段分布')}>
        <BarChart
          values={hours}
          height={48}
          axis={HOUR_AXIS.map((h) => formatNumber(h))}
          testId='stats-hours'
          label={hoursLabel}
          describe={(h) => formatNumber(h) + ':00 ' + formatDuration(hours[h] ?? 0, _)}
        />
      </StatsCard>

      <StatsCard label={_('按书排行')}>
        {ranking.length === 0 ? (
          <p className='text-base-content/60 py-4 text-center text-sm'>{_('暂无阅读记录')}</p>
        ) : (
          <ul className='flex w-full flex-col'>
            {ranking.map((entry) => (
              <li key={entry.bookMd5}>
                <button
                  type='button'
                  onClick={() => onOpenBook(entry)}
                  data-testid='stats-book-row'
                  data-deleted={entry.deletedFromLibrary || undefined}
                  className={clsx(
                    'flex h-12 w-full items-center gap-3 rounded-lg text-start',
                    'not-eink:hover:bg-base-300',
                    entry.deletedFromLibrary && 'opacity-50',
                  )}
                >
                  <StatsCover
                    book={entry.deletedFromLibrary ? undefined : booksByMd5?.get(entry.bookMd5)}
                    className='h-[35px] w-6 rounded-[2px]'
                  />
                  <span className='min-w-0 flex-1'>
                    <span className='text-base-content block truncate text-[13px] font-medium'>
                      {entry.title || _('无标题')}
                    </span>
                    {entry.deletedFromLibrary && (
                      <span className='text-base-content/60 block text-xs'>{_('已不在书库')}</span>
                    )}
                  </span>
                  <bdi
                    className='text-neutral-content shrink-0 text-xs'
                    data-testid='stats-book-time'
                  >
                    {formatDuration(entry.totalSeconds, _)}
                  </bdi>
                  <Chevron size={16} className='text-base-content/50 shrink-0' aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </StatsCard>
    </div>
  );
};
