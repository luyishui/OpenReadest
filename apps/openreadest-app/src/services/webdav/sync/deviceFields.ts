// Part 4.3 stripDeviceLocalFields（隐私）：设备本地字段不出网。
// library.json 的条目可能携带"描述本设备副本"的字段（transient 导入的绝对
// 路径、blob 封面 URL、"本设备持有字节"时间戳）。它们随同步跨设备后，对端
// 会把外来路径当成自己的本地副本（book.filePath 的语义就是"本机文件"），
// 既泄漏设备路径，也可能让对端在"仅移除设备副本"后误判书籍丢失。
// 字段清单与上游 readest（sync/file/wire.ts DEVICE_LOCAL_BOOK_FIELDS）对齐；
// 其中 altFilePaths 本 fork 暂无，保留在清单中以兼容未来数据。
// 其余出网 JSON 已排查：config.json（进度/笔记/视图设置）与同步状态文件
// （相对路径键 + 指纹）均不含设备本地字段，无需剥离。

/** 描述"本设备副本"而非书籍本身的字段：绝不出网、也不从远端采纳。 */
export const DEVICE_LOCAL_BOOK_FIELDS = [
  'filePath',
  'altFilePaths',
  'coverImageUrl',
  'downloadedAt',
  'coverDownloadedAt',
] as const;

/** 剥离单个记录上的设备本地字段（就地缺字段时为 no-op，幂等）。 */
export const stripDeviceLocalFields = <T extends Record<string, unknown>>(record: T): T => {
  const copy = { ...record };
  for (const field of DEVICE_LOCAL_BOOK_FIELDS) {
    delete copy[field];
  }
  return copy;
};

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 递归剥离任意 JSON 值中的设备本地字段。剥离是确定性的（键序不变、
 * strip(strip(x)) === strip(x)），因此同一份数据剥离前后指纹稳定——
 * 本地指纹始终按原始文件计算，远端指纹来自剥离后内容的 ETag，二者分开
 * 记录，不会因剥离引入"每轮都误判变化"的重传抖动。
 */
export const stripDeviceLocalFieldsDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripDeviceLocalFieldsDeep);
  if (!isJsonRecord(value)) return value;
  const stripped = stripDeviceLocalFields(value);
  for (const [key, child] of Object.entries(stripped)) {
    stripped[key] = stripDeviceLocalFieldsDeep(child);
  }
  return stripped;
};

/**
 * 剥离 JSON 文本中的设备本地字段；解析失败时原样返回（由调用方的
 * 合并/校验路径报错，剥离不吞掉畸形数据）。
 */
export const stripDeviceLocalFieldsFromJsonText = (text: string): string => {
  try {
    return JSON.stringify(stripDeviceLocalFieldsDeep(JSON.parse(text) as unknown));
  } catch {
    return text;
  }
};
