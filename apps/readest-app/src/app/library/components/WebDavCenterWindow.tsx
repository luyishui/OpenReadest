'use client';

import clsx from 'clsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { MdClose, MdCloudUpload, MdCloudDownload, MdPlayArrow, MdPause, MdDelete } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useWebDavStore, loadWebDavStoreFromStorage } from '@/store/webdavStore';
import Dialog from '@/components/Dialog';
import { eventDispatcher } from '@/utils/event';
import { WebDavClient } from '@/services/webdav/client/WebDavClient';
import { syncWebDavSelection } from '@/services/webdav/sync/engine';
import {
  READEST_WEBDAV_BOOKS_DIR,
  READEST_WEBDAV_ROOT_DIRNAME,
  READEST_WEBDAV_SYSTEM_DIR,
  getRemoteLibraryPath,
} from '@/services/webdav/sync/paths';
import { WebDavProfile, WebDavConflictResolutionStrategy } from '@/services/webdav/models';
import { getUniqueWebDavProfileName, validateWebDavProfileName } from '@/services/webdav/profileName';
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
  const [remoteCountInfo, setRemoteCountInfo] = useState<{ dirCount: number; libraryCount: number } | null>(null);
  const resumeResolverRef = useRef<(() => void) | null>(null);
  const cancelRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      setWebDavCenterOpen(event.detail.visible);
    };
    const el = document.getElementById('webdav_center');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }
    return () => {
      if (el) el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    };
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

  const selectedProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) ?? null;
  }, [profiles, activeProfileId]);

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const filteredLocalBooks = useMemo(() => {
    if (!normalizedQuery) return library;
    return library.filter((b) => {
      const haystack = `${b.title} ${b.sourceTitle || ''} ${b.author || ''} ${b.format} ${b.hash}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [library, normalizedQuery]);

  const filteredRemoteBooks = useMemo(() => {
    if (!normalizedQuery) return remoteBooks;
    return remoteBooks.filter((b) => {
      const haystack = `${b.title} ${b.sourceTitle || ''} ${b.format || ''} ${b.hash}`.toLowerCase();
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
    const check = validateWebDavProfileName(editing.name || '', usedNames, editing.id || null, idToName);
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
    const name = getUniqueWebDavProfileName('WebDAV', profiles.map((p) => p.name));
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
        message: libraryRes.error || (libraryRes.status ? `状态码：${libraryRes.status}` : '读取失败'),
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
    const body = new TextEncoder().encode(JSON.stringify(merged));
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
    const files = res.data.filter((r) => !r.isCollection).map((r) => r.path.split('/').filter(Boolean).pop() || '');
    const knownExts = new Set(Object.values(EXTS));
    const bookFile = files.find((name) => {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      return knownExts.has(ext);
    });
    if (!bookFile) return null;
    const ext = bookFile.split('.').pop()?.toLowerCase() || '';
    const format = (Object.entries(EXTS).find(([, v]) => v === ext)?.[0] as BookFormat | undefined) ?? undefined;
    const title = bookFile.replace(new RegExp(`\\.${ext}$`, 'i'), '');
    return { bookFile, format, title };
  };

  const addDownloadedBooksToShelf = async (books: Book[]) => {
    if (!envConfig || books.length === 0) return;
    await updateBooks(envConfig, books);
  };

  const startSync = async (mode: 'upload' | 'download') => {
    if (!appService) return;
    const profile = buildValidatedProfile();
    if (!profile) return;
    upsertProfile(profile);
    setEditing(profile);
    cancelRef.current = false;
    setSyncing(true);
    setPaused(false);
    setProgress({ totalItems: 0, completedItems: 0 });

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

        const { conflicts } = await syncWebDavSelection(
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

      if (conflicts.length > 0) {
        showToast(_('检测到同步冲突，请在日志中查看'), 'warning');
        setActiveTab('logs');
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

  const header = (
    <div className='flex w-full items-center justify-between'>
      <div className='flex min-w-0 flex-col'>
        <div className='truncate text-base font-semibold'>{_('WebDAV 设置与同步')}</div>
        {lastSuccessAt ? (
          <div className='text-base-content/60 text-xs'>{_('上次成功同步：{{time}}', { time: formatDateTime(lastSuccessAt) })}</div>
        ) : (
          <div className='text-base-content/60 text-xs'>{_('尚未进行同步')}</div>
        )}
      </div>
      <button className='btn btn-ghost btn-sm btn-circle' onClick={() => setWebDavCenterVisible(false)} aria-label={_('关闭')}>
        <MdClose size={18} />
      </button>
    </div>
  );

  const progressPercent =
    progress && progress.totalItems > 0 ? Math.round((progress.completedItems / progress.totalItems) * 100) : 0;

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
              <button className='btn btn-ghost btn-sm' onClick={removeProfile} disabled={!selectedProfile}>
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
                  onChange={(e) => setEditing((p) => ({ ...p, allowInsecureHttp: e.target.checked }))}
                />
                <span className='text-sm'>{_('允许 HTTP（不安全）')}</span>
              </label>
              <label className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  className='checkbox checkbox-sm'
                  checked={!!editing.allowInsecureTls}
                  onChange={(e) => setEditing((p) => ({ ...p, allowInsecureTls: e.target.checked }))}
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
                  setEditing((p) => ({ ...p, conflictStrategy: e.target.value as WebDavConflictResolutionStrategy }))
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
                onChange={(e) => setAutoSyncIntervalMinutes(Number.parseInt(e.target.value, 10) || 15)}
                disabled={!autoSyncEnabled}
              />
            </div>
          </div>
        </div>

        <div className='border-base-300 rounded-xl border'>
          <div className='flex border-b border-base-300'>
            <button
              className={clsx(
                'flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium',
                activeTab === 'upload' ? 'border-b-2 border-base-content text-base-content' : 'text-base-content/60',
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
                  ? 'border-b-2 border-base-content text-base-content'
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
                activeTab === 'logs' ? 'border-b-2 border-base-content text-base-content' : 'text-base-content/60',
              )}
              onClick={() => setActiveTab('logs')}
            >
              {_('同步日志')}
            </button>
            <button
              className={clsx(
                'flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium',
                activeTab === 'profiles' ? 'border-b-2 border-base-content text-base-content' : 'text-base-content/60',
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
              <ul className='space-y-1'>
                {filteredLocalBooks.map((b) => {
                  const selected = selectedUploadHashes.has(b.hash);
                  return (
                    <li
                      key={b.hash}
                      className='hover:bg-base-200 flex cursor-pointer items-center justify-between rounded p-2'
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
                        <input type='checkbox' className='checkbox checkbox-sm' readOnly checked={selected} />
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
              <div className='flex items-center justify-between gap-3 px-2 pb-2'>
                <div className='text-base-content/60 text-xs'>
                  {_('云端书籍')}
                  {remoteCountInfo
                    ? ` · ${_('目录')} ${remoteCountInfo.dirCount} / ${_('清单')} ${remoteCountInfo.libraryCount}`
                    : ''}
                </div>
                <div className='flex items-center gap-2'>
                  <input
                    className='input input-bordered input-sm w-56'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={_('搜索')}
                  />
                  <button className='btn btn-ghost btn-xs' onClick={() => loadRemoteBooks()}>
                    {_('刷新')}
                  </button>
                </div>
              </div>
              <ul className='space-y-1'>
                {filteredRemoteBooks.map((b) => {
                  const selected = selectedDownloadHashes.has(b.hash);
                  return (
                    <li
                      key={b.hash}
                      className='hover:bg-base-200 flex cursor-pointer items-center justify-between rounded p-2'
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
                        <input type='checkbox' className='checkbox checkbox-sm' readOnly checked={selected} />
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
                      <div className='text-base-content/60 text-xs'>{formatDateTime(l.timestamp)}</div>
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
                  <button className='btn btn-ghost btn-xs' onClick={removeProfile} disabled={!selectedProfile}>
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
              <ul className='space-y-1'>
                {profiles.map((p) => {
                  const isActive = p.id === activeProfileId;
                  return (
                    <li
                      key={p.id}
                      className={clsx(
                        'flex cursor-pointer items-center justify-between gap-3 rounded p-2',
                        isActive ? 'bg-base-200' : 'hover:bg-base-200',
                      )}
                      onClick={() => {
                        setActiveProfileId(p.id);
                        setEditing(p);
                      }}
                    >
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-sm font-medium'>{p.name}</span>
                          {isActive ? <span className='badge badge-primary badge-xs'>{_('默认')}</span> : null}
                        </div>
                        <div className='text-base-content/60 truncate text-xs'>{formatServerAddress(p.serverUrl)}</div>
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
                  <span className='text-base-content/70'>{progressPercent}%</span>
                </div>
                <div className='bg-base-300 mt-1 h-2 w-full overflow-hidden rounded-full'>
                  <div className='bg-primary h-full transition-all' style={{ width: `${progressPercent}%` }} />
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
                  cancelRef.current = true;
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
