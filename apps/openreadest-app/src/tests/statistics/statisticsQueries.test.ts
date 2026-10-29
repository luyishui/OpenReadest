import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  SESSION_GAP_SECONDS,
  HEATMAP_WEEKS,
  getBookDetail,
  getBookRanking,
  getDailyHeatmap,
  getHourDistribution,
  getStreak,
  getTotals,
} from '@/services/statistics/statisticsQueries';
import { localeWeekStart } from '@/services/statistics/localTime';
import type { DatabaseService } from '@/types/database';
import type { StatsQueryOptions } from '@/types/statisticsQueries';

const SH = 'Asia/Shanghai';
const LA = 'America/Los_Angeles';
/** Unix seconds for a Shanghai (UTC+8, no DST) wall-clock time. */
const sh = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) =>
  Date.UTC(y, mo - 1, d, h - 8, mi, s) / 1000;
// Wednesday 2026-10-28 12:00 Shanghai (= Tuesday 2026-10-27 21:00 Los Angeles, PDT).
const NOW = sh(2026, 10, 28, 12);
const SH_OPTS: StatsQueryOptions = { now: NOW, timeZone: SH };
const LA_OPTS: StatsQueryOptions = { now: NOW, timeZone: LA };

describe('statisticsQueries', () => {
  let db: DatabaseService;
  let stats: StatisticsDb;

  const book = (md5: string) => stats.upsertBook({ bookMd5: md5, title: 'T ' + md5, authors: 'A ' + md5 });
  const ev = (id: number, page: number, startTime: number, duration: number, totalPages = 100) =>
    stats.insertPageEvent(id, { page, startTime, duration, totalPages });

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    stats = StatisticsDb.from(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns zeros and empty lists on an empty database', async () => {
    expect(await getTotals(db, SH_OPTS)).toEqual({
      todaySeconds: 0,
      weekSeconds: 0,
      totalSeconds: 0,
      weekStartDate: '2026-10-26',
    });
    expect(await getStreak(db, SH_OPTS)).toEqual({ currentDays: 0, longestDays: 0 });
    const heat = await getDailyHeatmap(db, SH_OPTS);
    expect(heat).toHaveLength(HEATMAP_WEEKS * 7);
    expect(heat.every((d) => d.seconds === 0)).toBe(true);
    expect(await getHourDistribution(db, SH_OPTS)).toEqual(new Array(24).fill(0));
    expect(await getBookRanking(db)).toEqual([]);
    expect(await getBookDetail(db, 'missing', SH_OPTS)).toBeNull();
  });

  it('computes today / Monday-started week / total in Asia/Shanghai', async () => {
    const id = await book('a');
    await ev(id, 1, sh(2026, 10, 28, 10), 100); // today (Wed)
    await ev(id, 2, sh(2026, 10, 26, 9), 50); // Monday, this week
    await ev(id, 3, sh(2026, 10, 25, 9), 20); // Sunday, previous week
    expect(await getTotals(db, SH_OPTS)).toEqual({
      todaySeconds: 100,
      weekSeconds: 150,
      totalSeconds: 170,
      weekStartDate: '2026-10-26',
    });
  });

  it('buckets the same instant by the local day and hour of the zone', async () => {
    const id = await book('a');
    // 2026-10-28 05:00 UTC = Wed 13:00 Shanghai = Tue 22:00 Los Angeles.
    await ev(id, 1, Date.UTC(2026, 9, 28, 5) / 1000, 60);
    const shHeat = await getDailyHeatmap(db, SH_OPTS);
    const laHeat = await getDailyHeatmap(db, LA_OPTS);
    expect(shHeat.find((d) => d.date === '2026-10-28')).toEqual({ date: '2026-10-28', seconds: 60 });
    expect(laHeat.find((d) => d.date === '2026-10-27')).toEqual({ date: '2026-10-27', seconds: 60 });
    expect((await getHourDistribution(db, SH_OPTS))[13]).toBe(60);
    expect((await getHourDistribution(db, LA_OPTS))[22]).toBe(60);
    expect((await getTotals(db, SH_OPTS)).todaySeconds).toBe(60);
    expect((await getTotals(db, LA_OPTS)).todaySeconds).toBe(60);
    expect((await getTotals(db, LA_OPTS)).weekStartDate).toBe('2026-10-26');
  });

  it('splits an event that crosses local midnight between both days and hours', async () => {
    const id = await book('a');
    await ev(id, 1, sh(2026, 10, 27, 23, 59), 120);
    const heat = await getDailyHeatmap(db, SH_OPTS);
    expect(heat.filter((d) => d.seconds > 0)).toEqual([
      { date: '2026-10-27', seconds: 60 },
      { date: '2026-10-28', seconds: 60 },
    ]);
    const hours = await getHourDistribution(db, SH_OPTS);
    expect(hours[23]).toBe(60);
    expect(hours[0]).toBe(60);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(120);
  });

  it('counts current and longest streaks, alive until today ends', async () => {
    const id = await book('a');
    for (const d of [20, 21, 22, 26, 27]) await ev(id, d, sh(2026, 10, d, 20), 30);
    expect(await getStreak(db, SH_OPTS)).toEqual({ currentDays: 2, longestDays: 3 });
    await ev(id, 99, sh(2026, 10, 28, 8), 30);
    expect(await getStreak(db, SH_OPTS)).toEqual({ currentDays: 3, longestDays: 3 });
    // Two days without reading breaks the current streak.
    const later = { now: sh(2026, 10, 30, 12), timeZone: SH };
    expect(await getStreak(db, later)).toEqual({ currentDays: 0, longestDays: 3 });
  });

  it('heatmap is 26 full Monday-started weeks with zero fill and future placeholders', async () => {
    const id = await book('a');
    await ev(id, 1, sh(2026, 6, 1, 10), 45); // inside the range
    await ev(id, 2, sh(2026, 5, 3, 10), 45); // the Sunday before the first week
    const heat = await getDailyHeatmap(db, SH_OPTS);
    expect(heat).toHaveLength(182);
    expect(heat[0]).toEqual({ date: '2026-05-04', seconds: 0 });
    expect(heat.find((d) => d.date === '2026-06-01')!.seconds).toBe(45);
    expect(heat.filter((d) => d.seconds > 0)).toHaveLength(1);
    expect(heat.slice(-4)).toEqual(
      ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((date) => ({ date, seconds: 0, future: true })),
    );
  });

  it.each([
    { name: 'Monday', locale: 'zh-CN', now: sh(2026, 10, 26, 12), today: '2026-10-26', first: '2026-05-04', future: 6 },
    { name: 'Wednesday', locale: 'zh-CN', now: sh(2026, 10, 28, 12), today: '2026-10-28', first: '2026-05-04', future: 4 },
    { name: 'Sunday', locale: 'zh-CN', now: sh(2026, 11, 1, 12), today: '2026-11-01', first: '2026-05-04', future: 0 },
    { name: 'Monday', locale: 'en-US', now: sh(2026, 10, 26, 12), today: '2026-10-26', first: '2026-05-03', future: 5 },
    { name: 'Wednesday', locale: 'en-US', now: sh(2026, 10, 28, 12), today: '2026-10-28', first: '2026-05-03', future: 3 },
    { name: 'Sunday', locale: 'en-US', now: sh(2026, 11, 1, 12), today: '2026-11-01', first: '2026-05-10', future: 6 },
  ])(
    'aligns the heatmap to $locale weeks with today in place when today is a $name',
    async ({ locale, now, today, first, future }) => {
      const id = await book('a');
      await ev(id, 1, now - 3600, 180);
      const heat = await getDailyHeatmap(db, { now, timeZone: SH, weekStart: localeWeekStart(locale) });
      expect(heat).toHaveLength(182);
      expect(heat[0]!.date).toBe(first);
      expect(heat[181 - future]).toEqual({ date: today, seconds: 180 });
      const futureDays = heat.filter((d) => d.future);
      expect(futureDays).toHaveLength(future);
      expect(heat.slice(182 - future)).toEqual(futureDays);
      expect(futureDays.every((d) => d.seconds === 0 && d.date > today)).toBe(true);
      expect(heat.filter((d) => d.seconds > 0)).toHaveLength(1);
    },
  );

  it('keeps 182 distinct consecutive heatmap days across a DST change in Los Angeles', async () => {
    const id = await book('a');
    const now = Date.UTC(2026, 10, 2, 20) / 1000; // Mon 2026-11-02 12:00 PST, the day after DST ends
    await ev(id, 1, Date.UTC(2026, 10, 1, 20) / 1000, 60); // Sun 2026-11-01 12:00 PST
    const heat = await getDailyHeatmap(db, { now, timeZone: LA });
    expect(heat).toHaveLength(182);
    expect(new Set(heat.map((d) => d.date)).size).toBe(182);
    for (let i = 1; i < heat.length; i++) {
      expect(Date.parse(heat[i]!.date) - Date.parse(heat[i - 1]!.date)).toBe(86_400_000);
    }
    expect(heat[0]!.date).toBe('2026-05-11');
    expect(heat.slice(174, 176)).toEqual([
      { date: '2026-11-01', seconds: 60 },
      { date: '2026-11-02', seconds: 0 },
    ]);
    expect(heat.filter((d) => d.future)).toHaveLength(6);
  });

  it('ranks books by total time and flags books removed from the library', async () => {
    const a = await book('a');
    const b = await book('b');
    await ev(a, 1, sh(2026, 10, 20, 10), 30);
    await ev(b, 1, sh(2026, 10, 21, 10), 90);
    await ev(b, 2, sh(2026, 10, 21, 10, 2), 60);
    const ranking = await getBookRanking(db, new Set(['a']));
    expect(ranking.map((r) => [r.bookMd5, r.totalSeconds, r.deletedFromLibrary])).toEqual([
      ['b', 150, true],
      ['a', 30, false],
    ]);
    expect(ranking[0]).toMatchObject({ title: 'T b', authors: 'A b', lastReadTime: sh(2026, 10, 21, 10, 3) });
    expect((await getBookRanking(db)).every((r) => !r.deletedFromLibrary)).toBe(true);
  });

  it('splits sessions on gaps larger than the exported threshold', async () => {
    expect(SESSION_GAP_SECONDS).toBe(600);
    const id = await book('a');
    const t0 = sh(2026, 10, 27, 9);
    await ev(id, 1, t0, 60);
    await ev(id, 2, t0 + 60 + SESSION_GAP_SECONDS, 60); // gap exactly 600: same session
    const t1 = t0 + 120 + SESSION_GAP_SECONDS + SESSION_GAP_SECONDS + 1; // gap 601: new session
    await ev(id, 3, t1, 30);
    const detail = (await getBookDetail(db, 'a', SH_OPTS))!;
    expect(detail.sessionCount).toBe(2);
    expect(detail.sessions.map((s) => [s.startTime, s.durationSeconds])).toEqual([
      [t1, 30],
      [t0, 120],
    ]);
    expect(detail.sessions[1]!.endTime).toBe(t0 + 120 + SESSION_GAP_SECONDS);
    expect(detail.averageSessionSeconds).toBe(75);
    expect(detail.totalSeconds).toBe(150);
  });

  it('builds per-book detail with days read and a 30-day series ending today', async () => {
    const id = await book('a');
    await ev(id, 10, sh(2026, 9, 1, 10), 40); // before the 30-day window
    await ev(id, 20, sh(2026, 10, 1, 10), 50);
    await ev(id, 40, sh(2026, 10, 28, 10), 60);
    const detail = (await getBookDetail(db, 'a', SH_OPTS))!;
    expect(detail).toMatchObject({
      bookMd5: 'a',
      title: 'T a',
      authors: 'A a',
      totalSeconds: 150,
      daysRead: 3,
      sessionCount: 3,
      averageSessionSeconds: 50,
      firstReadTime: sh(2026, 9, 1, 10),
      lastReadTime: sh(2026, 10, 28, 10, 1),
      progressPercent: 40,
    });
    expect(detail.last30Days).toHaveLength(30);
    expect(detail.last30Days[0]).toEqual({ date: '2026-09-29', seconds: 0 });
    expect(detail.last30Days.find((d) => d.date === '2026-10-01')!.seconds).toBe(50);
    expect(detail.last30Days[29]).toEqual({ date: '2026-10-28', seconds: 60 });
  });

  it('reports +N% progress per session, robust to repagination and going back', async () => {
    const id = await book('a');
    const t = sh(2026, 10, 25, 9);
    await ev(id, 10, t, 60, 100);
    await ev(id, 30, t + 60, 60, 100); // session 1: 10% -> 30%
    const t2 = t + 3600;
    await ev(id, 50, t2, 60, 200); // 25%
    await ev(id, 20, t2 + 60, 60, 50); // repaginated: 40% -> +15
    const t3 = t + 7200;
    await ev(id, 30, t3, 60, 50); // 60%
    await ev(id, 10, t3 + 60, 60, 50); // went back to 20%: never negative
    const detail = (await getBookDetail(db, 'a', SH_OPTS))!;
    expect(detail.sessions.map((s) => s.progressDeltaPercent)).toEqual([0, 15, 20]);
    expect(detail.sessions[1]).toMatchObject({ startPage: 50, endPage: 20 });
    expect(detail.progressPercent).toBe(20);
  });
});
