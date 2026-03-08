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
  currentPath?: string;
  currentDirection?: WebDavSyncDirection;
}

export interface WebDavConflictItem {
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
