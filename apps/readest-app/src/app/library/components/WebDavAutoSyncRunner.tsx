'use client';

import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useWebDavStore } from '@/store/webdavStore';
import { syncWebDavSelection } from '@/services/webdav/sync/engine';
import { eventDispatcher } from '@/utils/event';

const shouldRun = () => {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine;
};

const WebDavAutoSyncRunner = () => {
  const { appService } = useEnv();
  const getVisibleLibrary = useLibraryStore((s) => s.getVisibleLibrary);
  const { autoSyncEnabled, autoSyncIntervalMinutes, isSyncing, profiles, activeProfileId, addLog, setProgress, setLastSuccessAt, setSyncing } =
    useWebDavStore();

  useEffect(() => {
    if (!autoSyncEnabled) return;
    if (!appService) return;

    const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
    if (!profile?.serverUrl || !profile?.username) return;

    let disposed = false;

    const tick = async () => {
      if (disposed) return;
      if (!shouldRun()) return;
      if (useWebDavStore.getState().isSyncing) return;
      const books = getVisibleLibrary();
      if (books.length === 0) return;

      setSyncing(true);
      try {
        await syncWebDavSelection(
          appService,
          profile,
          { books, includeLibrary: true },
          {
            onProgress: (p) => setProgress(p),
            onLog: (l) => addLog(l),
          },
        );
        setLastSuccessAt(Date.now());
      } catch {
        eventDispatcher.dispatch('toast', { message: 'WebDAV 自动同步失败', type: 'warning' });
      } finally {
        setSyncing(false);
      }
    };

    const ms = Math.max(5, autoSyncIntervalMinutes) * 60 * 1000;
    const handle = setInterval(() => tick(), ms);
    tick();
    return () => {
      disposed = true;
      clearInterval(handle);
    };
  }, [
    autoSyncEnabled,
    autoSyncIntervalMinutes,
    appService,
    profiles,
    activeProfileId,
    addLog,
    getVisibleLibrary,
    setProgress,
    setLastSuccessAt,
    setSyncing,
    isSyncing,
  ]);

  return null;
};

export default WebDavAutoSyncRunner;

