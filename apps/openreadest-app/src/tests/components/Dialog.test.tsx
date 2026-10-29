import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import Dialog from '@/components/Dialog';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ systemUIVisible: false, statusBarHeight: 0, safeAreaInsets: null }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { onSync: vi.fn(), offSync: vi.fn() } }));
vi.mock('@/utils/rtl', () => ({ getDirFromUILanguage: () => 'ltr' }));

const TOKEN_KEY = '__dialogToken';
const originalWidth = window.innerWidth;

const currentToken = (): string | undefined =>
  (window.history.state as Record<string, string> | null)?.[TOKEN_KEY];

const flushTasks = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const renderDialog = (onClose: () => void, strict: boolean) => {
  const dialog = (
    <Dialog id='sheet' isOpen onClose={onClose}>
      <p>sheet body</p>
    </Dialog>
  );
  return render(strict ? <React.StrictMode>{dialog}</React.StrictMode> : dialog);
};

beforeEach(() => {
  // Mobile viewport: the history-token effect only runs on mobile.
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true, writable: true });
  window.history.replaceState(null, '');
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', {
    value: originalWidth,
    configurable: true,
    writable: true,
  });
});

describe('Dialog history token', () => {
  it('stays open under React.StrictMode and pushes a single history entry', async () => {
    const onClose = vi.fn();
    const lengthBefore = window.history.length;
    renderDialog(onClose, true);
    await flushTasks();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('sheet body')).toBeTruthy();
    expect(currentToken()?.startsWith('sheet:')).toBe(true);
    expect(window.history.length).toBe(lengthBefore + 1);
  });

  it('still closes on the back button under React.StrictMode', async () => {
    const onClose = vi.fn();
    renderDialog(onClose, true);
    await flushTasks();
    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on the back button without StrictMode', async () => {
    const onClose = vi.fn();
    renderDialog(onClose, false);
    expect(currentToken()?.startsWith('sheet:')).toBe(true);
    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('pops its own entry when closed from the close button', async () => {
    const onClose = vi.fn();
    renderDialog(onClose, false);
    fireEvent.click(screen.getAllByLabelText('Close')[0]!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(currentToken()).toBeUndefined();
  });

  it('releases its history entry when unmounted while open', async () => {
    const onClose = vi.fn();
    const { unmount } = renderDialog(onClose, false);
    expect(currentToken()).toBeDefined();
    unmount();
    await waitFor(() => expect(currentToken()).toBeUndefined());
    expect(onClose).not.toHaveBeenCalled();
  });
});
