import { create } from 'zustand';
import { WebDavConflictItem, WebDavProfile, WebDavSyncLogItem, WebDavSyncProgress } from '@/services/webdav/models';
import { getUniqueWebDavProfileName, isValidWebDavProfileName, normalizeWebDavProfileName } from '@/services/webdav/profileName';

type WebDavTab = 'upload' | 'download' | 'logs' | 'profiles' | 'conflicts';

interface WebDavState {
  isWebDavCenterOpen: boolean;
  activeTab: WebDavTab;

  profiles: WebDavProfile[];
  activeProfileId: string | null;

  hydrated: boolean;
  isSyncing: boolean;
  isPaused: boolean;
  progress: WebDavSyncProgress | null;
  lastSuccessAt: number | null;
  lastAutoSyncAttemptAt: number;
  logs: WebDavSyncLogItem[];
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  /**
   * 最近一次同步检测到、尚未解决的冲突（Part 4.4）。不持久化：同步状态
   * 未收敛前，下一轮同步会重新检出这些冲突。
   */
  conflicts: WebDavConflictItem[];

  setWebDavCenterOpen: (open: boolean) => void;
  setActiveTab: (tab: WebDavTab) => void;

  setProfiles: (profiles: WebDavProfile[]) => void;
  upsertProfile: (profile: WebDavProfile) => void;
  deleteProfile: (id: string) => void;
  setActiveProfileId: (id: string | null) => void;

  setSyncing: (syncing: boolean) => void;
  setPaused: (paused: boolean) => void;
  setProgress: (progress: WebDavSyncProgress | null) => void;
  setLastSuccessAt: (ts: number | null) => void;
  setLastAutoSyncAttemptAt: (ts: number) => void;
  addLog: (log: WebDavSyncLogItem) => void;
  clearLogs: () => void;
  setAutoSyncEnabled: (enabled: boolean) => void;
  setAutoSyncIntervalMinutes: (minutes: number) => void;
  setConflicts: (conflicts: WebDavConflictItem[]) => void;
  /** 仅移除指定 profile 的冲突：store 可同时持有多个 profile 的同路径条目 */
  removeConflict: (profileId: string, path: string) => void;
  restore: (data: { profiles?: WebDavProfile[]; activeProfileId?: string | null; logs?: WebDavSyncLogItem[] }) => void;
}

const PROFILES_KEY = 'readest_webdav_profiles_v1';
const ACTIVE_PROFILE_KEY = 'readest_webdav_active_profile_v1';
const LOGS_KEY = 'readest_webdav_logs_v1';
const AUTO_SYNC_KEY = 'readest_webdav_auto_sync_v1';
const LAST_SUCCESS_KEY = 'readest_webdav_last_success_v1';

const sanitizeProfiles = (profiles: WebDavProfile[]) => {
  const usedNames: string[] = [];
  return profiles.map((p) => {
    const normalized = normalizeWebDavProfileName(p.name || '');
    const name =
      normalized && isValidWebDavProfileName(normalized) && !usedNames.includes(normalized)
        ? normalized
        : getUniqueWebDavProfileName('WebDAV', usedNames);
    usedNames.push(name);
    return {
      ...p,
      id: p.id,
      name,
      serverUrl: p.serverUrl ?? '',
      remotePath: p.remotePath ?? '',
      username: p.username ?? '',
      password: p.password ?? '',
      conflictStrategy: p.conflictStrategy || 'manual',
      lastSyncAt: p.lastSyncAt ?? undefined,
    };
  });
};

const loadFromStorage = (): {
  profiles: WebDavProfile[];
  activeProfileId: string | null;
  logs: WebDavSyncLogItem[];
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  lastSuccessAt: number | null;
} => {
  try {
    const profiles = sanitizeProfiles(JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]') as WebDavProfile[]);
    const activeProfileId = (localStorage.getItem(ACTIVE_PROFILE_KEY) || null) as string | null;
    const logs = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]') as WebDavSyncLogItem[];
    const auto = JSON.parse(localStorage.getItem(AUTO_SYNC_KEY) || '{}') as {
      enabled?: boolean;
      intervalMinutes?: number;
    };
    return {
      profiles,
      activeProfileId,
      logs,
      autoSyncEnabled: !!auto.enabled,
      autoSyncIntervalMinutes: auto.intervalMinutes ?? 15,
      lastSuccessAt: Number(localStorage.getItem(LAST_SUCCESS_KEY)) || null,
    };
  } catch {
    return { profiles: [], activeProfileId: null, logs: [], autoSyncEnabled: false, autoSyncIntervalMinutes: 15, lastSuccessAt: null };
  }
};

const persistProfiles = (profiles: WebDavProfile[]) => {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
};

const persistActiveProfileId = (id: string | null) => {
  if (id) localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  else localStorage.removeItem(ACTIVE_PROFILE_KEY);
};

const persistLogs = (logs: WebDavSyncLogItem[]) => {
  localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(0, 500)));
};

export const useWebDavStore = create<WebDavState>((set, get) => ({
  isWebDavCenterOpen: false,
  activeTab: 'upload',
  profiles: [],
  activeProfileId: null,

  hydrated: false,
  isSyncing: false,
  isPaused: false,
  progress: null,
  lastSuccessAt: null,
  lastAutoSyncAttemptAt: 0,
  logs: [],
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 15,
  conflicts: [],

  setWebDavCenterOpen: (open) => set({ isWebDavCenterOpen: open }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  setProfiles: (profiles) => {
    const next = sanitizeProfiles(profiles);
    set({ profiles: next });
    persistProfiles(next);
  },
  upsertProfile: (profile) => {
    const { profiles } = get();
    const next = profiles.some((p) => p.id === profile.id)
      ? profiles.map((p) => (p.id === profile.id ? profile : p))
      : [profile, ...profiles];
    set({ profiles: next, activeProfileId: profile.id });
    persistProfiles(next);
    persistActiveProfileId(profile.id);
  },
  deleteProfile: (id) => {
    const { profiles, activeProfileId } = get();
    const next = profiles.filter((p) => p.id !== id);
    const nextActive = activeProfileId === id ? (next[0]?.id ?? null) : activeProfileId;
    set({ profiles: next, activeProfileId: nextActive });
    persistProfiles(next);
    persistActiveProfileId(nextActive);
  },
  setActiveProfileId: (id) => {
    set({ activeProfileId: id });
    persistActiveProfileId(id);
  },

  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setPaused: (paused) => set({ isPaused: paused }),
  setProgress: (progress) => set({ progress }),
  setLastSuccessAt: (ts) => {
    set({ lastSuccessAt: ts });
    if (ts) localStorage.setItem(LAST_SUCCESS_KEY, String(ts));
    else localStorage.removeItem(LAST_SUCCESS_KEY);
  },
  setLastAutoSyncAttemptAt: (ts) => set({ lastAutoSyncAttemptAt: ts }),
  addLog: (log) => {
    const next = [log, ...get().logs].slice(0, 500);
    set({ logs: next });
    persistLogs(next);
  },
  clearLogs: () => {
    set({ logs: [] });
    persistLogs([]);
  },
  setAutoSyncEnabled: (enabled) => {
    const { autoSyncIntervalMinutes } = get();
    set({ autoSyncEnabled: enabled });
    localStorage.setItem(
      AUTO_SYNC_KEY,
      JSON.stringify({ enabled, intervalMinutes: autoSyncIntervalMinutes }),
    );
  },
  setAutoSyncIntervalMinutes: (minutes) => {
    const intervalMinutes = Math.max(5, Math.min(24 * 60, Math.round(minutes)));
    const { autoSyncEnabled } = get();
    set({ autoSyncIntervalMinutes: intervalMinutes });
    localStorage.setItem(AUTO_SYNC_KEY, JSON.stringify({ enabled: autoSyncEnabled, intervalMinutes }));
  },
  setConflicts: (conflicts) => set({ conflicts }),
  removeConflict: (profileId, path) => {
    set({
      conflicts: get().conflicts.filter((c) => !(c.profileId === profileId && c.path === path)),
    });
  },
  restore: (data) => {
    const loaded = loadFromStorage();
    set({
      hydrated: true,
      profiles: data.profiles ? sanitizeProfiles(data.profiles) : loaded.profiles,
      activeProfileId: data.activeProfileId ?? loaded.activeProfileId,
      logs: data.logs ?? loaded.logs,
      autoSyncEnabled: loaded.autoSyncEnabled,
      autoSyncIntervalMinutes: loaded.autoSyncIntervalMinutes,
      lastSuccessAt: loaded.lastSuccessAt,
    });
  },
}));

export const loadWebDavStoreFromStorage = () => loadFromStorage();
