import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { FoliateView } from '@/types/view';

vi.mock('@/utils/toc', () => ({ updateToc: vi.fn() }));

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(100);
  useBookDataStore.setState({
    booksData: {
      book: {
        id: 'book',
        book: null,
        file: null,
        bookDoc: null,
        isFixedLayout: false,
        config: { location: 'saved-range', progressUpdatedAt: 10, updatedAt: 20 },
      },
    },
  });
  useLibraryStore.setState({ library: [] });
  useReaderStore.setState({
    viewStates: {
      'book-view': {
        key: 'book-view',
        view: null,
        viewerKey: '',
        isPrimary: true,
        loading: false,
        inited: false,
        error: null,
        progress: null,
        ribbonVisible: false,
        ttsEnabled: false,
        syncing: false,
        gridInsets: null,
        viewSettings: null,
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useReaderStore.setState({ viewStates: {} });
  useBookDataStore.setState({ booksData: {} });
});

const relocate = () =>
  useReaderStore
    .getState()
    .setProgress(
      'book-view',
      'page-normalized-range',
      { id: 1, href: 'chapter', label: 'Chapter' },
      { current: 1, total: 5 },
      { current: 9, total: 100 },
      { section: 1, total: 10 },
      document.createRange(),
    );

describe('reading position versions', () => {
  it('retains the legacy reading time before periodic saves change updatedAt', () => {
    delete useBookDataStore.getState().getConfig('book-view')!.progressUpdatedAt;
    relocate();
    expect(useBookDataStore.getState().getConfig('book-view')?.progressUpdatedAt).toBe(20);
  });

  it('preserves the saved position and version when opening a book on a different page size', () => {
    relocate();
    expect(useBookDataStore.getState().getConfig('book-view')).toMatchObject({
      location: 'saved-range',
      progressUpdatedAt: 10,
      progress: [10, 100],
    });
  });

  it('records a new reading action when the initialized reader turns a page', () => {
    useReaderStore.getState().setViewInited('book-view', true);
    relocate();
    expect(useBookDataStore.getState().getConfig('book-view')).toMatchObject({
      location: 'page-normalized-range',
      progressUpdatedAt: 100,
    });
  });

  it('does not turn applying a synced location into a new local reading action', async () => {
    useReaderStore.getState().setViewInited('book-view', true);
    useReaderStore
      .getState()
      .setView('book-view', { goTo: async () => relocate() } as unknown as FoliateView);
    await useReaderStore.getState().applySyncedProgress('book', 'saved-range');
    expect(useBookDataStore.getState().getConfig('book-view')).toMatchObject({
      location: 'saved-range',
      progressUpdatedAt: 10,
    });
    relocate();
    expect(useBookDataStore.getState().getConfig('book-view')?.progressUpdatedAt).toBe(100);
  });

  it('records reading actions again after a synced navigation fails', async () => {
    useReaderStore.getState().setViewInited('book-view', true);
    useReaderStore.getState().setView('book-view', {
      goTo: async () => {
        throw new Error('navigation failed');
      },
    } as unknown as FoliateView);
    await expect(
      useReaderStore.getState().applySyncedProgress('book', 'saved-range'),
    ).rejects.toThrow('navigation failed');
    relocate();
    expect(useBookDataStore.getState().getConfig('book-view')?.progressUpdatedAt).toBe(100);
  });
});
