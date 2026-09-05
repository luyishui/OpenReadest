import { AppService, BaseDir } from '@/types/system';
import { stat } from '@tauri-apps/plugin-fs';
import { md5, partialMD5 } from '@/utils/md5';
import { isTauriAppPlatform } from '@/services/environment';

export interface LocalFingerprint {
  size?: number;
  md5?: string;
  modifiedAt?: number;
  observedAt?: number;
}

export const isJsonPath = (path: string): boolean => {
  return path.toLowerCase().endsWith('.json');
};

export const computeLocalFingerprint = async (
  appService: AppService,
  path: string,
  base: BaseDir,
  known?: LocalFingerprint,
): Promise<LocalFingerprint | null> => {
  // 文件不存在时返回 null（"不存在"与"读取失败"必须区分：读取失败若被当作
  // 不存在，同步引擎会误判为本地删除，进而删除远端备份并写墓碑）。
  const exists = await appService.exists(path, base);
  if (!exists) return null;

  try {
    if (isJsonPath(path)) {
      const text = (await appService.readFile(path, base, 'text')) as string;
      return { size: text.length, md5: md5(text), observedAt: Date.now() };
    }

    let nativeMetadata: { size: number; modifiedAt?: number } | undefined;
    if (isTauriAppPlatform()) {
      const absolutePath = await appService.resolveFilePath(path, base);
      const metadata = await stat(absolutePath);
      nativeMetadata = {
        size: metadata.size,
        modifiedAt: metadata.mtime?.getTime(),
      };
      if (
        known?.md5 &&
        known.size === nativeMetadata.size &&
        known.modifiedAt === nativeMetadata.modifiedAt
      ) {
        return { ...known, observedAt: Date.now() };
      }
    }

    const file = await appService.openFile(path, base);
    let hash: string | undefined;
    try {
      hash = await partialMD5(file);
    } catch {
      hash = undefined;
    }
    return {
      size: nativeMetadata?.size ?? file.size,
      md5: hash,
      modifiedAt: nativeMetadata?.modifiedAt,
      observedAt: Date.now(),
    };
  } catch (error) {
    // 读取失败：向上抛，由调用方决定跳过该条目（避免误判删除）。
    throw error;
  }
};
