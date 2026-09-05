import { WebDavConflictItem } from '../models';

/**
 * 合并两轮同步产生的冲突列表（Part 4.4）：同 (profileId, path) 的新检测结果
 * 覆盖旧条目，其余保留。手动同步只覆盖部分条目，直接整体替换会把未扫描条目
 * 的既有冲突"清空"（用户看起来冲突消失、实则未解决，下一轮全量同步又复现）。
 * 键必须含 profileId：不同 profile（不同服务器）的同路径条目互不覆盖，
 * 否则合并会把冲突归到错误的 profile 上。
 */
const conflictKey = (conflict: WebDavConflictItem) =>
  // \u0000 不会出现在 profile id 与相对文件路径中，避免拼接歧义
  `${conflict.profileId}\u0000${conflict.path}`;

export const mergeWebDavConflictLists = (
  existing: WebDavConflictItem[],
  incoming: WebDavConflictItem[],
): WebDavConflictItem[] => {
  const byKey = new Map(existing.map((conflict) => [conflictKey(conflict), conflict]));
  for (const conflict of incoming) {
    byKey.set(conflictKey(conflict), conflict);
  }
  return [...byKey.values()];
};

/**
 * 双方 JSON 差异摘要（Part 4.4 内容合并预览的简版）：结构化输出两端的
 * 差异类别，由 UI 决定文案与语言。数组按记录 id（hash/id）对齐，对象按
 * 顶层字段对齐；解析失败返回 null（二进制/损坏内容不可预览）。
 */
export type WebDavJsonDiffSummary = {
  /** 差异为空的条目清单（record-list 为 id 值，object 为字段名） */
  onlyInLocal: string[];
  onlyInRemote: string[];
  changed: string[];
  localCount?: number;
  remoteCount?: number;
  /** 列表过长时被省略的条数 */
  truncated: number;
};

const JSON_DIFF_MAX_ENTRIES = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const collectIds = (value: unknown, idKeys: string[]): Map<string, unknown> | null => {
  if (!Array.isArray(value)) return null;
  const map = new Map<string, unknown>();
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = idKeys.map((key) => item[key]).find((v) => typeof v === 'string' && !!v.trim());
    if (typeof id !== 'string') return null;
    map.set(id, item);
  }
  return map;
};

const truncate = (entries: string[]): { entries: string[]; truncated: number } => {
  if (entries.length <= JSON_DIFF_MAX_ENTRIES) return { entries, truncated: 0 };
  return { entries: entries.slice(0, JSON_DIFF_MAX_ENTRIES), truncated: entries.length - JSON_DIFF_MAX_ENTRIES };
};

export const summarizeJsonDiff = (
  localText: string,
  remoteText: string,
): WebDavJsonDiffSummary | null => {
  let local: unknown;
  let remote: unknown;
  try {
    local = JSON.parse(localText) as unknown;
    remote = JSON.parse(remoteText) as unknown;
  } catch {
    return null;
  }

  // 记录数组（library.json 按 hash、booknotes 按 id）按 id 对齐比较
  for (const idKeys of [['hash'], ['id']]) {
    const localMap = collectIds(local, idKeys);
    const remoteMap = collectIds(remote, idKeys);
    if (localMap && remoteMap) {
      const onlyInLocal = [...localMap.keys()].filter((id) => !remoteMap.has(id)).sort();
      const onlyInRemote = [...remoteMap.keys()].filter((id) => !localMap.has(id)).sort();
      const changed = [...localMap.keys()].filter(
        (id) => remoteMap.has(id) && JSON.stringify(localMap.get(id)) !== JSON.stringify(remoteMap.get(id)),
      );
      const truncatedOnlyLocal = truncate(onlyInLocal);
      const truncatedOnlyRemote = truncate(onlyInRemote);
      const truncatedChanged = truncate(changed);
      return {
        onlyInLocal: truncatedOnlyLocal.entries,
        onlyInRemote: truncatedOnlyRemote.entries,
        changed: truncatedChanged.entries,
        localCount: localMap.size,
        remoteCount: remoteMap.size,
        truncated: truncatedOnlyLocal.truncated + truncatedOnlyRemote.truncated + truncatedChanged.truncated,
      };
    }
  }

  if (isRecord(local) && isRecord(remote)) {
    const localKeys = new Set(Object.keys(local));
    const remoteKeys = new Set(Object.keys(remote));
    const onlyInLocal = [...localKeys].filter((key) => !remoteKeys.has(key)).sort();
    const onlyInRemote = [...remoteKeys].filter((key) => !localKeys.has(key)).sort();
    const changed = [...localKeys].filter(
      (key) => remoteKeys.has(key) && JSON.stringify(local[key]) !== JSON.stringify(remote[key]),
    );
    const truncatedOnlyLocal = truncate(onlyInLocal);
    const truncatedOnlyRemote = truncate(onlyInRemote);
    const truncatedChanged = truncate(changed);
    return {
      onlyInLocal: truncatedOnlyLocal.entries,
      onlyInRemote: truncatedOnlyRemote.entries,
      changed: truncatedChanged.entries,
      truncated: truncatedOnlyLocal.truncated + truncatedOnlyRemote.truncated + truncatedChanged.truncated,
    };
  }

  return null;
};
