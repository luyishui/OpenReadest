import { describe, it, expect, vi, beforeEach } from 'vitest';

const core = vi.hoisted(() => ({
  invoke: vi.fn(
    async (_cmd: string, _args?: { payload?: { active?: boolean } }): Promise<unknown> => undefined,
  ),
  listenerGate: null as Promise<void> | null,
  registered: 0,
  unregistered: 0,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: core.invoke,
  addPluginListener: vi.fn(async () => {
    if (core.listenerGate) await core.listenerGate;
    core.registered++;
    return {
      unregister: vi.fn(async () => {
        core.unregistered++;
      }),
    };
  }),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => 'android' }));

import { TauriMediaSession } from '@/libs/mediaSession';

const activeCalls = () =>
  core.invoke.mock.calls
    .filter(([cmd]) => cmd === 'plugin:native-tts|set_media_session_active')
    .map(([, args]) => args?.payload?.active);

beforeEach(() => {
  core.invoke.mockClear();
  core.listenerGate = null;
  core.registered = 0;
  core.unregistered = 0;
});

describe('TauriMediaSession.setActive', () => {
  it('a stop issued while activation registers listeners ends inactive, nothing leaked', async () => {
    let release!: () => void;
    core.listenerGate = new Promise<void>((r) => (release = r));
    const session = new TauriMediaSession();
    const on = session.setActive({ active: true });
    const off = session.setActive({ active: false });
    release();
    await Promise.all([on, off]);
    expect(activeCalls()).toEqual([true, false]);
    expect(core.registered).toBeGreaterThan(0);
    expect(core.unregistered).toBe(core.registered);
  });

  it('keeps serializing after a failed call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    core.invoke.mockRejectedValueOnce(new Error('boom'));
    const session = new TauriMediaSession();
    await session.setActive({ active: true });
    await session.setActive({ active: false });
    expect(activeCalls()).toEqual([true, false]);
  });
});
