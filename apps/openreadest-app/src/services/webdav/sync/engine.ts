import { v4 as uuidv4 } from 'uuid';
import { AppService } from '@/types/system';
import { Book } from '@/types/book';
import { isTauriAppPlatform } from '@/services/environment';
import { WebDavClient } from '../client/WebDavClient';
import {
  WebDavProfile,
  WebDavConflictItem,
  WebDavSyncLogItem,
  WebDavSyncProgress,
} from '../models';
import { computeLocalFingerprint, LocalFingerprint } from './fingerprint';
import { mergeWebDavJsonContent } from './contentMerge';
import { stripDeviceLocalFieldsFromJsonText } from './deviceFields';
import {
  createEmptyWebDavSyncState,
  mergeWebDavSyncStates,
  WebDavSyncStateEntry,
  WebDavSyncStateRemoteFingerprint,
  WebDavSyncStateV1,
} from './state';
import {
  getLocalSyncStatePath,
  getRemoteBookPaths,
  getRemoteLibraryPath,
  getRemoteSyncStatePath,
  getLocalBookPaths,
  getLocalLibraryPath,
  READEST_WEBDAV_BOOKS_DIR,
  READEST_WEBDAV_ROOT_DIRNAME,
  READEST_WEBDAV_SYSTEM_DIR,
} from './paths';

type SyncCallbacks = {
  onProgress?: (progress: WebDavSyncProgress) => void;
  onLog?: (log: WebDavSyncLogItem) => void;
};

type SyncControl = {
  shouldPause?: () => boolean;
  waitUntilResumed?: () => Promise<void>;
  shouldCancel?: () => boolean;
};

/**
 * 远端探测（PROPFIND）的兜底间隔。
 * 增量短路：对"本地未变且远端指纹已知"的条目，在 remoteProbeAt 之后的时间窗内
 * 跳过 PROPFIND，直接信任状态里缓存的远端指纹；超过窗口后强制重新探测，
 * 保证远端被其他设备/外部工具改动时仍可被检测（检测延迟 ≤ 本间隔）。
 * 0 表示关闭短路（每轮全量探测），测试与手动严格场景可用。
 */
export const DEFAULT_REMOTE_PROBE_INTERVAL_MS = 30 * 60 * 1000;

const normalizeEtag = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const normalized = value.replace(/^W\//, '').replace(/^"|"$/g, '');
  return normalized || undefined;
};

// RFC 7232：If-Match 必须携带带双引号的强 ETag（如 "abc123"）。服务器下发的
// ETag（PROPFIND getetag / PUT 响应头）经解析归一后是裸值，历史状态文件里存
// 的也可能是裸值；已含引号则原样使用，否则包上引号。真实服务器把 ETag 当
// 不透明字符串比较，发送裸值在严格校验的服务器上会失败。
const formatIfMatch = (etag?: string | null): string | undefined => {
  if (!etag) return undefined;
  return /^".*"$/s.test(etag) ? etag : `"${etag}"`;
};

const safeJsonParse = <T>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

// 进程级"远端目录已确保存在"缓存：避免每轮对每个书目目录重复 MKCOL
//（真实服务器对已存在目录返回 405，客户端视为成功——但每轮 N×3 次往返
// 与 PROPFIND 同量级，是网络大头之一）。按 服务器+根路径+目录 维度缓存，
// 仅在 mkcol 成功（含 405=已存在）后写入；远端目录被整体删除时，后续
// PUT 会失败并上报（失败可见），不再依赖 MKCOL 隐式自愈。
const ensuredRemoteDirs = new Set<string>();
const remoteDirCacheKey = (profile: WebDavProfile, dir: string) =>
  `${profile.serverUrl}|${profile.remotePath ?? ''}|${dir}`;

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

const ensureRemoteDirsForFile = async (
  client: WebDavClient,
  profile: WebDavProfile,
  remoteFilePath: string,
) => {
  const parts = remoteFilePath.split('/').filter(Boolean);
  if (parts.length <= 1) return;
  const dirs = parts.slice(0, -1);
  let current = '';
  for (const dir of dirs) {
    current = current ? `${current}/${dir}` : dir;
    const cacheKey = remoteDirCacheKey(profile, `/${current}`);
    if (ensuredRemoteDirs.has(cacheKey)) continue;
    const result = await client.mkcol(`/${current}`);
    if (result.ok || result.status === 405) ensuredRemoteDirs.add(cacheKey);
  }
};

const ensureRemoteRoot = async (client: WebDavClient, profile: WebDavProfile) => {
  for (const dir of [
    `/${READEST_WEBDAV_ROOT_DIRNAME}`,
    `/${READEST_WEBDAV_BOOKS_DIR}`,
    `/${READEST_WEBDAV_SYSTEM_DIR}`,
  ]) {
    const cacheKey = remoteDirCacheKey(profile, dir);
    if (ensuredRemoteDirs.has(cacheKey)) continue;
    const result = await client.mkcol(dir);
    if (result.ok || result.status === 405) ensuredRemoteDirs.add(cacheKey);
  }
};

const uploadLocalFile = async (
  client: WebDavClient,
  appService: AppService,
  localPath: string,
  remotePath: string,
  options?: { ifMatch?: string },
) => {
  if (!isJsonPath(localPath) && isTauriAppPlatform()) {
    // 原生流式上传不支持 If-Match（tauriUpload 无条件头通道）；条件覆盖由
    // JSON/内存路径承担，流式路径仅用于非 JSON 书文件（不需要 If-Match 语义）。
    const absolutePath = await appService.resolveFilePath(localPath, 'Books');
    return client.putFileFromPath(remotePath, absolutePath);
  }

  const data = (await appService.readFile(
    localPath,
    'Books',
    isJsonPath(localPath) ? 'text' : 'binary',
  )) as string | ArrayBuffer;
  if (typeof data === 'string') {
    // Part 4.3：JSON 出网前剥离设备本地字段（filePath 等不出网）。本地指纹
    // 始终按原始文件计算，远端指纹来自剥离后内容的 ETag，二者分开记录，
    // 剥离不会引入重传抖动。注意按远端路径判定 library.json（本地路径是
    // 相对 Books 目录的裸文件名，不含 Books/ 前缀）。
    const body = new TextEncoder().encode(stripSyncJson(remotePath, data));
    return client.put(remotePath, body, {
      contentType: 'application/json; charset=utf-8',
      ifMatch: options?.ifMatch,
    });
  }
  return client.put(remotePath, data);
};

const downloadRemoteFile = async (
  client: WebDavClient,
  appService: AppService,
  localPath: string,
  remotePath: string,
) => {
  const dirPath = localPath.split('/').slice(0, -1).join('/');
  if (dirPath) {
    await appService.createDir(dirPath, 'Books', true).catch(() => {});
  }

  if (!isJsonPath(localPath) && isTauriAppPlatform()) {
    const absolutePath = await appService.resolveFilePath(localPath, 'Books');
    return client.getFileToPath(remotePath, absolutePath);
  }

  const res = await client.get(remotePath);
  if (!res.ok || !res.data) return res;
  let content: string | ArrayBuffer = res.data;
  if (isJsonPath(localPath)) {
    // Part 4.3：远端 JSON 落地前剥离设备残留字段——旧远端数据可能携带
    // 其他设备的 filePath，不能把 A 设备的本地路径写进 B 设备。
    // （按远端路径判定 library.json，本地是裸文件名，见 uploadLocalFile。）
    content = stripSyncJson(remotePath, new TextDecoder().decode(res.data));
  }
  await appService.writeFile(localPath, 'Books', content);
  return { ok: true, status: res.status, headers: res.headers };
};

/**
 * 远端探测结果的三态语义：found / missing / unknown。
 * 仅 404/410（或明确 not found）才可判定"远端不存在"；网络失败、5xx、
 * 认证失败、超时等一律按 unknown 处理——把瞬时故障误判为"远端不存在"
 * 会触发本地删除并写墓碑（与 P1-2 本地读失败判定同族语义，数据安全优先）。
 */
type RemoteProbeResult =
  | { kind: 'missing' }
  | { kind: 'found'; fingerprint: WebDavSyncStateRemoteFingerprint }
  | { kind: 'unknown'; status?: number; error?: string };

const NOT_FOUND_STATUSES = new Set([404, 410]);

const readRemoteFingerprint = async (
  client: WebDavClient,
  remotePath: string,
): Promise<RemoteProbeResult> => {
  let remoteList;
  try {
    remoteList = await client.propfind(remotePath, { depth: '0' });
  } catch (error) {
    // 客户端通常把网络错误折叠为 ok:false（status 0），这里兜底防御
    return { kind: 'unknown', error: (error as Error).message || '远端探测失败' };
  }
  if (!remoteList.ok) {
    if (NOT_FOUND_STATUSES.has(remoteList.status)) return { kind: 'missing' };
    return { kind: 'unknown', status: remoteList.status, error: remoteList.error };
  }
  const resource = remoteList.data?.find((item) => !item.isCollection);
  return resource
    ? {
        kind: 'found',
        fingerprint: {
          etag: resource.etag,
          lastModified: resource.lastModified,
          size: resource.contentLength,
        },
      }
    : { kind: 'missing' };
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

/**
 * 远端同步状态读取结果的三态语义：
 * - unknown=false：读到了合法的 v1 状态，或远端确实还没有状态文件
 *   （404/410 = 合法空状态）；
 * - unknown=true：GET 网络失败/5xx/认证失败，以及 200 但响应体为空（传输
 *   截断/存储损坏）、JSON 损坏、版本不兼容（未来版本客户端写入）——本轮对
 *   远端已有状态一无所知。
 * 把未知失败或损坏状态误判为空状态会让 stateDirty 恒真，末轮把 local-only
 * 状态写回远端，其他设备的指纹/墓碑全部丢失（与 readRemoteFingerprint 的
 * "探测失败 ≠ 远端不存在"同族语义，数据安全优先）。
 */
type RemoteStateReadResult = {
  state: WebDavSyncStateV1;
  unknown: boolean;
  status?: number;
  error?: string;
};

const readRemoteState = async (client: WebDavClient): Promise<RemoteStateReadResult> => {
  const res = await client.get(getRemoteSyncStatePath());
  if (!res.ok) {
    if (NOT_FOUND_STATUSES.has(res.status)) {
      return { state: createEmptyWebDavSyncState(), unknown: false };
    }
    return {
      state: createEmptyWebDavSyncState(),
      unknown: true,
      status: res.status,
      error: res.error,
    };
  }
  if (!res.data) {
    // 200 但响应体为空（传输截断/存储损坏）：不是合法空状态——按 unknown
    // 处理，本轮不回写同步状态。只有 404/410 才是合法空状态（见上）。
    return {
      state: createEmptyWebDavSyncState(),
      unknown: true,
      error: '远端同步状态文件为空',
    };
  }
  const text = new TextDecoder().decode(res.data);
  const parsed = safeJsonParse<WebDavSyncStateV1>(text);
  if (!parsed || parsed.version !== 1) {
    // 200 但 JSON 损坏或版本不兼容（未来版本客户端写入的状态）：覆写会清掉
    // 其他设备的指纹/墓碑，按 unknown 处理（复用既有的"本轮不回写"链路）。
    return {
      state: createEmptyWebDavSyncState(),
      unknown: true,
      error: '远端同步状态文件损坏或版本不兼容',
    };
  }
  return { state: parsed, unknown: false };
};

const writeRemoteState = async (
  client: WebDavClient,
  profile: WebDavProfile,
  state: WebDavSyncStateV1,
) => {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  await ensureRemoteDirsForFile(client, profile, getRemoteSyncStatePath());
  return client.put(getRemoteSyncStatePath(), bytes, {
    contentType: 'application/json; charset=utf-8',
  });
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
    /**
     * 远端探测兜底间隔（毫秒）。默认 DEFAULT_REMOTE_PROBE_INTERVAL_MS（30 分钟）；
     * 传 0 关闭增量短路（每轮都对每个条目 PROPFIND）。见
     * DEFAULT_REMOTE_PROBE_INTERVAL_MS 的说明。
     */
    remoteProbeIntervalMs?: number;
  },
  callbacks?: SyncCallbacks,
  control?: SyncControl,
): Promise<{ conflicts: WebDavConflictItem[]; failures: WebDavSyncLogItem[] }> => {
  const client = new WebDavClient({
    serverUrl: profile.serverUrl,
    rootPath: profile.remotePath,
    username: profile.username,
    password: profile.password,
    allowInsecureTls: profile.allowInsecureTls,
    allowInsecureHttp: profile.allowInsecureHttp,
  });

  await ensureRemoteRoot(client, profile);

  const localState = await readLocalState(appService);
  const remoteStateRead = await readRemoteState(client);
  const remoteState = remoteStateRead.state;
  const state = mergeWebDavSyncStates(localState, remoteState);

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

  const progress: WebDavSyncProgress = {
    totalItems: items.length,
    completedItems: 0,
    failedItems: 0,
  };
  callbacks?.onProgress?.(progress);

  const conflicts: WebDavConflictItem[] = [];
  const failures: WebDavSyncLogItem[] = [];
  const log = (
    direction: 'upload' | 'download',
    path: string,
    status: WebDavSyncLogItem['status'],
    message?: string,
  ) => {
    const item = {
      id: uuidv4(),
      timestamp: Date.now(),
      direction,
      path,
      status,
      message,
    };
    if (status === 'failed') {
      failures.push(item);
      progress.failedItems = (progress.failedItems ?? 0) + 1;
    }
    callbacks?.onLog?.(item);
  };

  // 远端状态读取失败（非 404）：本轮对远端已有状态一无所知。数据条目照常
  // 同步（每条有各自的探测容错），但状态持久化在末轮整体跳过——见函数尾部。
  if (remoteStateRead.unknown) {
    log(
      'download',
      getRemoteSyncStatePath(),
      'failed',
      `读取远端同步状态失败（${remoteStateRead.status || remoteStateRead.error || '未知错误'}），本轮不回写同步状态`,
    );
  }

  let stateDirty =
    JSON.stringify(state) !== JSON.stringify(localState) ||
    JSON.stringify(state) !== JSON.stringify(remoteState);

  if (!options.dryRun) {
    // 墓碑清理的作用域：墓碑可经共享状态文件（webdav-sync-state.json）到达
    // 从未做过全量同步的设备——该设备的本地 library.json 尚未墓碑化。此时若
    // 按全量 entries 清理，一次"只勾选部分书籍"的手动同步就会物理删除未选中
    // 书籍的本地文件，而 library.json 未同步更新 → 书架出现死链（点开报错），
    // 直到下次全量同步才自愈。因此非全量同步（includeLibrary:false）把清理
    // 限制在本次同步条目集合内：选中的书自身带墓碑照常应用删除；未选中条目
    // 的删除传播延迟到下一次全量同步，与 library.json 的收口保持原子。
    // 全量同步（includeLibrary:true）保持全局清理不变。
    // （resolveWebDavConflicts 不经过本循环，无此问题。）
    const selectedKeys = new Set(items.map((i) => i.key));
    for (const [key, entry] of Object.entries(state.entries)) {
      if (!entry.deletedAt || !key.startsWith('Books/')) continue;
      if (!includeLibrary && !selectedKeys.has(key)) continue;
      const localPath = key.slice('Books/'.length);

      // 本地存在时区分"删除前的旧文件"与"删除后重新导入的文件"：
      // - 文件修改时间晚于墓碑时间 → 重新导入 → 复活（清除墓碑，让正常流程重新上传）
      // - 无法获取修改时间（web 平台/JSON 文件）或读取失败（IO 抖动）→ 保守复活，
      //   宁可保留本地文件也不误删（数据安全优先）
      let localFingerprint: LocalFingerprint | null = null;
      try {
        localFingerprint = await computeLocalFingerprint(appService, localPath, 'Books');
      } catch {
        localFingerprint = null;
      }
      const revived =
        !!localFingerprint &&
        (typeof localFingerprint.modifiedAt !== 'number' ||
          localFingerprint.modifiedAt > entry.deletedAt);
      if (revived) {
        delete state.entries[key];
        stateDirty = true;
        continue;
      }

      if (localFingerprint) {
        // 删除前的旧文件 → 应用删除
        try {
          await appService.deleteFile(localPath, 'Books');
          log('download', key, 'completed', '已应用远端删除墓碑');
        } catch (error) {
          log('download', key, 'failed', (error as Error).message || '本地删除失败');
          continue;
        }
      }

      const remoteDeletedAt = remoteState.entries[key]?.deletedAt ?? 0;
      if (remoteDeletedAt < entry.deletedAt) {
        const remotePath = `${READEST_WEBDAV_ROOT_DIRNAME}/${key}`;
        const remoteDelete = await client.delete(remotePath);
        if (!remoteDelete.ok && remoteDelete.status !== 404) {
          log('upload', key, 'failed', remoteDelete.error || '远端删除失败');
        }
      }
    }
  }

  for (const item of items) {
    while (
      control?.shouldPause?.() &&
      control?.waitUntilResumed &&
      !control?.shouldCancel?.()
    ) {
      await control.waitUntilResumed();
    }
    if (control?.shouldCancel?.()) break;

    progress.currentPath = item.key;
    callbacks?.onProgress?.({ ...progress });

    const baseEntry = state.entries[item.key] ?? {};
    let localFingerprint: LocalFingerprint | null = null;
    if (item.localPath) {
      try {
        localFingerprint = await computeLocalFingerprint(
          appService,
          item.localPath,
          'Books',
          baseEntry.local,
        );
      } catch {
        // 本地读取失败（IO 抖动/权限）：跳过该条目并保持状态不变，
        // 避免把瞬时故障误判为"本地删除"而删掉远端备份。
        log('upload', item.key, 'failed', '本地文件读取失败，已跳过本次同步');
        progress.completedItems += 1;
        callbacks?.onProgress?.({ ...progress });
        continue;
      }
    }
    const localExists = !!localFingerprint;
    const localChanged =
      localExists && !areLocalFingerprintsEqual(localFingerprint ?? undefined, baseEntry.local);

    // 增量短路：仅当"本地文件存在且自上次同步未变 + 远端指纹已知（上次完整同步
    // 验证过） + 条目无墓碑 + 远端在最近 remoteProbeAt 时间窗内被实际探测过"时，
    // 才可跳过本轮 PROPFIND，直接信任缓存的远端指纹。此时唯一可能的结论是
    // "无需同步"（远端变更的检测由时间窗外的强制探测兜底）；任何删除/冲突/
    // 传输判定路径都不走缓存，保证正确性（不引入"远端被改而本地无感知"的回归，
    // 仅在窗口内把检测延迟约束在时间窗内）。
    const probeIntervalMs = options.remoteProbeIntervalMs ?? DEFAULT_REMOTE_PROBE_INTERVAL_MS;
    const remoteProbeFresh =
      typeof baseEntry.remoteProbeAt === 'number' &&
      Date.now() - baseEntry.remoteProbeAt < probeIntervalMs;
    const canSkipRemoteProbe =
      !!localFingerprint &&
      !baseEntry.deletedAt &&
      !!baseEntry.remote &&
      !localChanged &&
      remoteProbeFresh;

    let remoteSnapshot: RemoteProbeResult;
    let remoteProbeAt: number | undefined;
    if (canSkipRemoteProbe) {
      remoteSnapshot = { kind: 'found', fingerprint: baseEntry.remote! };
    } else {
      remoteSnapshot = await readRemoteFingerprint(client, item.remotePath);
      if (remoteSnapshot.kind === 'unknown') {
        // 远端状态未知：跳过该条目的删除/覆盖/传输判定并记入 failures。
        // 绝不能按"远端不存在"继续——否则一次瞬时故障就会把未变化的本地
        // 文件当成"远端已删除"而删除本地并写墓碑，下一轮再把远端备份删掉。
        log(
          'download',
          item.key,
          'failed',
          `远端探测失败（${remoteSnapshot.error || remoteSnapshot.status || '未知错误'}），已跳过本次同步`,
        );
        progress.completedItems += 1;
        callbacks?.onProgress?.({ ...progress });
        continue;
      }
      remoteProbeAt = Date.now();
    }
    const remoteFingerprint = remoteSnapshot.kind === 'found' ? remoteSnapshot.fingerprint : undefined;
    const remoteExists = remoteSnapshot.kind === 'found';
    const remoteChanged =
      remoteExists && !areRemoteFingerprintsEqual(remoteFingerprint, baseEntry.remote);

    let completedTransfer: 'upload' | 'download' | 'merge' | null = null;
    let operationFailed = false;
    let deletionHandled = false;
    let lastUploadResponse:
      | { ok: boolean; status: number; headers: Headers; error?: string }
      | undefined;

    const upload = async () => {
      progress.currentDirection = 'upload';
      callbacks?.onProgress?.({ ...progress });
      if (options.dryRun) {
        log('upload', item.key, 'skipped', '模拟执行');
        return;
      }
      try {
        await ensureRemoteDirsForFile(client, profile, item.remotePath);
        const res = await uploadLocalFile(client, appService, item.localPath!, item.remotePath);
        lastUploadResponse = res;
        if (res.ok) {
          completedTransfer = 'upload';
          log('upload', item.key, 'completed');
        } else {
          operationFailed = true;
          log('upload', item.key, 'failed', res.error || '上传失败');
        }
      } catch (e) {
        operationFailed = true;
        log('upload', item.key, 'failed', (e as Error).message || '上传失败');
      }
    };

    const download = async () => {
      progress.currentDirection = 'download';
      callbacks?.onProgress?.({ ...progress });
      if (options.dryRun) {
        log('download', item.key, 'skipped', '模拟执行');
        return;
      }
      try {
        const res = await downloadRemoteFile(client, appService, item.localPath!, item.remotePath);
        if (!res.ok) {
          operationFailed = true;
          log('download', item.key, 'failed', res.error || '下载失败');
          return;
        }
        completedTransfer = 'download';
        log('download', item.key, 'completed');
      } catch (e) {
        operationFailed = true;
        log('download', item.key, 'failed', (e as Error).message || '下载失败');
      }
    };

    const mergeJson = async (): Promise<boolean> => {
      if (!item.localPath || !isJsonPath(item.localPath)) return false;
      if (options.dryRun) {
        log('upload', item.key, 'skipped', '模拟合并');
        return true;
      }
      try {
        const localText = (await appService.readFile(item.localPath, 'Books', 'text')) as string;
        const remoteResponse = await client.get(item.remotePath);
        if (!remoteResponse.ok || !remoteResponse.data) return false;
        // Part 4.3：合并前先剥离远端内容中的设备残留字段——旧远端数据可能
        // 携带其他设备的 filePath，不能经合并写进本设备；本地文本保持原样
        //（本设备自己的 filePath/downloadedAt 等字段要留在本地）。
        const remoteText = stripSyncJson(item.key, new TextDecoder().decode(remoteResponse.data));
        const merged = mergeWebDavJsonContent(item.key, localText, remoteText);
        if (!merged) return false;

        // 上传内容同样剥离（合并结果包含本地原始字段）；写入本地的是未
        // 剥离的合并结果。两条链路的指纹各自独立记录，无重传抖动。
        const uploadText = stripSyncJson(item.key, merged.text);
        const uploadResult = await client.put(
          item.remotePath,
          new TextEncoder().encode(uploadText),
          {
            contentType: 'application/json; charset=utf-8',
            ifMatch: formatIfMatch(remoteFingerprint?.etag),
          },
        );
        lastUploadResponse = uploadResult;
        if (!uploadResult.ok) {
          operationFailed = true;
          log('upload', item.key, 'failed', uploadResult.error || '合并上传失败');
          return true;
        }
        await appService.writeFile(item.localPath, 'Books', merged.text);
        completedTransfer = 'merge';
        log('upload', item.key, 'completed', '已合并两端内容');
        return true;
      } catch (error) {
        operationFailed = true;
        log('upload', item.key, 'failed', (error as Error).message || '内容合并失败');
        return true;
      }
    };

    const synchronizedBefore = !!baseEntry.local && !!baseEntry.remote && !baseEntry.deletedAt;
    const localDeletion =
      synchronizedBefore && !localExists && remoteExists && !remoteChanged;
    const remoteDeletion =
      synchronizedBefore && localExists && !remoteExists && !localChanged;
    const bothDeleted = synchronizedBefore && !localExists && !remoteExists;

    // 墓碑条目 + 本地文件存在时的复活判定（与墓碑循环一致）：
    // 墓碑循环读取瞬时失败（IO 抖动）或同步中途重新导入时，这里可能先于
    // 墓碑循环遇到带墓碑的条目——若不复活，tombstoneCleanup 会销毁
    // 重新导入的同 hash 文件。
    let tombstoneCleared = false;
    if (baseEntry.deletedAt && localExists) {
      const revived =
        typeof localFingerprint?.modifiedAt !== 'number' ||
        (localFingerprint?.modifiedAt ?? 0) > baseEntry.deletedAt;
      if (revived) {
        delete state.entries[item.key];
        stateDirty = true;
        tombstoneCleared = true;
      }
    }
    const tombstoneCleanup =
      !!baseEntry.deletedAt && !tombstoneCleared && (localExists || remoteExists);

    const markDeleted = async () => {
      if (options.dryRun) {
        log(localDeletion ? 'upload' : 'download', item.key, 'skipped', '模拟删除');
        deletionHandled = true;
        return;
      }
      try {
        if (localDeletion || (tombstoneCleanup && remoteExists)) {
          const result = await client.delete(item.remotePath);
          if (!result.ok && result.status !== 404) throw new Error(result.error || '远端删除失败');
          log('upload', item.key, 'completed', '已同步本地删除');
        }
        if ((remoteDeletion || (tombstoneCleanup && localExists)) && item.localPath) {
          await appService.deleteFile(item.localPath, 'Books');
          log('download', item.key, 'completed', '已同步远端删除');
        }
        const deletedAt = Date.now();
        state.entries[item.key] = { deletedAt, updatedAt: deletedAt };
        stateDirty = true;
        deletionHandled = true;
      } catch (error) {
        operationFailed = true;
        deletionHandled = true;
        log(
          localDeletion ? 'upload' : 'download',
          item.key,
          'failed',
          (error as Error).message || '删除同步失败',
        );
      }
    };

    if (localDeletion || remoteDeletion || bothDeleted || tombstoneCleanup) {
      await markDeleted();
    } else if (localChanged && remoteChanged) {
      const conflict: WebDavConflictItem = {
        // 冲突必须归属检出它的 profile：resolve 用该 profile 的服务器/凭据
        // 收敛，跨 profile 错配会把本地内容上传到错误的服务器。
        profileId: profile.id,
        path: item.key,
        local: localFingerprint ?? undefined,
        remote: remoteFingerprint,
      };
      const merged = await mergeJson();
      if (merged) {
        // JSON content was merged (or a merge attempt failed and was logged).
      } else if (profile.conflictStrategy === 'manual') {
        conflicts.push(conflict);
        log('download', item.key, 'conflict', '检测到冲突');
        progress.completedItems += 1;
        callbacks?.onProgress?.({ ...progress });
        continue;
      } else {
        const winner =
          profile.conflictStrategy === 'local'
            ? 'local'
            : profile.conflictStrategy === 'remote'
              ? 'remote'
              : pickNewestSide(conflict);
        await (winner === 'remote' ? download() : upload());
      }
    } else if (localExists && !remoteExists) {
      await upload();
    } else if (!localExists && remoteExists) {
      await download();
    } else if (localChanged && !remoteChanged) {
      await upload();
    } else if (!localChanged && remoteChanged) {
      if (isLibraryJsonItem(item.key)) {
        // library.json 是书库索引而非普通文件：远端变化时做内容级合并
        // （mergeWebDavJsonContent），而不是整体覆盖——既保留本地尚未
        // 同步的条目，也把远端墓碑（deletedAt）并入本地；同时防止远端
        // 索引回退（丢失已同步条目）导致本地数据丢失。
        const merged = await mergeJson();
        if (!merged) {
          // 远端读取失败或格式不兼容（无 hash 键/重复 hash）：保守跳过
          // 本轮，不用可能损坏的内容覆盖本地；下次同步自动重试。
          log('download', item.key, 'skipped', 'library.json 合并不可用，已跳过本轮');
        }
      } else {
        await download();
      }
    } else {
      log('upload', item.key, 'skipped', '无需同步');
    }

    if (!deletionHandled && !options.dryRun && !operationFailed && completedTransfer) {
      let nextLocal = localFingerprint ?? undefined;
      let nextRemote = remoteFingerprint;

      if (completedTransfer === 'upload' || completedTransfer === 'merge') {
        // 上传后验证（防假成功）：优先使用 PUT 响应头的 ETag——
        // 服务器返回 ETag 即确认资源已落盘为该实体，无需再 PROPFIND 一次；
        // 服务器未返回 ETag（或原生流式上传不携带响应头）时退回 PROPFIND 验证。
        const putEtag = normalizeEtag(lastUploadResponse?.headers.get('etag'));
        if (putEtag) {
          nextRemote = { etag: putEtag };
        } else {
          const uploadedRemote = await readRemoteFingerprint(client, item.remotePath);
          if (uploadedRemote.kind !== 'found' || !uploadedRemote.fingerprint) {
            operationFailed = true;
            log('upload', item.key, 'failed', '上传后无法验证远端文件');
          } else {
            nextRemote = uploadedRemote.fingerprint;
          }
        }
      }
      if (completedTransfer === 'download' || completedTransfer === 'merge') {
        try {
          nextLocal = item.localPath
            ? ((await computeLocalFingerprint(appService, item.localPath, 'Books')) ?? undefined)
            : undefined;
        } catch {
          nextLocal = undefined;
        }
        if (!nextLocal) {
          operationFailed = true;
          log('download', item.key, 'failed', '下载后无法验证本地文件');
        }
      }

      if (!operationFailed) {
        const updatedEntry: WebDavSyncStateEntry = {
          local: nextLocal,
          remote: nextRemote,
          updatedAt: Date.now(),
          remoteProbeAt: remoteProbeAt ?? Date.now(),
        };
        if (JSON.stringify(updatedEntry) !== JSON.stringify(baseEntry)) {
          state.entries[item.key] = updatedEntry;
          stateDirty = true;
        }
      }
    } else if (
      !options.dryRun &&
      !deletionHandled &&
      !operationFailed &&
      !completedTransfer &&
      remoteProbeAt
    ) {
      // 本轮做了远端探测但无需传输（保持同步）：只刷新探测时间戳，
      // 使后续轮次可命中增量短路；不改动 local/remote 指纹（探测结果
      // 与传输无关时不应覆盖缓存，避免掩盖远端变化信号）。
      const current = state.entries[item.key];
      if (current && (current.remoteProbeAt ?? 0) < remoteProbeAt) {
        state.entries[item.key] = { ...current, remoteProbeAt };
        stateDirty = true;
      }
    }

    progress.completedItems += 1;
    callbacks?.onProgress?.({ ...progress });
  }

  if (!options.dryRun && stateDirty) {
    if (remoteStateRead.unknown) {
      // 远端状态读取失败：本轮读到的"空状态"只是占位，stateDirty 必然为真，
      // 但此刻写回远端会把合并结果（local-only 状态）覆盖上去，清掉其他设备
      // 的指纹/墓碑。放弃本轮状态持久化（本地同样不写：它与"远端为空"的
      // 假设绑定，单独落盘会让下一轮的合并基准失真），下轮同步重新探测收敛；
      // 失败已在开头记入 failures。
    } else {
      state.updatedAt = Date.now();
      const remoteStateResult = await writeRemoteState(client, profile, state);
      if (!remoteStateResult.ok) {
        log(
          'upload',
          getRemoteSyncStatePath(),
          'failed',
          remoteStateResult.error || '写入远端同步状态失败',
        );
      } else {
        await writeLocalState(appService, state);
      }
    }
  }

  return { conflicts, failures };
};

const isJsonPath = (path: string): boolean => {
  return path.toLowerCase().endsWith('.json');
};

const isLibraryJsonItem = (path: string): boolean => {
  const normalized = path.replaceAll('\\', '/');
  return normalized === 'Books/library.json' || normalized.endsWith('/library.json');
};

// Part 4.3：设备本地字段剥离只作用于 library.json（出网索引）。其余出网
// JSON 已排查不含设备本地字段（见 deviceFields.ts 顶部说明），不做多余
// 的 parse/stringify。
const stripSyncJson = (path: string, text: string): string => {
  return isLibraryJsonItem(path) ? stripDeviceLocalFieldsFromJsonText(text) : text;
};

export type WebDavConflictResolution = {
  /** 同步条目键（与冲突项 path 一致，如 'Books/<hash>/config.json'） */
  path: string;
  keep: 'local' | 'remote';
};

export type WebDavConflictResolutionResult = WebDavConflictResolution & {
  ok: boolean;
  message?: string;
};

const resolveConflictItem = async (
  appService: AppService,
  client: WebDavClient,
  profile: WebDavProfile,
  state: WebDavSyncStateV1,
  resolution: WebDavConflictResolution,
): Promise<WebDavConflictResolutionResult> => {
  const fail = (message: string): WebDavConflictResolutionResult => ({
    ...resolution,
    ok: false,
    message,
  });

  if (!resolution.path.startsWith('Books/') || !resolution.path.slice('Books/'.length)) {
    return fail('不支持的冲突条目路径');
  }
  const localPath = resolution.path.slice('Books/'.length);
  const remotePath = `${READEST_WEBDAV_ROOT_DIRNAME}/${resolution.path}`;

  let localFingerprint: LocalFingerprint | null = null;
  try {
    localFingerprint = await computeLocalFingerprint(appService, localPath, 'Books');
  } catch (error) {
    return fail((error as Error).message || '本地文件读取失败');
  }
  const remoteProbe = await readRemoteFingerprint(client, remotePath);
  if (remoteProbe.kind === 'unknown') {
    return fail(`远端探测失败（${remoteProbe.error || remoteProbe.status || '未知错误'}）`);
  }
  const remoteFingerprint =
    remoteProbe.kind === 'found' ? remoteProbe.fingerprint : undefined;

  // 收敛检查：两端指纹已与状态记录一致 → 冲突已被（可能在本轮解决前由
  // 其他设备）解决，无需再传输，直接视为已解决。
  const base = state.entries[resolution.path];
  if (
    localFingerprint &&
    remoteFingerprint &&
    areLocalFingerprintsEqual(localFingerprint, base?.local) &&
    areRemoteFingerprintsEqual(remoteFingerprint, base?.remote)
  ) {
    return { ...resolution, ok: true };
  }

  if (resolution.keep === 'local') {
    if (!localFingerprint) return fail('本地文件不存在，无法保留本地版本');
    await ensureRemoteDirsForFile(client, profile, remotePath);
    const put = await uploadLocalFile(client, appService, localPath, remotePath, {
      // If-Match 保护：远端在探测后被并发改动时拒绝覆盖（服务器不支持
      // If-Match 时忽略该头，退化为无条件覆盖，与旧行为一致）。
      ifMatch: formatIfMatch(remoteFingerprint?.etag),
    });
    if (!put.ok) return fail(put.error || '上传失败');
    const putEtag = normalizeEtag(put.headers.get('etag'));
    let nextRemote: WebDavSyncStateRemoteFingerprint | undefined = putEtag
      ? { etag: putEtag }
      : undefined;
    if (!nextRemote) {
      const verify = await readRemoteFingerprint(client, remotePath);
      if (verify.kind !== 'found') return fail('上传后无法验证远端文件');
      nextRemote = verify.fingerprint;
    }
    state.entries[resolution.path] = {
      local: localFingerprint,
      remote: nextRemote,
      updatedAt: Date.now(),
      remoteProbeAt: Date.now(),
    };
    return { ...resolution, ok: true };
  }

  if (remoteProbe.kind !== 'found') return fail('远端文件不存在，无法保留远端版本');
  const download = await downloadRemoteFile(client, appService, localPath, remotePath);
  if (!download.ok) return fail(download.error || '下载失败');
  let nextLocal: LocalFingerprint | undefined;
  try {
    nextLocal = (await computeLocalFingerprint(appService, localPath, 'Books')) ?? undefined;
  } catch {
    nextLocal = undefined;
  }
  if (!nextLocal) return fail('下载后无法验证本地文件');
  state.entries[resolution.path] = {
    local: nextLocal,
    remote: remoteProbe.fingerprint,
    updatedAt: Date.now(),
    remoteProbeAt: Date.now(),
  };
  return { ...resolution, ok: true };
};

/**
 * 手动冲突解决（Part 4.4）：对冲突条目执行用户选择的单向覆盖（保留本地 →
 * 上传本地内容；保留远端 → 下载远端内容），并把同步状态收敛为"两端一致"，
 * 使下一轮同步不再重复报告同一冲突（P2-5 收口：冲突从静默跳过变为可见可解）。
 * 只收敛指定条目、不跑全量同步；每条独立执行，单条失败不影响其余条目。
 */
export const resolveWebDavConflicts = async (
  appService: AppService,
  profile: WebDavProfile,
  resolutions: WebDavConflictResolution[],
): Promise<WebDavConflictResolutionResult[]> => {
  const client = new WebDavClient({
    serverUrl: profile.serverUrl,
    rootPath: profile.remotePath,
    username: profile.username,
    password: profile.password,
    allowInsecureTls: profile.allowInsecureTls,
    allowInsecureHttp: profile.allowInsecureHttp,
  });

  const localState = await readLocalState(appService);
  const remoteStateRead = await readRemoteState(client);
  const remoteState = remoteStateRead.state;
  const state = mergeWebDavSyncStates(localState, remoteState);
  const entriesBefore = JSON.stringify(state.entries);

  const results: WebDavConflictResolutionResult[] = [];
  for (const resolution of resolutions) {
    results.push(await resolveConflictItem(appService, client, profile, state, resolution));
  }

  if (JSON.stringify(state.entries) !== entriesBefore) {
    if (remoteStateRead.unknown) {
      // 读取远端状态失败（非 404）：本轮的合并状态建立在"远端为空"的占位
      // 假设上，写回会清掉其他设备的指纹/墓碑。与下方"写入状态失败"同语义：
      // 传输已生效但状态未收敛，如实上报失败（可重试，下一轮重新检出）。
      return results.map((r) =>
        r.ok ? { ...r, ok: false, message: '读取同步状态失败，请重试' } : r,
      );
    }
    state.updatedAt = Date.now();
    const remoteStateResult = await writeRemoteState(client, profile, state);
    if (!remoteStateResult.ok) {
      // 传输已生效但状态未持久化：下一轮同步会重新探测并可能再次报冲突
      // （可重试、无数据丢失）——如实上报而非谎报已收敛。
      return results.map((r) =>
        r.ok ? { ...r, ok: false, message: '写入同步状态失败，请重试' } : r,
      );
    }
    await writeLocalState(appService, state);
  }
  return results;
};
