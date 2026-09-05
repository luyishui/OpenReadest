export interface WebDavSyncStateFileFingerprint {
  size?: number;
  md5?: string;
  modifiedAt?: number;
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
  deletedAt?: number;
  updatedAt?: number;
  /**
   * 最近一次对远端实际探测（PROPFIND）的时间戳（毫秒）。
   * 用于增量短路的兜底：条目在此时间窗内可信任缓存的 remote 指纹而跳过
   * PROPFIND；超过窗口后强制重新探测，保证远端被其他设备改动时可被检测。
   * 旧数据缺省 → 视为从未探测（首轮全量 PROPFIND），安全兼容。
   */
  remoteProbeAt?: number;
}

export interface WebDavSyncStateV1 {
  version: 1;
  updatedAt: number;
  entries: Record<string, WebDavSyncStateEntry>;
}

export const createEmptyWebDavSyncState = (): WebDavSyncStateV1 => ({
  version: 1,
  // 0 so an empty fallback state never wins the merge against a real synced state
  updatedAt: 0,
  entries: {},
});

const getEntryUpdatedAt = (entry: WebDavSyncStateEntry, stateUpdatedAt: number): number => {
  return Math.max(entry.updatedAt ?? stateUpdatedAt, entry.deletedAt ?? 0);
};

export const mergeWebDavSyncStates = (
  a: WebDavSyncStateV1,
  b: WebDavSyncStateV1,
): WebDavSyncStateV1 => {
  const entries: Record<string, WebDavSyncStateEntry> = {};
  const keys = new Set([...Object.keys(a.entries), ...Object.keys(b.entries)]);

  for (const key of keys) {
    const aEntry = a.entries[key];
    const bEntry = b.entries[key];
    if (!aEntry) {
      entries[key] = bEntry!;
      continue;
    }
    if (!bEntry) {
      entries[key] = aEntry;
      continue;
    }

    const aUpdatedAt = getEntryUpdatedAt(aEntry, a.updatedAt);
    const bUpdatedAt = getEntryUpdatedAt(bEntry, b.updatedAt);
    if (aUpdatedAt === bUpdatedAt) {
      entries[key] = bEntry.deletedAt && !aEntry.deletedAt ? bEntry : aEntry;
    } else {
      entries[key] = aUpdatedAt > bUpdatedAt ? aEntry : bEntry;
    }
  }

  return {
    version: 1,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    entries,
  };
};
