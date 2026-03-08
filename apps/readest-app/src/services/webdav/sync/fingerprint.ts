import { AppService, BaseDir } from '@/types/system';
import { md5, partialMD5 } from '@/utils/md5';

export interface LocalFingerprint {
  size?: number;
  md5?: string;
  observedAt?: number;
}

export const isJsonPath = (path: string): boolean => {
  return path.toLowerCase().endsWith('.json');
};

export const computeLocalFingerprint = async (
  appService: AppService,
  path: string,
  base: BaseDir,
): Promise<LocalFingerprint | null> => {
  try {
    if (isJsonPath(path)) {
      const text = (await appService.readFile(path, base, 'text')) as string;
      return { size: text.length, md5: md5(text), observedAt: Date.now() };
    }

    const file = await appService.openFile(path, base);
    let hash: string | undefined;
    try {
      hash = await partialMD5(file);
    } catch {
      hash = undefined;
    }
    return { size: file.size, md5: hash, observedAt: Date.now() };
  } catch {
    return null;
  }
};
