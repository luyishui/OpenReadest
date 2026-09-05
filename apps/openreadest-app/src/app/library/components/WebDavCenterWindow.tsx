'use client';

import clsx from 'clsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  MdClose,
  MdCloudUpload,
  MdCloudDownload,
  MdPlayArrow,
  MdPause,
  MdDelete,
} from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useWebDavStore, loadWebDavStoreFromStorage } from '@/store/webdavStore';
import Dialog from '@/components/Dialog';
import { eventDispatcher } from '@/utils/event';
import { WebDavClient } from '@/services/webdav/client/WebDavClient';
import { requireWebDavSuccess } from '@/services/webdav/response';
import { resolveWebDavConflicts, syncWebDavSelection } from '@/services/webdav/sync/engine';
import { computeLocalFingerprint } from '@/services/webdav/sync/fingerprint';
import {
  mergeWebDavConflictLists,
  summarizeJsonDiff,
  WebDavJsonDiffSummary,
} from '@/services/webdav/sync/conflicts';
import {
  READEST_WEBDAV_BOOKS_DIR,
  READEST_WEBDAV_ROOT_DIRNAME,
  READEST_WEBDAV_SYSTEM_DIR,
  getLocalLibraryPath,
  getRemoteLibraryPath,
} from '@/services/webdav/sync/paths';
import { stripDeviceLocalFieldsFromJsonText } from '@/services/webdav/sync/deviceFields';
import {
  WebDavConflictItem,
  WebDavConflictResolutionStrategy,
  WebDavProfile,
} from '@/services/webdav/models';
import {
  getUniqueWebDavProfileName,
  validateWebDavProfileName,
} from '@/services/webdav/profileName';
import { Book, BookFormat } from '@/types/book';
import { EXTS } from '@/libs/document';

export const setWebDavCenterVisible = (visible: boolean) => {
  const dialog = document.getElementById('webdav_center');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', { detail: { visible } });
    dialog.dispatchEvent(event);
  }
};

const formatDateTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const formatBytes = (size: number) => {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const defaultProfile = (): WebDavProfile => ({
  id: uuidv4(),
  name: 'WebDAV',
  serverUrl: '',
  remotePath: '',
  username: '',
  password: '',
  allowInsecureHttp: false,
  allowInsecureTls: false,
  conflictStrategy: 'manual',
});

export const WebDavCenterWindow = () => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const getVisibleLibrary = useLibraryStore((s) => s.getVisibleLibrary);
  const updateBooks = useLibraryStore((s) => s.updateBooks);
  const library = getVisibleLibrary();

  const {
    profiles,
    activeProfileId,
    isSyncing,
    isPaused,
    progress,
    lastSuccessAt,
    logs,
    conflicts,
    activeTab,
    setWebDavCenterOpen,
    setActiveTab,
    restore,
    setActiveProfileId,
    upsertProfile,
    deleteProfile,
    setSyncing,
    setPaused,
    setProgress,
    setLastSuccessAt,
    addLog,
    clearLogs,
    setConflicts,
    removeConflict,
    autoSyncEnabled,
    autoSyncIntervalMinutes,
    setAutoSyncEnabled,
    setAutoSyncIntervalMinutes,
  } = useWebDavStore();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<WebDavProfile>(() => defaultProfile());
  const [selectedUploadHashes, setSelectedUploadHashes] = useState<Set<string>>(new Set());
  const [selectedDownloadHashes, setSelectedDownloadHashes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteBooks, setRemoteBooks] = useState<
    Array<{ hash: string; title: string; sourceTitle?: string; format?: BookFormat }>
  >([]);
  const [remoteCountInfo, setRemoteCountInfo] = useState<{
    dirCount: number;
    libraryCount: number;
  } | null>(null);
  const resumeResolverRef = useRef<(() => void) | null>(null);
  const cancelRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  // Part 4.4：正在解决的冲突条目与已加载的差异摘要（path → null 表示已
  // 尝试但不可预览，如二进制文件）
  const [resolvingPaths, setResolvingPaths] = useState<Set<string>>(new Set());
  const [conflictDetails, setConflictDetails] = useState<Record<string, WebDavJsonDiffSummary | null>>({});

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      const visible = event.detail?.visible === true;
      if (!visible) {
        // 外部事件关闭窗口同样取消进行中的同步（与 onClose 一致）
        cancelRef.current = true;
        useWebDavStore.getState().setPaused(false);
        if (resumeResolverRef.current) {
          resumeResolverRef.current();
          resumeResolverRef.current = null;
        }
      }
      setIsOpen(visible);
      setWebDavCenterOpen(visible);
    };
    const el = document.getElementById('webdav_center');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }
    return () => {
      if (el) el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setWebDavCenterOpen]);

  useEffect(() => {
    if (!isOpen) return;
    restore(loadWebDavStoreFromStorage());
  }, [isOpen, restore]);

  useEffect(() => {
    if (!isOpen) return;
    const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
    if (active) {
      setActiveProfileId(active.id);
      setEditing(active);
    } else {
      setEditing(defaultProfile());
    }
  }, [isOpen, profiles, activeProfileId, setActiveProfileId]);

  useEffect(() => {
    if (!isPaused && resumeResolverRef.current) {
      resumeResolverRef.current();
      resumeResolverRef.current = null;
    }
  }, [isPaused]);

  // 取消进行中的同步：标记取消 + 解除暂停 + 恢复被暂停挂起的引擎循环，
  // 让引擎尽快退出。否则暂停中的同步会永远挂起，store.isSyncing 卡在
  // true，自动同步被 `if (store.isSyncing) return` 永久阻塞。
  const cancelSync = () => {
    cancelRef.current = true;
    useWebDavStore.getState().setPaused(false);
    if (resumeResolverRef.current) {
      resumeResolverRef.current();
      resumeResolverRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      // 组件卸载（离开书架页）时同样取消
      cancelSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) ?? null;
  }, [profiles, activeProfileId]);

  // 冲突页只展示当前 profile 的冲突：resolve/查看差异用当前 profile 的
  // 服务器与凭据，跨 profile 条目会写错远端目标。其他 profile 的冲突保留
  // 在 store（切回该 profile 时可见），不在这里展示；无 profileId 的历史
  // 条目按不匹配隐藏。
  const visibleConflicts = useMemo(
    () => conflicts.filter((c) => c.profileId === activeProfileId),
    [conflicts, activeProfileId],
  );

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const filteredLocalBooks = useMemo(() => {
    if (!normalizedQuery) return library;
    return library.filter((b) => {
      const haystack =
        `${b.title} ${b.sourceTitle || ''} ${b.author || ''} ${b.format} ${b.hash}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [library, normalizedQuery]);

  const filteredRemoteBooks = useMemo(() => {
    if (!normalizedQuery) return remoteBooks;
    return remoteBooks.filter((b) => {
      const haystack =
        `${b.title} ${b.sourceTitle || ''} ${b.format || ''} ${b.hash}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [remoteBooks, normalizedQuery]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    eventDispatcher.dispatch('toast', { message, type });
  };

  const buildValidatedProfile = () => {
    const idToName = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
    const usedNames = profiles.map((p) => p.name);
    const id = editing.id || uuidv4();
    const check = validateWebDavProfileName(
      editing.name || '',
      usedNames,
      editing.id || null,
      idToName,
    );
    if (!check.ok) {
      showToast(_(check.error), 'error');
      return null;
    }
    return {
      ...editing,
      id,
      name: check.name,
      conflictStrategy: editing.conflictStrategy || 'manual',
    } as WebDavProfile;
  };

  const saveProfile = () => {
    const next = buildValidatedProfile();
    if (!next) return;
    upsertProfile(next);
    setEditing(next);
    showToast(_('配置已保存'), 'success');
  };

  const createProfile = () => {
    const name = getUniqueWebDavProfileName(
      'WebDAV',
      profiles.map((p) => p.name),
    );
    const p = { ...defaultProfile(), name };
    upsertProfile(p);
    setEditing(p);
    nameInputRef.current?.focus();
  };

  const removeProfile = () => {
    if (!selectedProfile) return;
    deleteProfile(selectedProfile.id);
    showToast(_('配置已删除'), 'success');
  };

  const testConnection = async () => {
    try {
      const profile = buildValidatedProfile();
      if (!profile) return;
      const client = new WebDavClient({
        serverUrl: profile.serverUrl,
        rootPath: profile.remotePath,
        username: profile.username,
        password: profile.password,
        allowInsecureHttp: profile.allowInsecureHttp,
        allowInsecureTls: profile.allowInsecureTls,
      });
      const result = await client.propfind('/', { depth: '0' });
      if (!result.ok) {
        showToast(_('连接失败'), 'error');
        return;
      }
      showToast(_('连接成功'), 'success');
      await loadRemoteBooks(client);
    } catch {
      showToast(_('连接失败'), 'error');
    }
  };

  const loadRemoteBooks = async (clientOverride?: WebDavClient) => {
    const profile = {
      ...editing,
      serverUrl: editing.serverUrl,
      remotePath: editing.remotePath,
    };
    if (!profile.serverUrl || !profile.username) {
      setRemoteBooks([]);
      setRemoteCountInfo(null);
      return;
    }

    const client =
      clientOverride ??
      new WebDavClient({
        serverUrl: profile.serverUrl,
        rootPath: profile.remotePath,
        username: profile.username,
        password: profile.password,
        allowInsecureHttp: profile.allowInsecureHttp,
        allowInsecureTls: profile.allowInsecureTls,
      });

    const dirsRes = await client.propfind(`/${READEST_WEBDAV_BOOKS_DIR}/`, { depth: '1' });
    if (!dirsRes.ok || !dirsRes.data) {
      setRemoteBooks([]);
      setRemoteCountInfo(null);
      addLog({
        id: uuidv4(),
        timestamp: Date.now(),
        direction: 'download',
        path: `${READEST_WEBDAV_BOOKS_DIR}/`,
        status: 'failed',
        message: dirsRes.error || `状态码：${dirsRes.status}`,
      });
      return;
    }

    const dirHashes = new Set(
      dirsRes.data
        .filter((r) => r.isCollection)
        .map((r) => r.path.split('/').filter(Boolean).pop())
        .filter((x): x is string => !!x && x !== 'Books' && x !== READEST_WEBDAV_ROOT_DIRNAME),
    );

    let libraryBooks: Array<Pick<Book, 'hash' | 'title' | 'sourceTitle' | 'format'>> = [];
    const libraryRes = await client.get(`/${getRemoteLibraryPath()}`);
    if (libraryRes.ok && libraryRes.data) {
      const text = new TextDecoder().decode(libraryRes.data);
      const parsed = JSON.parse(text) as Array<Book>;
      libraryBooks = (parsed || []).map((b) => ({
        hash: b.hash,
        title: b.title,
        sourceTitle: b.sourceTitle,
        format: b.format,
      }));
    } else {
      addLog({
        id: uuidv4(),
        timestamp: Date.now(),
        direction: 'download',
        path: getRemoteLibraryPath(),
        status: 'failed',
        message:
          libraryRes.error || (libraryRes.status ? `状态码：${libraryRes.status}` : '读取失败'),
      });
    }

    const byHash = new Map(libraryBooks.map((b) => [b.hash, b]));
    const merged = Array.from(dirHashes)
      .map((hash) => {
        const meta = byHash.get(hash);
        return {
          hash,
          title: meta?.title || hash,
          sourceTitle: meta?.sourceTitle,
          format: meta?.format,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));

    setRemoteBooks(merged);
    setRemoteCountInfo({ dirCount: dirHashes.size, libraryCount: libraryBooks.length });
  };

  const ensureRemoteRootDirs = async (client: WebDavClient) => {
    await client.mkcol(`/${READEST_WEBDAV_ROOT_DIRNAME}`);
    await client.mkcol(`/${READEST_WEBDAV_BOOKS_DIR}`);
    await client.mkcol(`/${READEST_WEBDAV_SYSTEM_DIR}`);
  };

  const upsertRemoteLibraryIndex = async (client: WebDavClient, booksToUpsert: Book[]) => {
    await ensureRemoteRootDirs(client);
    const res = await client.get(`/${getRemoteLibraryPath()}`);
    let remote: Book[] = [];
    if (res.ok && res.data) {
      const text = new TextDecoder().decode(res.data);
      remote = (JSON.parse(text) as Book[]) || [];
    }

    const byHash = new Map(remote.map((b) => [b.hash, b]));
    for (const book of booksToUpsert) {
      byHash.set(book.hash, {
        ...byHash.get(book.hash),
        hash: book.hash,
        format: book.format,
        title: book.title,
        sourceTitle: book.sourceTitle,
        author: book.author,
        createdAt: byHash.get(book.hash)?.createdAt ?? book.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      } as Book);
    }

    const merged = Array.from(byHash.values());
    // Part 4.3：手动上传路径同样剥离设备本地字段（旧远端条目可能残留
    // 其他设备的 filePath；本机内存条目可能带 coverImageUrl）。
    const body = new TextEncoder().encode(stripDeviceLocalFieldsFromJsonText(JSON.stringify(merged)));
    const put = await client.put(`/${getRemoteLibraryPath()}`, body, {
      contentType: 'application/json; charset=utf-8',
    });
    if (!put.ok) {
      addLog({
        id: uuidv4(),
        timestamp: Date.now(),
        direction: 'upload',
        path: getRemoteLibraryPath(),
        status: 'failed',
        message: put.error || (put.status ? `状态码：${put.status}` : '写入失败'),
      });
    }
    requireWebDavSuccess(put, '写入远端书架失败');
  };

  useEffect(() => {
    if (!isOpen) return;
    if (!editing.serverUrl || !editing.username) return;
    loadRemoteBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing.serverUrl, editing.remotePath, editing.username]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== 'download') return;
    loadRemoteBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const inferRemoteBookFile = async (client: WebDavClient, hash: string) => {
    const res = await client.propfind(`/${READEST_WEBDAV_BOOKS_DIR}/${hash}/`, { depth: '1' });
    if (!res.ok || !res.data) return null;
    const files = res.data
      .filter((r) => !r.isCollection)
      .map((r) => r.path.split('/').filter(Boolean).pop() || '');
    const knownExts = new Set(Object.values(EXTS));
    const bookFile = files.find((name) => {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      return knownExts.has(ext);
    });
    if (!bookFile) return null;
    const ext = bookFile.split('.').pop()?.toLowerCase() || '';
    const format =
      (Object.entries(EXTS).find(([, v]) => v === ext)?.[0] as BookFormat | undefined) ?? undefined;
    const title = bookFile.replace(new RegExp(`\\.${ext}$`, 'i'), '');
    return { bookFile, format, title };
  };

  const addDownloadedBooksToShelf = async (books: Book[]) => {
    if (!envConfig || books.length === 0) return;
    await updateBooks(envConfig, books);
  };

  // 同步前后 library.json 内容 md5 比对（D2）：引擎可能合并/下载远端内容
  // 改写本地 library.json，内存书架仍是旧列表时，用户的下一次书架变更会把
  // 旧数据写回磁盘。磁盘内容变了就必须从磁盘重载书架。
  const computeLibraryMd5 = async (): Promise<string | undefined> => {
    if (!appService) return undefined;
    try {
      return (await computeLocalFingerprint(appService, getLocalLibraryPath(), 'Books'))?.md5;
    } catch {
      return undefined;
    }
  };

  const reloadLibraryIfDiskChanged = async (libraryMd5Before: string | undefined) => {
    if (!appService) return;
    const libraryMd5After = await computeLibraryMd5();
    if (libraryMd5Before !== libraryMd5After) {
      const refreshed = await appService.loadLibraryBooks();
      useLibraryStore.getState().setLibrary(refreshed);
    }
  };

  const startSync = async (mode: 'upload' | 'download') => {
    if (!appService) return;
    // Part 4.5：程序化兜底互斥（UI 上同步按钮已按 isSyncing 禁用）——
    // 自动同步进行中时手动同步不得启动第二个引擎实例。
    if (useWebDavStore.getState().isSyncing) return;
    const profile = buildValidatedProfile();
    if (!profile) return;
    upsertProfile(profile);
    setEditing(profile);
    cancelRef.current = false;
    setSyncing(true);
    setPaused(false);
    setProgress({ totalItems: 0, completedItems: 0 });

    // 记录同步前 library.json 指纹：同步可能在合并/下载远端墓碑时改写本地
    // 索引，即使本轮存在失败/冲突也要重载书架（与自动同步 Runner 同语义）。
    const libraryMd5Before = await computeLibraryMd5();

    const client = new WebDavClient({
      serverUrl: profile.serverUrl,
      rootPath: profile.remotePath,
      username: profile.username,
      password: profile.password,
      allowInsecureHttp: profile.allowInsecureHttp,
      allowInsecureTls: profile.allowInsecureTls,
    });

    const pickBooks: Book[] =
      mode === 'upload'
        ? library.filter((b) => selectedUploadHashes.has(b.hash))
        : await Promise.all(
            remoteBooks
              .filter((b) => selectedDownloadHashes.has(b.hash))
              .map(async (b) => {
                const inferred = await inferRemoteBookFile(client, b.hash);
                return {
                  hash: b.hash,
                  format: b.format ?? inferred?.format ?? 'EPUB',
                  title: b.title || inferred?.title || b.hash,
                  sourceTitle: inferred?.title ?? b.sourceTitle,
                  author: '',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                } as Book;
              }),
          );

    const waitUntilResumed = () =>
      new Promise<void>((resolve) => {
        resumeResolverRef.current = resolve;
      });

    try {
      if (mode === 'upload' && pickBooks.length > 0) {
        await upsertRemoteLibraryIndex(client, pickBooks);
      }

      const { conflicts, failures } = await syncWebDavSelection(
        appService,
        profile,
        {
          books: pickBooks,
          includeLibrary: false,
        },
        {
          onProgress: (p) => setProgress(p),
          onLog: (l) => addLog(l),
        },
        {
          shouldPause: () => useWebDavStore.getState().isPaused,
          waitUntilResumed,
          shouldCancel: () => cancelRef.current,
        },
      );

      // 已被取消/关闭窗口：部分同步结果不算成功，不提示、不记 lastSuccessAt
      if (cancelRef.current) return;
      if (failures.length > 0) {
        showToast(_('同步失败'), 'error');
        setActiveTab('logs');
      } else if (conflicts.length > 0) {
        // Part 4.4：冲突并入 store 的"冲突"标签页处理，不再静默跳过；
        // 与 Runner 一致，conflict>0 不记 lastSuccessAt（下轮仍会尝试）。
        setConflicts(mergeWebDavConflictLists(useWebDavStore.getState().conflicts, conflicts));
        showToast(_('检测到 {{count}} 个同步冲突，请处理', { count: conflicts.length }), 'warning');
        setActiveTab('conflicts');
      } else {
        const ts = Date.now();
        setLastSuccessAt(ts);
        const updated = { ...profile, lastSyncAt: ts };
        upsertProfile(updated);
        setEditing(updated);
        showToast(_('同步完成'), 'success');
        if (mode === 'download') {
          await addDownloadedBooksToShelf(pickBooks);
        }
        await loadRemoteBooks(client);
      }

      // 同步可能已合并/下载远端墓碑改写本地 library.json：无论本轮成败，
      // 只要从磁盘重载书库，让书架与磁盘一致（部分成功同样生效）。
      await reloadLibraryIfDiskChanged(libraryMd5Before);
    } catch {
      showToast(_('同步失败'), 'error');
    } finally {
      setSyncing(false);
      setPaused(false);
    }
  };

  const togglePause = () => {
    setPaused(!isPaused);
  };

  // Part 4.4：按用户选择收敛单个冲突（引擎内做单向覆盖 + 同步状态更新，
  // 下一轮同步不再重复报告该冲突）。
  const resolveConflict = async (conflict: WebDavConflictItem, keep: 'local' | 'remote') => {
    if (!appService) return;
    if (resolvingPaths.has(conflict.path)) return;
    // 归属校验：resolve 用当前 profile 的服务器/凭据收敛冲突，跨 profile
    // 条目会把本地内容上传到错误的服务器（写错目标）。无 profileId 的历史
    // 条目（冲突不持久化，实际不存在）按不匹配保守拒绝。
    if (conflict.profileId !== activeProfileId) return;
    // Part 4.5 互斥：resolve 的多轮网络往返期间必须置位 isSyncing，否则
    // 自动同步 tick 到期或用户点上传/下载/手动同步会启动第二个引擎，并发
    // 读写同一份远端 + 本地同步状态（last-writer-wins：resolve 的状态写被
    // 覆盖 → 下轮重复检出同一冲突 + 状态重传抖动）。复用 isSyncing 互斥面，
    // Runner 让位、startSync 入口拒绝、同步按钮禁用全部自动生效；check 与
    // set 之间无 await（React setState 异步不可依赖，走 getState 原子完成），
    // 并发点击多个冲突的 resolve 由此串行化（后到者直接被拒）。
    // check-and-set 必须先于 library.json 指纹快照：若先做快照（含 await），
    // 快照期间 isSyncing=false，自动同步可在窗口内启动第二个引擎 → 本轮
    // resolve 被拒（无提示）或与其并发；先置位互斥再快照，快照期间自动/
    // 手动同步一律让位或被拒。外层 try/finally 把快照在内的全部 await 包住：
    // setSyncing(true) 之后的任何失败都释放互斥标志。
    if (useWebDavStore.getState().isSyncing) return;
    useWebDavStore.getState().setSyncing(true);
    try {
      // library.json 指纹快照：resolve 保留远端会把远端内容下载覆盖到本地
      // 磁盘，冲突条目是 library.json 时内存书架就与磁盘脱节了（旧列表随后
      // 的一次书架变更会把旧数据写回磁盘，抹掉刚同步来的内容）。与 startSync
      // 相同的 md5 比对机制：resolve 前后内容变化则从磁盘重载。
      const libraryMd5Before = await computeLibraryMd5();
      const profile = buildValidatedProfile();
      // 双保险：真正发起请求的 profile 必须就是冲突归属（防止编辑态与
      // 激活 profile 短暂不一致时用错凭据）
      if (!profile || profile.id !== conflict.profileId) return;
      setResolvingPaths((prev) => new Set(prev).add(conflict.path));
      try {
        const results = await resolveWebDavConflicts(appService, profile, [
          { path: conflict.path, keep },
        ]);
        const result = results[0];
        if (result?.ok) {
          removeConflict(conflict.profileId, conflict.path);
          showToast(_('冲突已解决'), 'success');
        } else {
          showToast(result?.message ? `${_('冲突解决失败')}：${result.message}` : _('冲突解决失败'), 'error');
        }
      } catch {
        showToast(_('冲突解决失败'), 'error');
      } finally {
        setResolvingPaths((prev) => {
          const next = new Set(prev);
          next.delete(conflict.path);
          return next;
        });
      }
      // 无论 resolve 报成功与否都要比对：下载已落盘但状态写失败等路径会被
      // 标记为失败，此时磁盘内容同样可能已变（与 startSync 的部分成功语义一致）
      try {
        await reloadLibraryIfDiskChanged(libraryMd5Before);
      } catch (error) {
        // 书架重载的 IO 异常不中断 resolve 的收尾：互斥标志经 finally 释放，
        // 状态不坏，只损失一次书架刷新（下次书架加载时自愈）。
        console.warn('[WebDAV] 冲突解决后重载书架失败', error);
      }
    } finally {
      // 成功/失败/异常一律释放互斥标志，否则自动同步被永久阻塞
      useWebDavStore.getState().setSyncing(false);
    }
  };

  // 懒加载差异摘要：读取本地文件 + 拉取远端内容做 JSON 差异摘要（简版
  // 内容合并预览）；二进制/损坏内容记录 null，UI 展示说明文案。
  const toggleConflictDetails = async (conflict: WebDavConflictItem) => {
    if (conflict.path in conflictDetails) {
      setConflictDetails(({ [conflict.path]: _omit, ...rest }) => rest);
      return;
    }
    if (!appService) return;
    // 归属校验：差异预览用当前 profile 的凭据拉远端内容，跨 profile 条目
    // 会读错服务器；无 profileId 的历史条目按不匹配保守拒绝。
    if (conflict.profileId !== activeProfileId) return;
    setConflictDetails((prev) => ({ ...prev, [conflict.path]: null }));
    try {
      const localPath = conflict.path.slice('Books/'.length);
      if (!conflict.path.startsWith('Books/') || !localPath) throw new Error('invalid path');
      const localText = (await appService.readFile(localPath, 'Books', 'text')) as string;
      const client = new WebDavClient({
        serverUrl: editing.serverUrl,
        rootPath: editing.remotePath,
        username: editing.username,
        password: editing.password,
        allowInsecureHttp: editing.allowInsecureHttp,
        allowInsecureTls: editing.allowInsecureTls,
      });
      const remoteRes = await client.get(`${READEST_WEBDAV_ROOT_DIRNAME}/${conflict.path}`);
      if (!remoteRes.ok || !remoteRes.data) throw new Error(remoteRes.error || '读取失败');
      const summary = summarizeJsonDiff(localText, new TextDecoder().decode(remoteRes.data));
      if (!summary) throw new Error('not json');
      setConflictDetails((prev) => ({ ...prev, [conflict.path]: summary }));
    } catch {
      // 保持 null：UI 显示"无法预览"说明文案
    }
  };

  const header = (
    <div className='flex w-full items-center justify-between'>
      <div className='flex min-w-0 flex-col'>
        <div className='truncate text-base font-semibold'>{_('WebDAV 设置与同步')}</div>
        {lastSuccessAt ? (
          <div className='text-base-content/60 text-xs'>
            {_('上次成功同步：{{time}}', { time: formatDateTime(lastSuccessAt) })}
          </div>
        ) : (
          <div className='text-base-content/60 text-xs'>{_('尚未进行同步')}</div>
        )}
      </div>
      <button
        className='btn btn-ghost btn-sm btn-circle'
        onClick={() => setWebDavCenterVisible(false)}
        aria-label={_('关闭')}
      >
        <MdClose size={18} />
      </button>
    </div>
  );

  const progressPercent =
    progress && progress.totalItems > 0
      ? Math.round((progress.completedItems / progress.totalItems) * 100)
      : 0;

  const formatServerAddress = (serverUrl: string) => {
    try {
      const u = new URL(serverUrl);
      const port = u.port ? `:${u.port}` : '';
      return `${u.hostname}${port}`;
    } catch {
      return serverUrl.replace(/^https?:\/\//i, '').split('/')[0] || serverUrl;
    }
  };

  return (
    <Dialog
      id='webdav_center'
      isOpen={isOpen}
      header={header}
      onClose={() => {
        // 关闭窗口即取消进行中的同步（弹窗关闭不卸载组件，卸载 cleanup 不触发）
        cancelSync();
        setIsOpen(false);
        setWebDavCenterOpen(false);
      }}
      boxClassName='sm:!w-[720px] sm:!max-w-screen-md sm:h-auto'
    >
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex flex-1 items-center gap-2'>
              <select
                className='select select-bordered w-full'
                value={activeProfileId ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  setActiveProfileId(id || null);
                  const p = profiles.find((x) => x.id === id);
                  if (p) setEditing(p);
                }}
              >
                <option value=''>{_('请选择配置')}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className='btn btn-ghost btn-sm' onClick={createProfile}>
                {_('新增')}
              </button>
              <button
                className='btn btn-ghost btn-sm'
                onClick={removeProfile}
                disabled={!selectedProfile}
              >
                <MdDelete size={18} />
              </button>
            </div>
            <div className='flex items-center gap-2'>
              <button className='btn btn-sm' onClick={saveProfile}>
                {_('保存配置')}
              </button>
              <button className='btn btn-sm' onClick={testConnection}>
                {_('测试连接')}
              </button>
            </div>
          </div>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <div className='flex flex-col gap-1'>
              <label className='text-sm'>{_('备注名')}</label>
              <input
                ref={nameInputRef}
                className='input input-bordered w-full'
                value={editing.name}
                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                placeholder='WebDAV_1'
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-sm'>{_('服务器地址')}</label>
              <input
                className='input input-bordered w-full'
                value={editing.serverUrl}
                onChange={(e) => setEditing((p) => ({ ...p, serverUrl: e.target.value }))}
                placeholder='https://dav.example.com'
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-sm'>{_('远端路径')}</label>
              <input
                className='input input-bordered w-full'
                value={editing.remotePath}
                onChange={(e) => setEditing((p) => ({ ...p, remotePath: e.target.value }))}
                placeholder='/remote/path'
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-sm'>{_('用户名')}</label>
              <input
                className='input input-bordered w-full'
                value={editing.username}
                onChange={(e) => setEditing((p) => ({ ...p, username: e.target.value }))}
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-sm'>{_('密码')}</label>
              <input
                className='input input-bordered w-full'
                type='password'
                value={editing.password}
                onChange={(e) => setEditing((p) => ({ ...p, password: e.target.value }))}
              />
            </div>
          </div>

          <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex items-center gap-3'>
              <label className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  className='checkbox checkbox-sm'
                  checked={!!editing.allowInsecureHttp}
                  onChange={(e) =>
                    setEditing((p) => ({ ...p, allowInsecureHttp: e.target.checked }))
                  }
                />
                <span className='text-sm'>{_('允许 HTTP（不安全）')}</span>
              </label>
              <label className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  className='checkbox checkbox-sm'
                  checked={!!editing.allowInsecureTls}
                  onChange={(e) =>
                    setEditing((p) => ({ ...p, allowInsecureTls: e.target.checked }))
                  }
                />
                <span className='text-sm'>{_('允许不受信任证书')}</span>
              </label>
            </div>
            <div className='flex items-center gap-2'>
              <span className='text-sm'>{_('冲突策略')}</span>
              <select
                className='select select-bordered select-sm'
                value={editing.conflictStrategy}
                onChange={(e) =>
                  setEditing((p) => ({
                    ...p,
                    conflictStrategy: e.target.value as WebDavConflictResolutionStrategy,
                  }))
                }
              >
                <option value='manual'>{_('手动处理')}</option>
                <option value='newest'>{_('时间戳优先')}</option>
                <option value='local'>{_('本地优先')}</option>
                <option value='remote'>{_('云端优先')}</option>
              </select>
            </div>
          </div>

          <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                className='checkbox checkbox-sm'
                checked={autoSyncEnabled}
                onChange={(e) => setAutoSyncEnabled(e.target.checked)}
              />
              <span className='text-sm'>{_('开启自动同步（仅在应用运行时）')}</span>
            </label>
            <div className='flex items-center gap-2'>
              <span className='text-sm'>{_('同步间隔（分钟）')}</span>
              <input
                className='input input-bordered input-sm w-24'
                type='number'
                min={5}
                max={1440}
                value={autoSyncIntervalMinutes}
                onChange={(e) =>
                  setAutoSyncIntervalMinutes(Number.parseInt(e.target.value, 10) || 15)
                }
                disabled={!autoSyncEnabled}
              />
            </div>
          </div>
        </div>

        <div className='border-base-300 rounded-xl border'>
          <div className='border-base-300 flex border-b'>
            <button
              className={clsx(
                'flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium',
                activeTab === 'upload'
                  ? 'border-base-content text-base-content border-b-2'
                  : 'text-base-content/60',
              )}
              onClick={() => setActiveTab('upload')}
            >
              <MdCloudUpload size={18} />
              {_('上传（本地）')}
            </button>
            <button
              className={clsx(
                'flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium',
                activeTab === 'download'
                  ? 'border-base-content text-base-content border-b-2'
                  : 'text-base-content/60',
              )}
              onClick={() => setActiveTab('download')}
            >
              <MdCloudDownload size={18} />
              {_('下载（云端）')}
            </button>
            <button
              className={clsx(
                'flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium',
                activeTab === 'logs'
                  ? 'border-base-content text-base-content border-b-2'
                  : 'text-base-content/60',
              )}
              onClick={() => setActiveTab('logs')}
            >
              {_('同步日志')}
            </button>
            <button
              className={clsx(
                'flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium',
                activeTab === 'conflicts'
                  ? 'border-base-content text-base-content border-b-2'
                  : 'text-base-content/60',
              )}
              onClick={() => setActiveTab('conflicts')}
            >
              {_('冲突')}
              {visibleConflicts.length > 0 ? (
                <span className='badge badge-warning badge-xs'>{visibleConflicts.length}</span>
              ) : null}
            </button>
            <button
              className={clsx(
                'flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium',
                activeTab === 'profiles'
                  ? 'border-base-content text-base-content border-b-2'
                  : 'text-base-content/60',
              )}
              onClick={() => setActiveTab('profiles')}
            >
              {_('配置列表')}
            </button>
          </div>

          {activeTab === 'upload' && (
            <div className='h-72 overflow-y-auto p-2'>
              <div className='flex items-center justify-between px-2 pb-2'>
                <div className='text-base-content/60 text-xs'>{_('本地书籍')}</div>
                <input
                  className='input input-bordered input-sm w-56'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={_('搜索')}
                />
              </div>
              <ul className='space-y-1' role='listbox'>
                {filteredLocalBooks.map((b) => {
                  const selected = selectedUploadHashes.has(b.hash);
                  return (
                    <li
                      key={b.hash}
                      className='hover:bg-base-200 flex cursor-pointer items-center justify-between rounded p-2'
                      role='option'
                      aria-selected={selected}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.currentTarget.click();
                        }
                      }}
                      onClick={() => {
                        setSelectedUploadHashes((prev) => {
                          const next = new Set(prev);
                          if (next.has(b.hash)) next.delete(b.hash);
                          else next.add(b.hash);
                          return next;
                        });
                      }}
                    >
                      <div className='flex min-w-0 items-center gap-3'>
                        <input
                          type='checkbox'
                          className='checkbox checkbox-sm'
                          readOnly
                          checked={selected}
                        />
                        <span className='truncate text-sm'>{b.title}</span>
                      </div>
                      <div className='text-base-content/50 text-xs'>{b.format}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {activeTab === 'download' && (
            <div className='h-72 overflow-y-auto p-2'>
              <div className='flex flex-col gap-2 px-2 pb-2 sm:flex-row sm:items-center sm:justify-between'>
                <div className='min-w-0'>
                  <div className='text-base-content/70 text-xs font-medium'>{_('云端书籍')}</div>
                  <div className='text-base-content/60 break-words text-[11px] leading-5 sm:text-xs'>
                    {remoteCountInfo
                      ? `${_('目录')} ${remoteCountInfo.dirCount} · ${_('清单')} ${remoteCountInfo.libraryCount}`
                      : ''}
                  </div>
                </div>
                <div className='flex w-full items-center gap-2 sm:w-auto'>
                  <input
                    className='input input-bordered input-sm w-full sm:w-56'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={_('搜索')}
                  />
                  <button className='btn btn-ghost btn-xs' onClick={() => loadRemoteBooks()}>
                    {_('刷新')}
                  </button>
                </div>
              </div>
              <ul className='space-y-1' role='listbox'>
                {filteredRemoteBooks.map((b) => {
                  const selected = selectedDownloadHashes.has(b.hash);
                  return (
                    <li
                      key={b.hash}
                      className='hover:bg-base-200 flex cursor-pointer items-center justify-between rounded p-2'
                      role='option'
                      aria-selected={selected}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.currentTarget.click();
                        }
                      }}
                      onClick={() => {
                        setSelectedDownloadHashes((prev) => {
                          const next = new Set(prev);
                          if (next.has(b.hash)) next.delete(b.hash);
                          else next.add(b.hash);
                          return next;
                        });
                      }}
                    >
                      <div className='flex min-w-0 items-center gap-3'>
                        <input
                          type='checkbox'
                          className='checkbox checkbox-sm'
                          readOnly
                          checked={selected}
                        />
                        <span className='truncate text-sm'>{b.title}</span>
                      </div>
                      <div className='text-base-content/50 text-xs'>{b.format || ''}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className='h-72 overflow-y-auto p-3'>
              <div className='flex items-center justify-between pb-2'>
                <div className='text-base-content/60 text-xs'>{_('最多保留 500 条记录')}</div>
                <div className='flex items-center gap-2'>
                  <button className='btn btn-ghost btn-xs' onClick={clearLogs}>
                    {_('清空')}
                  </button>
                  <button
                    className='btn btn-ghost btn-xs'
                    onClick={async () => {
                      if (!appService) return;
                      const ok = await appService.saveFile(
                        'webdav-sync-log.json',
                        JSON.stringify(logs, null, 2),
                        'application/json',
                      );
                      if (ok) showToast(_('日志已导出'), 'success');
                    }}
                  >
                    {_('导出')}
                  </button>
                </div>
              </div>
              <div className='space-y-2'>
                {logs.map((l) => (
                  <div key={l.id} className='border-base-300 rounded-lg border p-2 text-sm'>
                    <div className='flex items-center justify-between gap-2'>
                      <div className='truncate'>{l.path}</div>
                      <div className='text-base-content/60 text-xs'>
                        {formatDateTime(l.timestamp)}
                      </div>
                    </div>
                    <div className='text-base-content/60 flex items-center justify-between pt-1 text-xs'>
                      <span>
                        {l.direction === 'upload' ? _('上传') : _('下载')} · {l.status}
                      </span>
                      <span className='truncate'>{l.message || ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'conflicts' && (
            <div className='h-72 overflow-y-auto p-3'>
              <div className='text-base-content/60 pb-2 text-xs'>
                {_('以下条目在两端都被修改，请选择要保留的版本')}
              </div>
              {visibleConflicts.length === 0 ? (
                <div className='text-base-content/50 py-8 text-center text-sm'>
                  {_('没有待处理的冲突')}
                </div>
              ) : (
                <div className='space-y-2'>
                  {visibleConflicts.map((conflict) => {
                    const resolving = resolvingPaths.has(conflict.path);
                    const details = conflictDetails[conflict.path];
                    return (
                      <div
                        key={conflict.path}
                        className='border-base-300 rounded-lg border p-2 text-sm'
                      >
                        <div className='flex items-center justify-between gap-2'>
                          <div className='truncate font-medium'>{conflict.path}</div>
                          <button
                            className='btn btn-ghost btn-xs'
                            onClick={() => toggleConflictDetails(conflict)}
                          >
                            {conflict.path in conflictDetails ? _('收起') : _('查看差异')}
                          </button>
                        </div>
                        <div className='text-base-content/60 grid grid-cols-2 gap-2 pt-1 text-xs'>
                          <div>
                            <div className='font-medium'>{_('本地版本')}</div>
                            <div>
                              {conflict.local?.size != null
                                ? formatBytes(conflict.local.size)
                                : _('未知')}
                            </div>
                            <div>
                              {conflict.local?.observedAt
                                ? formatDateTime(conflict.local.observedAt)
                                : ''}
                            </div>
                          </div>
                          <div>
                            <div className='font-medium'>{_('远端版本')}</div>
                            <div>
                              {conflict.remote?.size != null
                                ? formatBytes(conflict.remote.size)
                                : _('未知')}
                            </div>
                            <div>
                              {conflict.remote?.lastModified
                                ? formatDateTime(Date.parse(conflict.remote.lastModified))
                                : ''}
                            </div>
                          </div>
                        </div>
                        {details && (
                          <div className='border-base-300 mt-2 space-y-1 border-t pt-2 text-xs'>
                            {details.localCount != null && details.remoteCount != null ? (
                              <div>
                                {_('本地 {{local}} 项 / 远端 {{remote}} 项', {
                                  local: details.localCount,
                                  remote: details.remoteCount,
                                })}
                              </div>
                            ) : null}
                            {details.onlyInLocal.length > 0 ? (
                              <div>
                                {_('仅本地')}：{details.onlyInLocal.join('、')}
                              </div>
                            ) : null}
                            {details.onlyInRemote.length > 0 ? (
                              <div>
                                {_('仅远端')}：{details.onlyInRemote.join('、')}
                              </div>
                            ) : null}
                            {details.changed.length > 0 ? (
                              <div>
                                {_('两端不同')}：{details.changed.join('、')}
                              </div>
                            ) : null}
                            {details.truncated > 0 ? (
                              <div>{_('还有 {{count}} 项未展示', { count: details.truncated })}</div>
                            ) : null}
                          </div>
                        )}
                        {conflict.path in conflictDetails && !details ? (
                          <div className='text-base-content/50 mt-2 text-xs'>
                            {_('该条目不是 JSON，无法预览差异，只能整体保留其中一端')}
                          </div>
                        ) : null}
                        <div className='flex items-center justify-end gap-2 pt-2'>
                          {resolving ? <span className='text-base-content/50 text-xs'>{_('解决中…')}</span> : null}
                          <button
                            className='btn btn-ghost btn-xs'
                            disabled={resolving || isSyncing}
                            onClick={() => resolveConflict(conflict, 'local')}
                          >
                            {_('保留本地')}
                          </button>
                          <button
                            className='btn btn-ghost btn-xs'
                            disabled={resolving || isSyncing}
                            onClick={() => resolveConflict(conflict, 'remote')}
                          >
                            {_('保留远端')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'profiles' && (
            <div className='h-72 overflow-y-auto p-2'>
              <div className='flex items-center justify-between gap-2 px-2 pb-2'>
                <div className='text-base-content/60 text-xs'>{_('已保存配置')}</div>
                <div className='flex items-center gap-2'>
                  <button className='btn btn-ghost btn-xs' onClick={createProfile}>
                    {_('新增')}
                  </button>
                  <button
                    className='btn btn-ghost btn-xs'
                    onClick={() => {
                      if (!selectedProfile) return;
                      setEditing(selectedProfile);
                      nameInputRef.current?.focus();
                    }}
                    disabled={!selectedProfile}
                  >
                    {_('编辑')}
                  </button>
                  <button
                    className='btn btn-ghost btn-xs'
                    onClick={removeProfile}
                    disabled={!selectedProfile}
                  >
                    {_('删除')}
                  </button>
                  <button
                    className='btn btn-ghost btn-xs'
                    onClick={() => {
                      if (!selectedProfile) return;
                      setActiveProfileId(selectedProfile.id);
                      showToast(_('已设为默认'), 'success');
                    }}
                    disabled={!selectedProfile}
                  >
                    {_('设为默认')}
                  </button>
                </div>
              </div>
              <ul className='space-y-1' role='listbox'>
                {profiles.map((p) => {
                  const isActive = p.id === activeProfileId;
                  return (
                    <li
                      key={p.id}
                      className={clsx(
                        'flex cursor-pointer items-center justify-between gap-3 rounded p-2',
                        isActive ? 'bg-base-200' : 'hover:bg-base-200',
                      )}
                      role='option'
                      aria-selected={isActive}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.currentTarget.click();
                        }
                      }}
                      onClick={() => {
                        setActiveProfileId(p.id);
                        setEditing(p);
                      }}
                    >
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-sm font-medium'>{p.name}</span>
                          {isActive ? (
                            <span className='badge badge-primary badge-xs'>{_('默认')}</span>
                          ) : null}
                        </div>
                        <div className='text-base-content/60 truncate text-xs'>
                          {formatServerAddress(p.serverUrl)}
                        </div>
                      </div>
                      <div className='text-base-content/60 text-xs'>
                        {p.lastSyncAt ? formatDateTime(p.lastSyncAt) : _('尚未同步')}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className='border-base-300 bg-base-200/30 border-t p-4'>
            {isSyncing && (
              <div className='mb-3'>
                <div className='flex items-center justify-between text-xs'>
                  <span className='text-base-content/70'>{progress?.currentPath || ''}</span>
                  <span className='text-base-content/70'>
                    {progress?.failedItems ? (
                      <span className='text-error'>
                        {_('失败 {{count}} 项', { count: progress.failedItems })} ·{' '}
                      </span>
                    ) : null}
                    {progressPercent}%
                  </span>
                </div>
                <div className='bg-base-300 mt-1 h-2 w-full overflow-hidden rounded-full'>
                  <div
                    className='bg-primary h-full transition-all'
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            <div className='grid grid-cols-2 gap-3'>
              <button
                className='btn btn-primary w-full'
                disabled={isSyncing || selectedUploadHashes.size === 0}
                onClick={() => startSync('upload')}
              >
                <MdCloudUpload size={18} />
                {_('上传选中书籍')}
              </button>
              <button
                className='btn btn-primary w-full'
                disabled={isSyncing || selectedDownloadHashes.size === 0}
                onClick={() => startSync('download')}
              >
                <MdCloudDownload size={18} />
                {_('下载选中书籍')}
              </button>
            </div>

            <div className='mt-3 flex items-center justify-between'>
              <button className='btn btn-ghost btn-sm' onClick={togglePause} disabled={!isSyncing}>
                {isPaused ? <MdPlayArrow size={18} /> : <MdPause size={18} />}
                {isPaused ? _('恢复') : _('暂停')}
              </button>
              <button
                className='btn btn-ghost btn-sm'
                onClick={() => {
                  cancelSync();
                  showToast(_('已请求停止，当前任务完成后将退出'), 'info');
                }}
                disabled={!isSyncing}
              >
                {_('停止')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default WebDavCenterWindow;
