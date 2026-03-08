import { AppService, BaseDir } from '../../types/system';

type Stored = { data: Uint8Array };

const encodeText = (value: string) => new TextEncoder().encode(value);

export const createMockAppService = () => {
  const stores: Record<BaseDir, Map<string, Stored>> = {
    Books: new Map(),
    Settings: new Map(),
    Data: new Map(),
    Fonts: new Map(),
    Images: new Map(),
    Log: new Map(),
    Cache: new Map(),
    Temp: new Map(),
    None: new Map(),
  };

  const normalize = (path: string) => path.replace(/^\/+/, '').replace(/\/{2,}/g, '/');

  const exists = async (path: string, base: BaseDir) => {
    return stores[base].has(normalize(path));
  };

  const readFile = async (path: string, base: BaseDir, mode: 'text' | 'binary') => {
    const item = stores[base].get(normalize(path));
    if (!item) throw new Error('not found');
    if (mode === 'binary') return item.data.buffer.slice(item.data.byteOffset, item.data.byteOffset + item.data.byteLength);
    return new TextDecoder().decode(item.data);
  };

  const writeFile = async (path: string, base: BaseDir, content: string | ArrayBuffer | File) => {
    const key = normalize(path);
    if (typeof content === 'string') {
      stores[base].set(key, { data: encodeText(content) });
      return;
    }
    if (content instanceof File) {
      stores[base].set(key, { data: new Uint8Array(await content.arrayBuffer()) });
      return;
    }
    stores[base].set(key, { data: new Uint8Array(content) });
  };

  const openFile = async (path: string, base: BaseDir) => {
    const item = stores[base].get(normalize(path));
    if (!item) throw new Error('not found');
    return new File([item.data], path.split('/').pop() || 'file');
  };

  const createDir = async (_path: string, _base: BaseDir) => {};

  const appService = {
    exists,
    readFile,
    writeFile,
    openFile,
    createDir,
    resolveFilePath: async (p: string) => p,
  } as unknown as AppService;

  return {
    appService,
    stores,
    putText: async (base: BaseDir, path: string, text: string) => {
      await writeFile(path, base, text);
    },
    putBinary: async (base: BaseDir, path: string, bytes: Uint8Array) => {
      await writeFile(path, base, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    },
    getText: async (base: BaseDir, path: string) => {
      return (await readFile(path, base, 'text')) as string;
    },
    getBinary: async (base: BaseDir, path: string) => {
      return new Uint8Array((await readFile(path, base, 'binary')) as ArrayBuffer);
    },
  };
};

