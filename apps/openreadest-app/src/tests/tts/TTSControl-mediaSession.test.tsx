import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { eventDispatcher } from '@/utils/event';

type Handler = () => void;

const state = vi.hoisted(() => ({
  appService: { isMobile: false, isIOSApp: false, hasSafeAreaInset: false } as object,
  session: null as unknown,
  controllers: [] as unknown[],
  // Hold the artwork fetch / controller init open to land a stop mid-start.
  imageGate: null as Promise<void> | null,
  initGate: null as Promise<void> | null,
  setTTSEnabled: null as unknown as (key: string, enabled: boolean) => void,
  view: { tts: { from: () => '<speak>hi</speak>' }, deselect: vi.fn() },
  viewSettings: {
    ttsLocation: '',
    ttsHighlightOptions: { style: 'highlight', color: '#ffff00' },
    isEink: false,
    ttsRate: 1,
    showTTSBar: false,
    rtl: false,
  },
}));

vi.mock('@/libs/mediaSession', () => {
  class TauriMediaSession {
    handlers: Record<string, Handler> = {};
    setActive = vi.fn(async (_s: { active: boolean }) => {});
    updateMetadata = vi.fn(async () => {});
    updatePlaybackState = vi.fn(async () => {});
    setActionHandler(action: string, handler: Handler | null) {
      if (handler) this.handlers[action] = handler;
      else delete this.handlers[action];
    }
  }
  return { TauriMediaSession, getMediaSession: () => state.session };
});

vi.mock('@/services/tts', () => {
  class TTSController extends EventTarget {
    state = 'playing';
    init = vi.fn(async () => {
      if (state.initGate) await state.initGate;
    });
    initViewTTS = vi.fn(async () => {});
    setLang = vi.fn();
    setRate = vi.fn(async () => {});
    speak = vi.fn(async () => {});
    setTargetLang = vi.fn();
    getSpeakingLang = vi.fn(() => 'en');
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    pause = vi.fn(async () => {});
    resume = vi.fn(async () => {});
    shutdown = vi.fn(async () => {});
    constructor() {
      super();
      state.controllers.push(this);
    }
  }
  return { TTSController, SILENCE_DATA: '' };
});

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: state.appService }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ isDarkMode: false }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { alwaysInForeground: false } }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({
      book: { title: 'T', author: 'A', coverImageUrl: '', format: 'EPUB', primaryLanguage: 'en' },
    }),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: '',
    getView: () => state.view,
    getProgress: () => ({ range: {}, location: '', sectionLabel: 'S' }),
    getViewSettings: () => state.viewSettings,
    setViewSettings: vi.fn(),
    setTTSEnabled: state.setTTSEnabled,
  }),
}));
vi.mock('@/store/proofreadStore', () => ({ useProofreadStore: () => ({ getMergedRules: () => [] }) }));
vi.mock('@/services/transformers/proofread', () => ({ proofreadTransformer: { transform: vi.fn() } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/hooks/useTtsStatsRecorder', () => ({ useTtsStatsRecorder: () => {} }));
vi.mock('@/utils/image', () => ({
  fetchImageAsBase64: async () => {
    if (state.imageGate) await state.imageGate;
    return 'data:image/png;base64,';
  },
}));
vi.mock('@/utils/bridge', () => ({ invokeUseBackgroundAudio: vi.fn(async () => {}) }));
vi.mock('@/utils/cfi', () => ({ isCfiInLocation: () => false }));
vi.mock('@/utils/ssml', () => ({ parseSSMLLang: () => 'en' }));
vi.mock('@/utils/misc', () => ({ getLocale: () => 'en' }));
vi.mock('@/utils/sel', () => ({ getPopupPosition: () => ({}) }));
vi.mock('@/components/Overlay', () => ({ Overlay: () => null }));
vi.mock('@/components/Popup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/tts/TTSPanel', () => ({ default: () => null }));
vi.mock('@/app/reader/components/tts/TTSIcon', () => ({ default: () => null }));
vi.mock('@/app/reader/components/tts/TTSBar', () => ({ default: () => null }));

import TTSControl from '@/app/reader/components/tts/TTSControl';
import { TauriMediaSession } from '@/libs/mediaSession';
import type { MediaSessionState } from '@/libs/mediaSession';

const KEY = 'book1-view1';
const insets = { top: 0, right: 0, bottom: 0, left: 0 };

// The mocked classes above: only the members the assertions read.
interface FakeSession {
  handlers: Record<string, Handler>;
  setActive: Mock<(s: MediaSessionState) => Promise<void>>;
}
interface FakeController extends EventTarget {
  pause: Mock<() => Promise<void>>;
  speak: Mock<(ssml: string, oneTime?: boolean) => Promise<void>>;
  shutdown: Mock<() => Promise<void>>;
}

const session = () => state.session as FakeSession;
const lastController = () => state.controllers[state.controllers.length - 1] as FakeController;
const deinitCalls = () => session().setActive.mock.calls.filter(([s]) => !s.active).length;

const speak = () => act(async () => eventDispatcher.dispatch('tts-speak', { bookKey: KEY }));
const stop = () => act(async () => eventDispatcher.dispatch('tts-stop', { bookKey: KEY }));

beforeEach(() => {
  state.session = new TauriMediaSession();
  state.controllers = [];
  state.imageGate = null;
  state.initGate = null;
  state.setTTSEnabled = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TTSControl media session lifecycle', () => {
  it('activates the session when speaking starts', async () => {
    render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    expect(session().setActive).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
    expect(deinitCalls()).toBe(0);
  });

  it('deactivates once on unmount', async () => {
    const { unmount } = render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    const controller = lastController();
    unmount();
    await act(async () => {});
    expect(controller.shutdown).toHaveBeenCalledTimes(1);
    expect(deinitCalls()).toBe(1);
  });

  it('deactivates on Close/Back (tts-stop)', async () => {
    render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    await stop();
    expect(lastController().shutdown).toHaveBeenCalledTimes(1);
    expect(deinitCalls()).toBe(1);
    expect(state.setTTSEnabled).toHaveBeenLastCalledWith(KEY, false);
  });

  it('treats a range-less tts-speak with a live controller as toggle-off', async () => {
    render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    await speak();
    expect(state.controllers).toHaveLength(1);
    expect(lastController().shutdown).toHaveBeenCalledTimes(1);
    expect(deinitCalls()).toBe(1);
  });

  it('stops on the MediaSession stop action', async () => {
    render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    await act(async () => session().handlers['stop']!());
    expect(lastController().shutdown).toHaveBeenCalledTimes(1);
    expect(lastController().pause).not.toHaveBeenCalled();
    expect(deinitCalls()).toBe(1);
  });

  it('stops at end of book', async () => {
    render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    await act(async () => {
      lastController().dispatchEvent(new CustomEvent('tts-end'));
    });
    expect(lastController().shutdown).toHaveBeenCalledTimes(1);
    expect(deinitCalls()).toBe(1);
  });

  it('keeps the session on pause', async () => {
    render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    await act(async () => session().handlers['pause']!());
    expect(lastController().pause).toHaveBeenCalledTimes(1);
    expect(lastController().shutdown).not.toHaveBeenCalled();
    expect(deinitCalls()).toBe(0);
  });

  it('is safe to stop twice and to unmount after a stop', async () => {
    const { unmount } = render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    await stop();
    await stop();
    unmount();
    await act(async () => {});
    expect(deinitCalls()).toBe(1);
  });

  it('does nothing when the session was never activated', async () => {
    const { unmount } = render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await stop();
    unmount();
    await act(async () => {});
    expect(session().setActive).not.toHaveBeenCalled();
  });

  it('is a no-op on platforms without a media session', async () => {
    state.session = null;
    const { unmount } = render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    await speak();
    await stop();
    unmount();
    await act(async () => {});
    expect(state.controllers).toHaveLength(1);
    expect(lastController().shutdown).toHaveBeenCalledTimes(1);
  });

  it('drops a start that was stopped while the artwork loaded', async () => {
    let release!: () => void;
    state.imageGate = new Promise<void>((r) => (release = r));
    render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    act(() => {
      void eventDispatcher.dispatch('tts-speak', { bookKey: KEY });
    });
    await stop();
    await act(async () => release());
    expect(state.controllers).toHaveLength(0);
    expect(session().setActive).not.toHaveBeenCalled();
    expect(state.setTTSEnabled).not.toHaveBeenCalledWith(KEY, true);
  });

  it('ends stopped after a double tap during controller init', async () => {
    let release!: () => void;
    state.initGate = new Promise<void>((r) => (release = r));
    render(<TTSControl bookKey={KEY} gridInsets={insets} />);
    act(() => {
      void eventDispatcher.dispatch('tts-speak', { bookKey: KEY });
    });
    await act(async () => {
      await vi.waitFor(() => expect(state.controllers).toHaveLength(1));
    });
    await speak();
    await act(async () => release());
    expect(state.controllers).toHaveLength(1);
    expect(lastController().speak).not.toHaveBeenCalled();
    expect(lastController().shutdown).toHaveBeenCalled();
    expect(state.setTTSEnabled).toHaveBeenLastCalledWith(KEY, false);
    expect(state.setTTSEnabled).not.toHaveBeenCalledWith(KEY, true);
    expect(deinitCalls()).toBe(1);
  });
});
