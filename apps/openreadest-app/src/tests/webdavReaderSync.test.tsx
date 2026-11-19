import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import WebDavAutoSyncRunner from '@/app/library/components/WebDavAutoSyncRunner';

const mock = vi.hoisted(() => ({
  config: { location: 'pc-1', progressUpdatedAt: 1, updatedAt: 3, booknotes: [] },
  disk: { location: 'pc-0', progressUpdatedAt: 0, updatedAt: 0, booknotes: [] },
  save: vi.fn(),
  sync: vi.fn(),
  goTo: vi.fn(),
  load: vi.fn(),
  syncing: false,
  libraryReady: true,
  lastSuccessAt: null as number | null,
  onLibraryReady: undefined as (() => void) | undefined,
  onReaderReady: undefined as (() => void) | undefined,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { loadBookConfig: mock.load },
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({
      library: mock.libraryReady ? [{ hash: 'book' }] : [],
      setLibrary: vi.fn(),
    }),
    subscribe: (
      listener: (state: { library: unknown[] }, previous: { library: unknown[] }) => void,
    ) => {
      mock.onLibraryReady = () => listener({ library: [{ hash: 'book' }] }, { library: [] });
      return vi.fn();
    },
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/services/webdav/sync/engine', () => ({ syncWebDavSelection: mock.sync }));
vi.mock('@/services/webdav/sync/fingerprint', () => ({
  computeLocalFingerprint: async () => ({ md5: 'same' }),
}));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/store/webdavStore', () => {
  const state = () => ({
    autoSyncEnabled: true,
    autoSyncIntervalMinutes: 5,
    hydrated: true,
    isSyncing: mock.syncing,
    profiles: [{ id: 'profile', serverUrl: 'https://test.invalid', username: 'test' }],
    activeProfileId: 'profile',
    lastSuccessAt: mock.lastSuccessAt,
    lastAutoSyncAttemptAt: 0,
    conflicts: [],
    setSyncing: (value: boolean) => {
      mock.syncing = value;
    },
    setLastAutoSyncAttemptAt: vi.fn(),
    setProgress: vi.fn(),
    addLog: vi.fn(),
    setLastSuccessAt: vi.fn(),
    setConflicts: vi.fn(),
  });
  return {
    useWebDavStore: Object.assign(
      (select: (s: ReturnType<typeof state>) => unknown) => select(state()),
      { getState: state },
    ),
  };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getConfig: () => mock.config,
      saveConfig: mock.save,
      getBookData: () => ({ id: 'book', book: { hash: 'book' } }),
      setConfig: (_key: string, config: typeof mock.config) => {
        mock.config = config;
      },
    }),
  },
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      viewStates: { 'book-view': { key: 'book-view', isPrimary: true, inited: true } },
      getViewState: () => ({ inited: true }),
      applySyncedProgress: (_id: string, location: string) => mock.goTo(location),
    }),
    subscribe: (
      listener: (
        state: { viewStates: Record<string, { isPrimary: boolean; inited: boolean }> },
        previous: { viewStates: Record<string, { inited: boolean }> },
      ) => void,
    ) => {
      mock.onReaderReady = () =>
        listener(
          { viewStates: { 'book-view': { isPrimary: true, inited: true } } },
          { viewStates: {} },
        );
      return vi.fn();
    },
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  mock.config = { location: 'pc-1', progressUpdatedAt: 1, updatedAt: 3, booknotes: [] };
  mock.disk = { location: 'pc-0', progressUpdatedAt: 0, updatedAt: 0, booknotes: [] };
  mock.syncing = false;
  mock.libraryReady = true;
  mock.lastSuccessAt = null;
  mock.save.mockReset().mockResolvedValue(undefined);
  mock.load.mockReset().mockImplementation(async () => mock.disk);
  mock.goTo.mockReset().mockResolvedValue(undefined);
  mock.sync.mockReset().mockImplementation(async () => {
    mock.disk = { location: 'phone-3', progressUpdatedAt: 2, updatedAt: 2, booknotes: [] };
    return { conflicts: [], failures: [] };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WebDAV while reading', () => {
  it('retries a device switch requested while the previous network sync is in flight', async () => {
    let finishSync!: () => void;
    mock.sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSync = () => resolve({ conflicts: [], failures: [] });
        }),
    );
    render(<WebDavAutoSyncRunner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock.syncing).toBe(true);
    mock.config = { ...mock.config, location: 'pc-new', progressUpdatedAt: 4, updatedAt: 4 };
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    await act(async () => {
      finishSync();
    });
    expect(mock.sync).toHaveBeenCalledTimes(2);
    expect(mock.config.location).toBe('pc-new');
  });

  it('flushes progress when leaving the app before switching devices', async () => {
    render(<WebDavAutoSyncRunner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(mock.sync).toHaveBeenCalledTimes(2);
  });

  it('checks the other device on startup even after a recent successful sync', async () => {
    mock.lastSuccessAt = Date.now();
    render(<WebDavAutoSyncRunner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock.sync).toHaveBeenCalledTimes(1);
  });

  it('starts syncing when the library finishes loading after the first tick', async () => {
    mock.libraryReady = false;
    render(<WebDavAutoSyncRunner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock.sync).not.toHaveBeenCalled();
    mock.libraryReady = true;
    await act(async () => {
      mock.onLibraryReady?.();
    });
    expect(mock.sync).toHaveBeenCalledTimes(1);
  });

  it('pulls progress when a reader opens without waiting for the periodic timer', async () => {
    render(<WebDavAutoSyncRunner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      mock.onReaderReady?.();
    });
    expect(mock.sync).toHaveBeenCalledTimes(2);
  });

  it('flushes progress, adopts the newer phone position and syncs again on focus', async () => {
    render(<WebDavAutoSyncRunner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock.save.mock.invocationCallOrder[0]).toBeLessThan(
      mock.sync.mock.invocationCallOrder[0]!,
    );
    expect(mock.config.location).toBe('phone-3');
    expect(mock.goTo).toHaveBeenCalledWith('phone-3');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mock.sync).toHaveBeenCalledTimes(2);
  });
  it('keeps a position changed locally while the network sync was running', async () => {
    mock.sync.mockImplementation(async () => {
      mock.config = { ...mock.config, location: 'pc-new', progressUpdatedAt: 4, updatedAt: 4 };
      return { conflicts: [], failures: [] };
    });
    render(<WebDavAutoSyncRunner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock.config.location).toBe('pc-new');
    expect(mock.goTo).not.toHaveBeenCalled();
  });

  it('does not rewrite a book config when its progress and contents are unchanged', async () => {
    mock.disk = { ...mock.config };
    mock.sync.mockResolvedValue({ conflicts: [], failures: [] });
    render(<WebDavAutoSyncRunner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock.sync).toHaveBeenCalledOnce();
    expect(mock.save).not.toHaveBeenCalled();
  });
});
