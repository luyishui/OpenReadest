import { v4 as uuidv4 } from 'uuid';
import { AppService } from '@/types/system';
import { Book } from '@/types/book';
import { WebDavClient } from '../client/WebDavClient';
import { WebDavProfile, WebDavConflictItem, WebDavSyncLogItem, WebDavSyncProgress } from '../models';
import { computeLocalFingerprint } from './fingerprint';
import { createEmptyWebDavSyncState, WebDavSyncStateEntry, WebDavSyncStateV1 } from './state';
import { getLocalSyncStatePath, getRemoteBookPaths, getRemoteLibraryPath, getRemoteSyncStatePath, getLocalBookPaths, getLocalLibraryPath, READEST_WEBDAV_BOOKS_DIR, READEST_WEBDAV_ROOT_DIRNAME, READEST_WEBDAV_SYSTEM_DIR } from './paths';

type SyncCallbacks = {
  onProgress?: (progress: WebDavSyncProgress) => void;
  onLog?: (log: WebDavSyncLogItem) => void;
};

type SyncControl = {
  shouldPause?: () => boolean;
  waitUntilResumed?: () => Promise<void>;
  shouldCancel?: () => boolean;
};

const safeJsonParse = <T>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const areLocalFingerprintsEqual = (
  a?: WebDavSyncStateEntry['local'],
  b?: WebDavSyncStateEntry['local'],
): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.md5 && b.md5) return a.md5 === b.md5;
  if (typeof a.size === 'number' && typeof b.size === 'number') return a.size === b.size;
  return false;
};

const areRemoteFingerprintsEqual = (
  a?: WebDavSyncStateEntry['remote'],
  b?: WebDavSyncStateEntry['remote'],
): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.etag && b.etag) return a.etag === b.etag;
  if (a.lastModified && b.lastModified) return a.lastModified === b.lastModified;
  if (typeof a.size === 'number' && typeof b.size === 'number') return a.size === b.size;
  return false;
};

const parseHttpDateMs = (value?: string): number | undefined => {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
};

const pickNewestSide = (conflict: WebDavConflictItem): 'local' | 'remote' => {
  const localAt = conflict.local?.observedAt;
  const remoteAt = parseHttpDateMs(conflict.remote?.lastModified);
  if (typeof localAt !== 'number' && typeof remoteAt !== 'number') return 'local';
  if (typeof localAt !== 'number') return 'remote';
  if (typeof remoteAt !== 'number') return 'local';
  return localAt >= remoteAt ? 'local' : 'remote';
};

const ensureRemoteDirsForFile = async (client: WebDavClient, remoteFilePath: string) => {
  const parts = remoteFilePath.split('/').filter(Boolean);
  if (parts.length <= 1) return;
  const dirs = parts.slice(0, -1);
  let current = '';
  for (const dir of dirs) {
    current = current ? `${current}/${dir}` : dir;
    await client.mkcol(`/${current}`);
  }
};

const ensureRemoteRoot = async (client: WebDavClient) => {
  await client.mkcol(`/${READEST_WEBDAV_ROOT_DIRNAME}`);
  await client.mkcol(`/${READEST_WEBDAV_BOOKS_DIR}`);
  await client.mkcol(`/${READEST_WEBDAV_SYSTEM_DIR}`);
};

const readLocalState = async (appService: AppService): Promise<WebDavSyncStateV1> => {
  const path = getLocalSyncStatePath();
  const exists = await appService.exists(path, 'Settings').catch(() => false);
  if (!exists) return createEmptyWebDavSyncState();
  const text = (await appService.readFile(path, 'Settings', 'text')) as string;
  const parsed = safeJsonParse<WebDavSyncStateV1>(text);
  if (!parsed || parsed.version !== 1) return createEmptyWebDavSyncState();
  return parsed;
};

const writeLocalState = async (appService: AppService, state: WebDavSyncStateV1): Promise<void> => {
  const path = getLocalSyncStatePath();
  const dirPath = path.split('/').slice(0, -1).join('/');
  if (dirPath) {
    await appService.createDir(dirPath, 'Settings', true).catch(() => {});
  }
  await appService.writeFile(path, 'Settings', JSON.stringify(state));
};

const readRemoteState = async (client: WebDavClient): Promise<WebDavSyncStateV1> => {
  const res = await client.get(getRemoteSyncStatePath());
  if (!res.ok || !res.data) return createEmptyWebDavSyncState();
  const text = new TextDecoder().decode(res.data);
  const parsed = safeJsonParse<WebDavSyncStateV1>(text);
  if (!parsed || parsed.version !== 1) return createEmptyWebDavSyncState();
  return parsed;
};

const writeRemoteState = async (client: WebDavClient, state: WebDavSyncStateV1): Promise<void> => {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  await ensureRemoteDirsForFile(client, getRemoteSyncStatePath());
  await client.put(getRemoteSyncStatePath(), bytes, { contentType: 'application/json; charset=utf-8' });
};

const mergeStates = (a: WebDavSyncStateV1, b: WebDavSyncStateV1): WebDavSyncStateV1 => {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const older = a.updatedAt >= b.updatedAt ? b : a;
  return {
    version: 1,
    updatedAt: newer.updatedAt,
    entries: {
      ...older.entries,
      ...newer.entries,
    },
  };
};

export const syncWebDavSelection = async (
  appService: AppService,
  profile: WebDavProfile,
  options: {
    books: Book[];
    includeBookFiles?: boolean;
    includeConfig?: boolean;
    includeCovers?: boolean;
    includeLibrary?: boolean;
    dryRun?: boolean;
  },
  callbacks?: SyncCallbacks,
  control?: SyncControl,
): Promise<{ conflicts: WebDavConflictItem[] }> => {
  const client = new WebDavClient({
    serverUrl: profile.serverUrl,
    rootPath: profile.remotePath,
    username: profile.username,
    password: profile.password,
    allowInsecureTls: profile.allowInsecureTls,
    allowInsecureHttp: profile.allowInsecureHttp,
  });

  await ensureRemoteRoot(client);

  const localState = await readLocalState(appService);
  const remoteState = await readRemoteState(client);
  const state = mergeStates(localState, remoteState);

  const includeLibrary = options.includeLibrary ?? true;
  const includeBookFiles = options.includeBookFiles ?? true;
  const includeConfig = options.includeConfig ?? true;
  const includeCovers = options.includeCovers ?? true;

  const items: Array<{
    key: string;
    localPath?: string;
    remotePath: string;
  }> = [];

  if (includeLibrary) {
    items.push({
      key: 'Books/library.json',
      localPath: getLocalLibraryPath(),
      remotePath: getRemoteLibraryPath(),
    });
  }

  for (const book of options.books) {
    const local = getLocalBookPaths(book);
    const remote = getRemoteBookPaths(book);
    if (includeBookFiles) {
      items.push({
        key: `Books/${local.bookFile}`,
        localPath: local.bookFile,
        remotePath: remote.bookFile,
      });
    }
    if (includeCovers) {
      items.push({
        key: `Books/${local.coverFile}`,
        localPath: local.coverFile,
        remotePath: remote.coverFile,
      });
    }
    if (includeConfig) {
      items.push({
        key: `Books/${local.configFile}`,
        localPath: local.configFile,
        remotePath: remote.configFile,
      });
    }
  }

  const progress: WebDavSyncProgress = { totalItems: items.length, completedItems: 0 };
  callbacks?.onProgress?.(progress);

  const log = (direction: 'upload' | 'download', path: string, status: WebDavSyncLogItem['status'], message?: string) => {
    callbacks?.onLog?.({
      id: uuidv4(),
      timestamp: Date.now(),
      direction,
      path,
      status,
      message,
    });
  };

  const conflicts: WebDavConflictItem[] = [];

  for (const item of items) {
    while (control?.shouldPause?.() && control?.waitUntilResumed) {
      await control.waitUntilResumed();
    }
    if (control?.shouldCancel?.()) break;

    progress.currentPath = item.key;
    callbacks?.onProgress?.({ ...progress });

    const baseEntry = state.entries[item.key] ?? {};
    const localFingerprint = item.localPath
      ? await computeLocalFingerprint(appService, item.localPath, 'Books')
      : null;

    const remoteList = await client.propfind(item.remotePath, { depth: '0' });
    const remoteResource = remoteList.ok ? remoteList.data?.find((r) => r.path !== '/' ) : undefined;
    const remoteFingerprint = remoteResource
      ? {
          etag: remoteResource.etag,
          lastModified: remoteResource.lastModified,
          size: remoteResource.contentLength,
        }
      : undefined;

    const localExists = !!localFingerprint;
    const remoteExists = !!remoteResource;

    const localChanged = localExists && !areLocalFingerprintsEqual(localFingerprint, baseEntry.local);
    const remoteChanged = remoteExists && !areRemoteFingerprintsEqual(remoteFingerprint, baseEntry.remote);

    if (localChanged && remoteChanged) {
      const conflict: WebDavConflictItem = {
        path: item.key,
        local: localFingerprint ?? undefined,
        remote: remoteFingerprint,
      };
      if (profile.conflictStrategy === 'manual') {
        conflicts.push(conflict);
        log('download', item.key, 'conflict', '检测到冲突');
        progress.completedItems += 1;
        callbacks?.onProgress?.({ ...progress });
        continue;
      }

      const winner =
        profile.conflictStrategy === 'local'
          ? 'local'
          : profile.conflictStrategy === 'remote'
            ? 'remote'
            : pickNewestSide(conflict);

      if (winner === 'remote') {
        await ensureRemoteDirsForFile(client, item.remotePath);
        if (!options.dryRun) {
          const res = await client.get(item.remotePath);
          if (!res.ok || !res.data) {
            log('download', item.key, 'failed', res.error || '下载失败');
          } else {
            const dirPath = item.localPath!.split('/').slice(0, -1).join('/');
            if (dirPath) {
              await appService.createDir(dirPath, 'Books', true).catch(() => {});
            }
            await appService.writeFile(item.localPath!, 'Books', res.data);
            log('download', item.key, 'completed');
          }
        } else {
          log('download', item.key, 'skipped', '模拟执行');
        }
      } else {
        await ensureRemoteDirsForFile(client, item.remotePath);
        if (!options.dryRun) {
          const data = (await appService.readFile(item.localPath!, 'Books', isJsonPath(item.localPath!) ? 'text' : 'binary')) as
            | string
            | ArrayBuffer;
          const body = typeof data === 'string' ? new TextEncoder().encode(data) : data;
          const res = await client.put(item.remotePath, body, {
            contentType: isJsonPath(item.localPath!) ? 'application/json; charset=utf-8' : undefined,
          });
          log('upload', item.key, res.ok ? 'completed' : 'failed', res.ok ? undefined : res.error || '上传失败');
        } else {
          log('upload', item.key, 'skipped', '模拟执行');
        }
      }
    } else if (localExists && !remoteExists) {
      progress.currentDirection = 'upload';
      callbacks?.onProgress?.({ ...progress });
      await ensureRemoteDirsForFile(client, item.remotePath);
      if (!options.dryRun) {
        const data = (await appService.readFile(item.localPath!, 'Books', isJsonPath(item.localPath!) ? 'text' : 'binary')) as
          | string
          | ArrayBuffer;
        const body = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const res = await client.put(item.remotePath, body, {
          contentType: isJsonPath(item.localPath!) ? 'application/json; charset=utf-8' : undefined,
        });
        log('upload', item.key, res.ok ? 'completed' : 'failed', res.ok ? undefined : res.error || '上传失败');
      } else {
        log('upload', item.key, 'skipped', '模拟执行');
      }
    } else if (!localExists && remoteExists) {
      progress.currentDirection = 'download';
      callbacks?.onProgress?.({ ...progress });
      if (!options.dryRun) {
        const res = await client.get(item.remotePath);
        if (!res.ok || !res.data) {
          log('download', item.key, 'failed', res.error || '下载失败');
        } else {
          if (item.localPath) {
            const dirPath = item.localPath.split('/').slice(0, -1).join('/');
            if (dirPath) {
              await appService.createDir(dirPath, 'Books', true).catch(() => {});
            }
            await appService.writeFile(item.localPath, 'Books', res.data);
          }
          log('download', item.key, 'completed');
        }
      } else {
        log('download', item.key, 'skipped', '模拟执行');
      }
    } else if (localChanged && !remoteChanged) {
      progress.currentDirection = 'upload';
      callbacks?.onProgress?.({ ...progress });
      await ensureRemoteDirsForFile(client, item.remotePath);
      if (!options.dryRun) {
        const data = (await appService.readFile(item.localPath!, 'Books', isJsonPath(item.localPath!) ? 'text' : 'binary')) as
          | string
          | ArrayBuffer;
        const body = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const res = await client.put(item.remotePath, body, {
          contentType: isJsonPath(item.localPath!) ? 'application/json; charset=utf-8' : undefined,
        });
        log('upload', item.key, res.ok ? 'completed' : 'failed', res.ok ? undefined : res.error || '上传失败');
      } else {
        log('upload', item.key, 'skipped', '模拟执行');
      }
    } else if (!localChanged && remoteChanged) {
      progress.currentDirection = 'download';
      callbacks?.onProgress?.({ ...progress });
      if (!options.dryRun) {
        const res = await client.get(item.remotePath);
        if (!res.ok || !res.data) {
          log('download', item.key, 'failed', res.error || '下载失败');
        } else {
          const dirPath = item.localPath!.split('/').slice(0, -1).join('/');
          if (dirPath) {
            await appService.createDir(dirPath, 'Books', true).catch(() => {});
          }
          await appService.writeFile(item.localPath!, 'Books', res.data);
          log('download', item.key, 'completed');
        }
      } else {
        log('download', item.key, 'skipped', '模拟执行');
      }
    } else {
      log('upload', item.key, 'skipped', '无需同步');
    }

    const updatedEntry: WebDavSyncStateEntry = {
      local: localFingerprint ?? baseEntry.local,
      remote: remoteFingerprint ?? baseEntry.remote,
    };
    state.entries[item.key] = updatedEntry;
    state.updatedAt = Date.now();

    progress.completedItems += 1;
    callbacks?.onProgress?.({ ...progress });
  }

  if (!options.dryRun) {
    await writeLocalState(appService, state);
    await writeRemoteState(client, state);
  }

  return { conflicts };
};

const isJsonPath = (path: string): boolean => {
  return path.toLowerCase().endsWith('.json');
};
