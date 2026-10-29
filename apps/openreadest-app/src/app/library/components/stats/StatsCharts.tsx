import clsx from 'clsx';
import React from 'react';
import type { DailySeconds } from '@/types/statisticsQueries';
import { heatLevel, uiLocale } from './format';

// Heat levels 1..4 use the primary token at the design's opacities (0.3 / 0.5 / 0.75 / 1);
// level 0 is base-300. E-ink flattens colour and opacity, and globals.css repaints an exact
// .bg-primary as an empty outline, so there levels 1-3 are bordered hatches of rising density
// and level 4 is solid base-content (bg-primary/100 keeps clear of that override).
const EINK_HATCH = 'eink:border eink:border-base-content eink:text-base-content eink:bg-transparent';
export const HEAT_CLASSES = [
  'bg-base-300',
  'bg-primary/30 ' +
    EINK_HATCH +
    ' eink:bg-[repeating-linear-gradient(135deg,currentColor_0_1px,transparent_1px_5px)]',
  'bg-primary/50 ' +
    EINK_HATCH +
    ' eink:bg-[repeating-linear-gradient(135deg,currentColor_0_1px,transparent_1px_3px)]',
  'bg-primary/75 ' +
    EINK_HATCH +
    ' eink:bg-[repeating-linear-gradient(135deg,currentColor_0_2px,transparent_2px_3px)]',
  'bg-primary/100 eink:bg-base-content',
];
// Non-empty bars: solid primary, solid base-content on e-ink.
export const BAR_FILLED_CLASS = 'bg-primary/100 eink:bg-base-content';

export const StatsCard: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({
  label,
  className,
  children,
}) => (
  <section
    className={clsx(
      'flex w-full flex-col gap-2 rounded-xl p-3',
      'not-eink:bg-base-200 eink:bg-base-100 eink:border eink:border-base-content',
      className,
    )}
  >
    <h3 className='text-base-content/60 text-xs font-normal'>{label}</h3>
    {children}
  </section>
);

export const StatTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className={clsx(
      'flex min-w-0 flex-1 flex-col gap-1 rounded-xl p-3',
      'not-eink:bg-base-200 eink:bg-base-100 eink:border eink:border-base-content',
    )}
  >
    <span className='text-base-content/60 text-xs'>{label}</span>
    <bdi className='text-base-content truncate text-xl font-semibold' data-testid='stat-tile-value'>
      {value}
    </bdi>
  </div>
);

// Hollow placeholder for days after today: dashed outline, no fill. Zero-read past days
// stay solid bg-base-300 with no border, so a future day never looks like an empty one.
export const FUTURE_CELL_CLASS =
  'border border-dashed border-base-content/20 bg-transparent eink:border-base-content eink:border-dashed';
const TODAY_CELL_CLASS = 'outline outline-1 outline-offset-1 outline-base-content';
// Locales whose narrow weekday is a distinct single character (一/三/五/日).
const NARROW_WEEKDAY_LANG = /^(zh|ja|ko)\b/i;

// One column per week, oldest first and the current week last; one row per weekday in the
// order the data source laid the days out (locale week start first). Days after today are
// hollow placeholders; today keeps its heat colour plus an outline. Under RTL the flex rows
// mirror, so the newest column stays last in reading order.
export const Heatmap: React.FC<{
  days: DailySeconds[];
  describe: (d: DailySeconds) => string;
  // Screen-reader summary of the whole grid; per-cell titles are mouse-only.
  label?: string;
  legend?: { less: string; more: string; future: string };
  locale?: string;
}> = ({ days, describe, label, legend, locale = uiLocale() }) => {
  const max = days.reduce((m, d) => (d.future ? m : Math.max(m, d.seconds)), 0);
  // findIndex, not findLastIndex: ES2023 is missing on iOS 15.0-15.3 and old Android WebViews.
  const firstFuture = days.findIndex((d) => d.future);
  const today = days[firstFuture === -1 ? days.length - 1 : firstFuture - 1];
  const weeks: DailySeconds[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const weekdayFmt = new Intl.DateTimeFormat(locale, {
    weekday: locale && NARROW_WEEKDAY_LANG.test(locale) ? 'narrow' : 'short',
    timeZone: 'UTC',
  });
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const monthLabels = weeks.map((week) => {
    const first = week.find((d) => d.date.endsWith('-01'));
    // Formatted with timeZone UTC so the key's calendar day is kept.
    return first ? monthFmt.format(new Date(first.date + 'T00:00:00Z')) : '';
  });
  return (
    <div className='flex w-full flex-col gap-1'>
      <div className='flex w-full gap-1'>
        <div aria-hidden className='text-base-content/60 flex shrink-0 flex-col gap-[3px] pt-4 text-[10px] leading-3'>
          {(weeks[0] ?? []).map((d, r) => (
            <span key={r} className='h-3 whitespace-nowrap' data-testid='stats-heatmap-weekday'>
              {r % 2 === 0 ? weekdayFmt.format(new Date(d.date + 'T00:00:00Z')) : ''}
            </span>
          ))}
        </div>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <div aria-hidden className='text-base-content/60 flex h-3 w-full gap-[3px] text-[10px] leading-3'>
            {monthLabels.map((m, w) => (
              <span
                key={w}
                className='w-0 min-w-0 flex-1 overflow-visible whitespace-nowrap'
                data-testid='stats-heatmap-month'
              >
                {m}
              </span>
            ))}
          </div>
          <div className='flex w-full gap-[3px]' data-testid='stats-heatmap' role='img' aria-label={label}>
            {weeks.map((week, w) => (
              <div key={w} className='flex min-w-0 flex-1 flex-col gap-[3px]'>
                {week.map((d, r) =>
                  d.future ? (
                    <div
                      key={r}
                      data-future=''
                      aria-hidden
                      className={clsx('h-3 w-full rounded-[2px]', FUTURE_CELL_CLASS)}
                    />
                  ) : (
                    <div
                      key={r}
                      title={describe(d)}
                      data-today={d === today ? '' : undefined}
                      className={clsx(
                        'h-3 w-full rounded-[2px]',
                        HEAT_CLASSES[heatLevel(d.seconds, max)],
                        d === today && TODAY_CELL_CLASS,
                      )}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {legend && (
        <div
          aria-hidden
          data-testid='stats-heatmap-legend'
          className='text-base-content/60 flex items-center justify-end gap-1 text-[10px] leading-3'
        >
          <span>{legend.less}</span>
          {HEAT_CLASSES.map((c, i) => (
            <span key={i} className={clsx('h-2.5 w-2.5 shrink-0 rounded-[2px]', c)} />
          ))}
          <span>{legend.more}</span>
          <span className={clsx('ms-2 h-2.5 w-2.5 shrink-0 rounded-[2px]', FUTURE_CELL_CLASS)} />
          <span>{legend.future}</span>
        </div>
      )}
    </div>
  );
};

/** Bottom-aligned bars scaled to the series max; empty buckets keep a 2px base-300 stub. */
export const BarChart: React.FC<{
  values: number[];
  height: number;
  axis: string[];
  testId: string;
  describe: (index: number) => string;
  // Screen-reader summary of the series; per-bar titles are mouse-only.
  label?: string;
}> = ({ values, height, axis, testId, describe, label }) => {
  const max = Math.max(0, ...values);
  return (
    <>
      <div
        className='flex w-full items-end gap-[2px]'
        style={{ height }}
        data-testid={testId}
        role='img'
        aria-label={label}
      >
        {values.map((v, i) => (
          <div
            key={i}
            title={describe(i)}
            className={clsx('flex-1 rounded-[2px]', v > 0 ? BAR_FILLED_CLASS : 'bg-base-300')}
            style={{ height: v > 0 && max > 0 ? Math.max(2, (v / max) * height) : 2 }}
          />
        ))}
      </div>
      <div className='text-base-content/60 flex w-full justify-between text-xs'>
        {axis.map((a, i) => (
          <span key={i}>{a}</span>
        ))}
      </div>
    </>
  );
};
