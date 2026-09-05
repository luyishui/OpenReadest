'use client';

import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useWebDavStore } from '@/store/webdavStore';
import { syncWebDavSelection } from '@/services/webdav/sync/engine';
import { computeLocalFingerprint } from '@/services/webdav/sync/fingerprint';
import { mergeWebDavConflictLists } from '@/services/webdav/sync/conflicts';
import { getLocalLibraryPath } from '@/services/webdav/sync/paths';
import { eventDispatcher } from '@/utils/event';

const shouldRun = () => {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine;
};

const WebDavAutoSyncRunner = () => {
  const { appService } = useEnv();
  const _ = useTranslation();
  const autoSyncEnabled = useWebDavStore((s) => s.autoSyncEnabled);
  const autoSyncIntervalMinutes = useWebDavStore((s) => s.autoSyncIntervalMinutes);

  useEffect(() => {
    // hydrate persisted profiles/settings so auto sync works without
    // opening the WebDAV window first
    if (!useWebDavStore.getState().hydrated) {
      useWebDavStore.getState().restore({});
    }
  }, []);

  useEffect(() => {
    if (!autoSyncEnabled) return;
    if (!appService) return;

    let disposed = false;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (disposed || !shouldRun()) return;
      const store = useWebDavStore.getState();
      if (store.isSyncing) return;
      const profile =
        store.profiles.find((p) => p.id === store.activeProfileId) ?? store.profiles[0];
      if (!profile?.serverUrl || !profile?.username) return;

      // Part 4.1：已删（deletedAt 墓碑）的书也必须纳入同步项，由引擎按条目级
      // 墓碑把删除传播到远端（删除远端书文件 + 写状态墓碑），library.json 的
      // 全量上传则把 deletedAt 写入远端索引。仅当书库完全为空时才不跑同步。
      const { library } = useLibraryStore.getState();
      if (library.length === 0) return;
      const books = library;

      // 记录同步前 library.json 指纹，用于判断同步是否改写了本地索引
      // （合并/下载墓碑），有变化时需从磁盘重载书库让墓碑在书架生效。
      let libraryFingerprintBefore: string | undefined;
      try {
        libraryFingerprintBefore = (
          await computeLocalFingerprint(appService, getLocalLibraryPath(), 'Books')
        )?.md5;
      } catch {
        libraryFingerprintBefore = undefined;
      }

      store.setLastAutoSyncAttemptAt(Date.now());
      // Part 4.5 互斥收口：手动同步可能在上方 await 期间启动（isSyncing 已
      // 置位）。重查与 setSyncing 之间不能有 await，避免双引擎并发写同一份
      // 同步状态（后者为 last-writer-wins，会产生重传抖动）。
      if (useWebDavStore.getState().isSyncing) return;
      useWebDavStore.getState().setSyncing(true);
      try {
        const { failures, conflicts } = await syncWebDavSelection(
          appService,
          profile,
          { books, includeLibrary: true },
          {
            onProgress: (p) => useWebDavStore.getState().setProgress(p),
            onLog: (l) => useWebDavStore.getState().addLog(l),
          },
          { shouldCancel: () => disposed },
        );
        // a cancelled run (unmount or effect re-run) is partial, not a success
        if (disposed) return;
        if (conflicts.length > 0) {
          // manual 冲突策略下冲突项不会自动解决：不记成功（下次仍会尝试），
          // 冲突列表并入 store 供同步窗口处理（Part 4.4），不再静默跳过。
          useWebDavStore
            .getState()
            .setConflicts(
              mergeWebDavConflictLists(useWebDavStore.getState().conflicts, conflicts),
            );
          eventDispatcher.dispatch('toast', {
            message: _('WebDAV 同步检测到 {{count}} 个冲突，请在同步窗口中处理', {
              count: conflicts.length,
            }),
            type: 'warning',
          });
        }
        if (failures.length > 0) {
          eventDispatcher.dispatch('toast', { message: _('WebDAV 自动同步失败'), type: 'warning' });
        }
        if (conflicts.length === 0 && failures.length === 0) {
          useWebDavStore.getState().setLastSuccessAt(Date.now());
          // 自动同步覆盖全库（含墓碑书）：全量扫描未检出冲突 → 清理已收敛的
          // 历史冲突条目（可能已被其他设备解决）。只清当前同步 profile 的：
          // 其他 profile 的冲突未经本轮扫描，可能仍未解决，必须保留。
          useWebDavStore
            .getState()
            .setConflicts(
              useWebDavStore.getState().conflicts.filter((c) => c.profileId !== profile.id),
            );
        }

        // 同步可能改写本地 library.json（合并或下载远端墓碑）：即使本轮存在
        // 失败/冲突，只要本地索引实际变化，也要重载书架，否则墓碑已落盘而
        // 书架仍是旧数据（review 跟进项：陈旧书架）。
        let libraryFingerprintAfter: string | undefined;
        try {
          libraryFingerprintAfter = (
            await computeLocalFingerprint(appService, getLocalLibraryPath(), 'Books')
          )?.md5;
        } catch {
          libraryFingerprintAfter = undefined;
        }
        if (libraryFingerprintBefore !== libraryFingerprintAfter) {
          const refreshed = await appService.loadLibraryBooks();
          useLibraryStore.getState().setLibrary(refreshed);
        }
      } catch {
        if (!disposed) {
          eventDispatcher.dispatch('toast', {
            message: _('WebDAV 自动同步失败'),
            type: 'warning',
          });
        }
      } finally {
        useWebDavStore.getState().setSyncing(false);
      }
    };

    const ms = Math.max(5, autoSyncIntervalMinutes) * 60 * 1000;
    // honor the interval across remounts and app restarts instead of
    // syncing immediately every time this effect re-runs
    const { lastSuccessAt, lastAutoSyncAttemptAt } = useWebDavStore.getState();
    const lastRunAt = Math.max(lastSuccessAt ?? 0, lastAutoSyncAttemptAt);
    // clamp to [0, ms] so a lastRunAt in the future (clock changes) cannot stall syncing
    const initialDelay = Math.min(ms, Math.max(0, ms - (Date.now() - lastRunAt)));
    const timeoutHandle = setTimeout(() => {
      tick();
      intervalHandle = setInterval(() => tick(), ms);
    }, initialDelay);

    return () => {
      disposed = true;
      clearTimeout(timeoutHandle);
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, [autoSyncEnabled, autoSyncIntervalMinutes, appService, _]);

  return null;
};

export default WebDavAutoSyncRunner;
