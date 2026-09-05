export type WebDavConflictResolutionStrategy = 'newest' | 'local' | 'remote' | 'manual';

export interface WebDavProfile {
  id: string;
  name: string;
  serverUrl: string;
  remotePath: string;
  username: string;
  password: string;
  allowInsecureHttp?: boolean;
  allowInsecureTls?: boolean;
  conflictStrategy: WebDavConflictResolutionStrategy;
  lastSyncAt?: number;
}

export type WebDavSyncDirection = 'upload' | 'download';

export type WebDavSyncItemStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'conflict';

export interface WebDavSyncLogItem {
  id: string;
  timestamp: number;
  direction: WebDavSyncDirection;
  path: string;
  status: WebDavSyncItemStatus;
  message?: string;
}

export interface WebDavSyncProgress {
  totalItems: number;
  completedItems: number;
  failedItems?: number;
  currentPath?: string;
  currentDirection?: WebDavSyncDirection;
}

export interface WebDavConflictItem {
  /**
   * 产生该冲突的 profile：resolve/查看差异用当前 profile 的服务器与凭据
   * 收敛冲突，跨 profile 条目若混入会把本地内容上传到错误的服务器。
   * 由引擎检出冲突时填充（syncWebDavSelection 是 Runner 与手动窗口的
   * 共同检出点）。
   */
  profileId: string;
  path: string;
  local?: {
    size?: number;
    md5?: string;
    observedAt?: number;
  };
  remote?: {
    etag?: string;
    lastModified?: string;
    size?: number;
  };
}
