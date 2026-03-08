export const WEB_DAV_PROFILE_NAME_PATTERN = /^[\u4e00-\u9fffA-Za-z0-9_]{1,32}$/;

export const normalizeWebDavProfileName = (name: string) => name.trim();

export const isValidWebDavProfileName = (name: string) => {
  const normalized = normalizeWebDavProfileName(name);
  return WEB_DAV_PROFILE_NAME_PATTERN.test(normalized);
};

export const validateWebDavProfileName = (
  name: string,
  usedNames: string[],
  selfId: string | null,
  idToName: Record<string, string>,
) => {
  const normalized = normalizeWebDavProfileName(name);
  if (!normalized) return { ok: false as const, name: normalized, error: '备注名不能为空' };
  if (normalized.length > 32) return { ok: false as const, name: normalized, error: '备注名长度不能超过 32 个字符' };
  if (!WEB_DAV_PROFILE_NAME_PATTERN.test(normalized))
    return { ok: false as const, name: normalized, error: '备注名仅支持中文、英文、数字及下划线' };
  const duplicates = usedNames.filter((n) => n === normalized);
  const selfName = selfId ? idToName[selfId] : undefined;
  const isDuplicate = duplicates.length > 0 && normalized !== selfName;
  if (isDuplicate) return { ok: false as const, name: normalized, error: '备注名已存在' };
  return { ok: true as const, name: normalized };
};

export const getUniqueWebDavProfileName = (baseName: string, existingNames: string[]) => {
  const base = normalizeWebDavProfileName(baseName) || 'WebDAV';
  const used = new Set(existingNames);
  if (!used.has(base) && base.length <= 32 && WEB_DAV_PROFILE_NAME_PATTERN.test(base)) return base;
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${base}_${i}`;
    if (candidate.length > 32) continue;
    if (WEB_DAV_PROFILE_NAME_PATTERN.test(candidate) && !used.has(candidate)) return candidate;
  }
  return 'WebDAV';
};

