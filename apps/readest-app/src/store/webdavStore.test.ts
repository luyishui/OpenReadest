import { beforeEach, describe, expect, it } from 'vitest';
import { loadWebDavStoreFromStorage, useWebDavStore } from './webdavStore';

const PROFILES_KEY = 'readest_webdav_profiles_v1';
const ACTIVE_PROFILE_KEY = 'readest_webdav_active_profile_v1';
const AUTO_SYNC_KEY = 'readest_webdav_auto_sync_v1';
const LOGS_KEY = 'readest_webdav_logs_v1';

const makeProfile = (id: string, name: string) => ({
  id,
  name,
  serverUrl: 'https://dav.example.com:443',
  remotePath: '/remote',
  username: 'u',
  password: 'p',
  allowInsecureHttp: false,
  allowInsecureTls: false,
  conflictStrategy: 'manual' as const,
});

beforeEach(() => {
  localStorage.clear();
  const s = useWebDavStore.getState();
  s.setProfiles([]);
  s.setActiveProfileId(null);
  s.clearLogs();
  s.setActiveTab('upload');
});

describe('webdavStore', () => {
  it('upsertProfile persists profiles and activeProfileId', () => {
    const s = useWebDavStore.getState();
    const p1 = makeProfile('p1', 'WebDAV');
    s.upsertProfile(p1);

    expect(useWebDavStore.getState().activeProfileId).toBe('p1');
    const storedProfiles = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]') as Array<{ id: string; name: string }>;
    expect(storedProfiles.map((p) => p.id)).toEqual(['p1']);
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('p1');
  });

  it('deleteProfile updates activeProfileId when deleting active', () => {
    const s = useWebDavStore.getState();
    s.upsertProfile(makeProfile('p1', 'WebDAV'));
    s.upsertProfile(makeProfile('p2', 'WebDAV_1'));

    expect(useWebDavStore.getState().activeProfileId).toBe('p2');
    s.deleteProfile('p2');
    expect(useWebDavStore.getState().activeProfileId).toBe('p1');
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('p1');
  });

  it('upsertProfile updates existing profile', () => {
    const s = useWebDavStore.getState();
    s.upsertProfile(makeProfile('p1', 'WebDAV'));
    s.upsertProfile({ ...makeProfile('p1', 'WebDAV'), serverUrl: 'https://changed.example.com' });
    const state = useWebDavStore.getState();
    expect(state.profiles.length).toBe(1);
    expect(state.profiles[0]?.serverUrl).toBe('https://changed.example.com');
  });

  it('deleteProfile keeps activeProfileId when deleting non-active', () => {
    const s = useWebDavStore.getState();
    s.upsertProfile(makeProfile('p1', 'WebDAV'));
    s.upsertProfile(makeProfile('p2', 'WebDAV_1'));
    s.setActiveProfileId('p1');
    s.deleteProfile('p2');
    expect(useWebDavStore.getState().activeProfileId).toBe('p1');
  });

  it('sanitizes invalid/duplicate names on load', () => {
    const raw = [makeProfile('p1', 'WebDAV'), makeProfile('p2', 'WebDAV'), makeProfile('p3', 'bad name')];
    localStorage.setItem(PROFILES_KEY, JSON.stringify(raw));
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p1');

    const loaded = loadWebDavStoreFromStorage();
    const names = loaded.profiles.map((p) => p.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => /^[\u4e00-\u9fffA-Za-z0-9_]{1,32}$/.test(n))).toBe(true);
  });

  it('setActiveProfileId persists and removes key when null', () => {
    const s = useWebDavStore.getState();
    s.setActiveProfileId('p1');
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('p1');
    s.setActiveProfileId(null);
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe(null);
  });

  it('setProfiles sanitizes and persists', () => {
    const s = useWebDavStore.getState();
    s.setProfiles([makeProfile('p1', 'bad name'), makeProfile('p2', 'bad name')]);
    const stored = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]') as Array<{ name: string }>;
    expect(stored.length).toBe(2);
    expect(new Set(stored.map((p) => p.name)).size).toBe(2);
  });

  it('stores autoSync settings with clamped interval', () => {
    const s = useWebDavStore.getState();
    s.setAutoSyncIntervalMinutes(1);
    s.setAutoSyncEnabled(true);
    const saved1 = JSON.parse(localStorage.getItem(AUTO_SYNC_KEY) || '{}') as { enabled: boolean; intervalMinutes: number };
    expect(saved1.enabled).toBe(true);
    expect(saved1.intervalMinutes).toBe(5);

    s.setAutoSyncIntervalMinutes(20000);
    const saved2 = JSON.parse(localStorage.getItem(AUTO_SYNC_KEY) || '{}') as { intervalMinutes: number };
    expect(saved2.intervalMinutes).toBe(1440);
  });

  it('stores logs and supports clear', () => {
    const s = useWebDavStore.getState();
    s.addLog({ id: 'l1', timestamp: 1, direction: 'upload', path: '/a', status: 'completed' });
    const storedLogs = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]') as Array<{ id: string }>;
    expect(storedLogs.map((l) => l.id)).toEqual(['l1']);
    s.clearLogs();
    const storedLogs2 = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]') as Array<{ id: string }>;
    expect(storedLogs2.length).toBe(0);
  });

  it('loadFromStorage falls back on parse error', () => {
    localStorage.setItem(PROFILES_KEY, '{bad json');
    const loaded = loadWebDavStoreFromStorage();
    expect(loaded.profiles).toEqual([]);
  });

  it('restore can override profiles and logs', () => {
    localStorage.setItem(AUTO_SYNC_KEY, JSON.stringify({ enabled: true, intervalMinutes: 10 }));
    const s = useWebDavStore.getState();
    s.restore({
      profiles: [makeProfile('p1', 'WebDAV')],
      activeProfileId: 'p1',
      logs: [{ id: 'l1', timestamp: 1, direction: 'download', path: '/b', status: 'completed' }],
    });
    expect(useWebDavStore.getState().profiles.length).toBe(1);
    expect(useWebDavStore.getState().activeProfileId).toBe('p1');
    expect(useWebDavStore.getState().logs[0]?.id).toBe('l1');
    expect(useWebDavStore.getState().autoSyncEnabled).toBe(true);
    expect(useWebDavStore.getState().autoSyncIntervalMinutes).toBe(10);
  });

  it('restore uses loaded profiles when profiles not provided', () => {
    localStorage.setItem(PROFILES_KEY, JSON.stringify([makeProfile('p1', 'WebDAV')]));
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p1');
    const s = useWebDavStore.getState();
    s.restore({});
    expect(useWebDavStore.getState().activeProfileId).toBe('p1');
    expect(useWebDavStore.getState().profiles.length).toBe(1);
  });

  it('covers basic state setters', () => {
    const s = useWebDavStore.getState();
    s.setWebDavCenterOpen(true);
    s.setSyncing(true);
    s.setPaused(true);
    s.setProgress({ totalItems: 10, completedItems: 1 });
    s.setLastSuccessAt(123);
    expect(useWebDavStore.getState().isWebDavCenterOpen).toBe(true);
    expect(useWebDavStore.getState().isSyncing).toBe(true);
    expect(useWebDavStore.getState().isPaused).toBe(true);
    expect(useWebDavStore.getState().progress?.totalItems).toBe(10);
    expect(useWebDavStore.getState().lastSuccessAt).toBe(123);
  });
});
