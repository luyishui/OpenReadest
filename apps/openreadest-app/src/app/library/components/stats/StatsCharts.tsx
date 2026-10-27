import clsx from 'clsx';
import React from 'react';
import type { DailySeconds } from '@/types/statisticsQueries';
import { heatLevel } from './format';

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
// Future (not yet reached) cells: faint outline; dashed on e-ink so they never read as a level.
export const FUTURE_CELL_CLASS =
  'border-base-content/20 h-3 w-full rounded-[2px] border bg-transparent eink:border-dashed eink:border-base-content';
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

/**
 * Monday-aligned week columns x 7 day rows. `days` runs oldest first through
 * today, so the current week is short; it is padded with future cells (neutral,
 * no tooltip, aria-hidden) so every column is full and the grid is a rectangle.
 */
export const Heatmap: React.FC<{
  days: DailySeconds[];
  describe: (d: DailySeconds) => string;
  // Screen-reader summary of the whole grid; per-cell titles are mouse-only.
  label?: string;
}> = ({ days, describe, label }) => {
  const max = days.reduce((m, d) => Math.max(m, d.seconds), 0);
  const columns = Math.ceil(days.length / 7);
  return (
    <div className='flex w-full gap-[3px]' data-testid='stats-heatmap' role='img' aria-label={label}>
      {Array.from({ length: columns }, (_, w) => (
        <div key={w} className='flex flex-1 flex-col gap-[3px]'>
          {Array.from({ length: 7 }, (_, r) => {
            const d = days[w * 7 + r];
            return d ? (
              <div
                key={r}
                title={describe(d)}
                className={clsx('h-3 w-full rounded-[2px]', HEAT_CLASSES[heatLevel(d.seconds, max)])}
              />
            ) : (
              <div
                key={r}
                data-future='true'
                aria-hidden='true'
                className={FUTURE_CELL_CLASS}
              />
            );
          })}
        </div>
      ))}
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
