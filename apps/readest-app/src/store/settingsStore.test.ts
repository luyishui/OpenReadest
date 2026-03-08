import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_UI_LANGUAGE_KEY } from '@/utils/lang';

const { changeLanguage, initDayjs } = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  initDayjs: vi.fn(),
}));

vi.mock('@/i18n/i18n', () => ({
  default: {
    changeLanguage,
  },
}));

vi.mock('@/utils/time', () => ({
  initDayjs,
}));

import { useSettingsStore } from './settingsStore';

describe('useSettingsStore.applyUILanguage', () => {
  beforeEach(() => {
    changeLanguage.mockReset();
    initDayjs.mockReset();
    localStorage.clear();
    Object.defineProperty(window.navigator, 'language', {
      value: 'zh-Hans-CN',
      configurable: true,
    });
  });

  it('uses the system language when no explicit UI language is stored', () => {
    localStorage.setItem('i18nextLng', 'en');

    useSettingsStore.getState().applyUILanguage(undefined);

    expect(localStorage.getItem('i18nextLng')).toBeNull();
    expect(changeLanguage).toHaveBeenCalledWith('zh-CN');
    expect(initDayjs).toHaveBeenCalledWith('zh-CN');
  });

  it('prefers the cached native system language over the WebView locale', () => {
    Object.defineProperty(window.navigator, 'language', {
      value: 'en-US',
      configurable: true,
    });
    localStorage.setItem(SYSTEM_UI_LANGUAGE_KEY, 'zh-CN');

    useSettingsStore.getState().applyUILanguage(undefined);

    expect(localStorage.getItem('i18nextLng')).toBeNull();
    expect(changeLanguage).toHaveBeenCalledWith('zh-CN');
    expect(initDayjs).toHaveBeenCalledWith('zh-CN');
  });

  it('normalizes traditional Chinese locale variants to the supported app locale', () => {
    useSettingsStore.getState().applyUILanguage('zh-Hant-HK');

    expect(localStorage.getItem('i18nextLng')).toBe('zh-TW');
    expect(changeLanguage).toHaveBeenCalledWith('zh-TW');
    expect(initDayjs).toHaveBeenCalledWith('zh-TW');
  });

  it('persists the explicit UI language when the user selects one', () => {
    useSettingsStore.getState().applyUILanguage('fr');

    expect(localStorage.getItem('i18nextLng')).toBe('fr');
    expect(changeLanguage).toHaveBeenCalledWith('fr');
    expect(initDayjs).toHaveBeenCalledWith('fr');
  });
});