export interface WebDavSyncStateFileFingerprint {
  size?: number;
  md5?: string;
  observedAt?: number;
}

export interface WebDavSyncStateRemoteFingerprint {
  etag?: string;
  lastModified?: string;
  size?: number;
}

export interface WebDavSyncStateEntry {
  local?: WebDavSyncStateFileFingerprint;
  remote?: WebDavSyncStateRemoteFingerprint;
}

export interface WebDavSyncStateV1 {
  version: 1;
  updatedAt: number;
  entries: Record<string, WebDavSyncStateEntry>;
}

export const createEmptyWebDavSyncState = (): WebDavSyncStateV1 => ({
  version: 1,
  updatedAt: Date.now(),
  entries: {},
});
