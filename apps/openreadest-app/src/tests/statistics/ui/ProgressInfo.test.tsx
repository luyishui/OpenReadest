import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import type { PageInfo, TimeInfo } from '@/types/book';
import ProgressInfoView from '@/app/reader/components/ProgressInfo';

const state = vi.hoisted(() => ({
  median: null as number | null,
  hashSeen: [] as (string | undefined)[],
  keysSeen: [] as (string | number | undefined)[],
  viewSettings: {} as Record<string, unknown>,
  translations: {} as Record<string, string>,
  renderer: { page: 0, pages: 1 },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts: Record<string, string | number> = {}) =>
    (state.translations[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      String(opts[name] ?? ''),
    ),
}));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: (hash?: string, refreshKey?: string | number) => {
    state.hashSeen.push(hash);
    state.keysSeen.push(refreshKey);
    return state.median;
  },
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ renderer: state.renderer }),
    getViewSettings: () => state.viewSettings,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: false, book: { hash: 'book-hash' } }),
  }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };
const pageinfo = { current: 9, total: 20 } as PageInfo;
const timeinfo = { section: 3, total: 30 } as unknown as TimeInfo;
const chapterTogglesOff = { showRemainingTime: false, showRemainingPages: false };

const renderInfo = () =>
  render(
    <ProgressInfoView
      bookKey='book-1'
      pageinfo={pageinfo}
      timeinfo={timeinfo}
      horizontalGap={5}
      contentInsets={insets}
      gridInsets={insets}
    />,
  );

beforeEach(() => {
  state.median = null;
  state.hashSeen = [];
  state.keysSeen = [];
  state.translations = {};
  state.renderer = { page: 0, pages: 1 };
  localStorage.removeItem('i18nextLng');
  state.viewSettings = {
    vertical: false,
    scrolled: false,
    isEink: false,
    progressStyle: 'percentage',
    progressInfoMode: 'all',
    showRemainingTime: true,
    showRemainingPages: false,
    showProgressInfo: true,
    tapToToggleFooter: false,
  };
});

afterEach(() => {
  cleanup();
});

describe('reader ProgressInfo whole-book remaining time', () => {
  it('appends the book estimate after the chapter time', () => {
    state.median = 60;
    const { container } = renderInfo();
    // 20 - 9 - 1 = 10 pages left at 60 s/page.
    expect(container.textContent).toContain('3 min left in chapter · 全书还剩 10 分');
    expect(state.hashSeen).toContain('book-hash');
    const label = container.querySelector('.progressinfo')?.getAttribute('aria-label');
    expect(label).toContain('全书还剩 10 分');
  });

  it('hides the estimate when there is no median (stats off or too little data)', () => {
    const { container } = renderInfo();
    expect(container.textContent).toContain('3 min left in chapter');
    expect(container.textContent).not.toContain('全书还剩');
  });

  it('hides the estimate on the last page', () => {
    state.median = 60;
    const { container } = render(
      <ProgressInfoView
        bookKey='book-1'
        pageinfo={{ current: 19, total: 20 } as PageInfo}
        horizontalGap={5}
        contentInsets={insets}
        gridInsets={insets}
      />,
    );
    expect(container.textContent).not.toContain('全书还剩');
  });

  it('shows the estimate alone with the default footer settings (chapter toggles off)', () => {
    state.median = 60;
    state.viewSettings = { ...state.viewSettings, ...chapterTogglesOff };
    const { container } = renderInfo();
    const slot = container.querySelector('.progressinfo span.text-start');
    expect(slot?.textContent).toBe('全书还剩 10 分');
    expect(container.textContent).not.toContain('min left in chapter');
    const label = container.querySelector('.progressinfo')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('全书还剩 10 分');
    expect(label).not.toContain('min left in chapter');
  });

  it('renders no remaining slot when the toggles are off and there is no estimate', () => {
    state.viewSettings = { ...state.viewSettings, ...chapterTogglesOff };
    const { container } = renderInfo();
    expect(container.querySelector('.progressinfo span.text-start')).toBeNull();
  });

  it.each(['none', 'progress'])('hides the estimate in progressInfoMode %s', (mode) => {
    state.median = 60;
    state.viewSettings = { ...state.viewSettings, ...chapterTogglesOff, progressInfoMode: mode };
    const { container } = renderInfo();
    expect(container.textContent).not.toContain('全书还剩');
  });

  it('shows the estimate in progressInfoMode remaining', () => {
    state.median = 60;
    state.viewSettings = {
      ...state.viewSettings,
      ...chapterTogglesOff,
      progressInfoMode: 'remaining',
    };
    const { container } = renderInfo();
    expect(container.textContent).toContain('全书还剩 10 分');
  });

  it('renders the estimate once with both chapter toggles on', () => {
    state.median = 60;
    state.renderer = { page: 0, pages: 4 };
    state.viewSettings = { ...state.viewSettings, showRemainingTime: true, showRemainingPages: true };
    const { container } = renderInfo();
    expect((container.textContent ?? '').split('全书还剩').length - 1).toBe(1);
    expect(container.querySelectorAll('.book-time-left')).toHaveLength(1);
    expect(container.textContent).toContain('3 min left in chapter · 全书还剩 10 分');
  });

  it('keeps the whole-book estimate in its own non-shrinking span (narrow footer)', () => {
    state.median = 60;
    const { container } = renderInfo();
    const span = container.querySelector('.book-time-left');
    expect(span?.textContent).toContain('全书还剩 10 分');
    expect(span?.className).toContain('shrink-0');
    expect(span?.className).toContain('whitespace-nowrap');
  });

  it('passes a coarse progress tick once the median is known', () => {
    state.median = 60;
    renderInfo();
    // pageinfo.current = 9 -> tick floor(9 / 20) = 0 (page-unit = pageinfo for reflowable).
    expect(state.keysSeen[state.keysSeen.length - 1]).toBe(0);
  });

  it('re-reads a null median on every page turn so it shows before page 21', () => {
    state.viewSettings = { ...state.viewSettings, ...chapterTogglesOff };
    const footer = (current: number) => (
      <ProgressInfoView
        bookKey='book-1'
        pageinfo={{ current, total: 112 } as PageInfo}
        horizontalGap={5}
        contentInsets={insets}
        gridInsets={insets}
      />
    );
    const { container, rerender } = render(footer(9));
    expect(container.textContent).not.toContain('全书还剩');
    expect(state.keysSeen[state.keysSeen.length - 1]).toBe('page-9');
    // The 5th event lands: the next page turn (same /20 tick) must re-read the median.
    state.median = 60;
    rerender(footer(10));
    expect(state.keysSeen).toContain('page-10');
    expect(container.textContent).toContain('全书还剩');
    // Once known, it falls back to the coarse tick floor(10 / 20) = 0.
    expect(state.keysSeen[state.keysSeen.length - 1]).toBe(0);
  });

  it('localizes estimate numerals in the vertical zh footer like the progress text', () => {
    state.median = 60;
    localStorage.setItem('i18nextLng', 'zh-CN');
    state.viewSettings = { ...state.viewSettings, vertical: true };
    const { container } = renderInfo();
    const text = container.querySelector('.book-time-left')?.textContent ?? '';
    expect(text).toContain('全书还剩');
    expect(text).not.toMatch(/\d/);
  });
});

describe('reader ProgressInfo remaining pages', () => {
  it('strips Trans markers from the pages-left text and announces only the shown slot', () => {
    // zh-CN ships this key as Trans markup; the footer and aria-label are plain text.
    state.translations['{{count}} pages left in chapter'] =
      '<1>本章剩余 </1><0>{{count}}</0><1> 页</1>';
    state.renderer = { page: 0, pages: 4 };
    state.viewSettings = {
      ...state.viewSettings,
      showRemainingTime: false,
      showRemainingPages: true,
    };
    const { container } = renderInfo();
    const label = container.querySelector('.progressinfo')?.getAttribute('aria-label') ?? '';
    expect(container.textContent).toContain('本章剩余 3 页');
    expect(container.textContent).not.toMatch(/<\/?\d+>/);
    expect(label).toContain('本章剩余 3 页');
    expect(label).not.toMatch(/<\/?\d+>/);
    expect(label).not.toContain('min left in chapter');
  });
});
