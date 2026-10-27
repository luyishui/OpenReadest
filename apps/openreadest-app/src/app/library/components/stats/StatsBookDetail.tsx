import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { Book } from '@/types/book';
import type { BookDetail } from '@/types/statisticsQueries';
import { BarChart, StatTile, StatsCard } from './StatsCharts';
import { StatsCover } from './StatsCover';
import { formatDuration, formatNumber, formatWhen, longDate, shortDate } from './format';

interface StatsBookDetailProps {
  detail: BookDetail;
  /** Unix seconds; injected so '今天/昨天' labels are testable. */
  now: number;
  /** The library book, for its real cover; undefined (deleted / unknown) = placeholder. */
  book?: Book;
}

/** Per-book page pushed inside the panel, laid out per library-stats.pen StatsBookDetail/DetailBody. */
export const StatsBookDetail: React.FC<StatsBookDetailProps> = ({ detail, now, book }) => {
  const _ = useTranslation();
  const days = detail.last30Days;
  // Design axis: first day, the middle day (index 15 of 30), then 今天.
  const axis =
    days.length > 0
      ? [shortDate(days[0]!.date), shortDate((days[15] ?? days[0]!).date), _('今天')]
      : [];
  const last30Seconds = days.reduce((sum, d) => sum + d.seconds, 0);
  const dailyLabel =
    _('近 30 天每日时长') + ': ' + _('累计') + ' ' + formatDuration(last30Seconds, _);
  return (
    <div className='flex w-full flex-col gap-4' data-testid='stats-book-detail'>
      <div className='flex w-full items-center gap-3'>
        <StatsCover book={book} className='h-[70px] w-12 rounded' />
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          {detail.authors && (
            <span className='text-neutral-content truncate text-[13px]'>{detail.authors}</span>
          )}
          <bdi className='text-base-content text-sm font-semibold'>
            {_('已读 {{percent}}%', { percent: formatNumber(detail.progressPercent) })}
          </bdi>
          <bdi className='text-base-content/60 text-xs'>
            {_('上次阅读 {{when}}', { when: formatWhen(detail.lastReadTime, now, _) })}
          </bdi>
        </div>
      </div>

      <div className='flex w-full gap-2'>
        <StatTile label={_('累计')} value={formatDuration(detail.totalSeconds, _)} />
        <StatTile
          label={_('阅读天数')}
          value={_('{{days}} 天', { days: formatNumber(detail.daysRead), count: detail.daysRead })}
        />
        <StatTile label={_('平均每次')} value={formatDuration(detail.averageSessionSeconds, _)} />
      </div>

      <StatsCard label={_('近 30 天每日时长')}>
        <BarChart
          values={days.map((d) => d.seconds)}
          height={56}
          axis={axis}
          testId='stats-daily'
          label={dailyLabel}
          describe={(i) =>
            (days[i] ? longDate(days[i]!.date) : '') + ' ' + formatDuration(days[i]?.seconds ?? 0, _)
          }
        />
      </StatsCard>

      <StatsCard label={_('阅读记录')}>
        {detail.sessions.length === 0 ? (
          <p className='text-base-content/60 py-4 text-center text-sm'>{_('暂无阅读记录')}</p>
        ) : (
          <ul className='flex w-full flex-col'>
            {detail.sessions.map((s) => (
              <li
                key={s.startTime}
                data-testid='stats-session-row'
                className='flex h-10 w-full items-center gap-3'
              >
                <bdi className='text-base-content min-w-0 flex-1 truncate text-[13px]'>
                  {formatWhen(s.startTime, now, _)}
                </bdi>
                <bdi className='text-base-content/60 shrink-0 text-xs'>
                  +{formatNumber(s.progressDeltaPercent)}%
                </bdi>
                <bdi
                  className='text-neutral-content shrink-0 text-xs font-medium'
                  data-testid='stats-session-time'
                >
                  {formatDuration(s.durationSeconds, _)}
                </bdi>
              </li>
            ))}
          </ul>
        )}
      </StatsCard>
    </div>
  );
};
