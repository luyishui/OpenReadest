import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncWebDavSelection } from '@/services/webdav/sync/engine';
import { REMOTE_WORD_NOTES_PATH, WORD_NOTES_SYNC_KEY } from '@/services/webdav/sync/wordNotesSync';
import { useSettingsStore } from '@/store/settingsStore';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import type { WebDavProfile, WebDavSyncProgress } from '@/services/webdav/models';

vi.mock('@/i18n/i18n', () => ({ default: { changeLanguage: vi.fn() } }));
const server = vi.hoisted(() => ({ files: new Map<string, string>(), calls: [] as string[] }));
vi.mock('@/services/webdav/client/WebDavClient', () => ({
  WebDavClient: class {
    async mkcol() {
      return { ok: true, status: 201 };
    }
    async get(path: string) {
      server.calls.push('GET ' + path);
      const text = server.files.get(path);
      return {
        ok: text !== undefined,
        status: text === undefined ? 404 : 200,
        headers: new Headers({ etag: '"v1"' }),
        data: text === undefined ? undefined : new TextEncoder().encode(text).buffer,
      };
    }
    async put(path: string, data: Uint8Array) {
      server.calls.push('PUT ' + path);
      server.files.set(path, new TextDecoder().decode(data));
      return { ok: true, status: 201, headers: new Headers() };
    }
  },
}));

const saveSettings = vi.fn();
const appService = {
  exists: async () => false,
  createDir: async () => {},
  writeFile: async () => {},
  saveSettings,
} as unknown as AppService;
const profile = { id: 'test', serverUrl: 'https://test.invalid' } as WebDavProfile;
const options = { books: [], includeLibrary: false, includeStatistics: false };
const autoSyncOptions = { ...options, includeWordNotes: true };
const note = { id: 'a', word: 'read', note: 'meaning', createdAt: 1, updatedAt: 2 };

beforeEach(() => {
  server.files.clear();
  server.calls = [];
  saveSettings.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: { wordNotes: [note], localBooksDir: 'local-only' } as SystemSettings,
  });
});

describe('word notes in the WebDAV engine', () => {
  it('syncs when requested without selecting a source book, and reports progress', async () => {
    const progress: WebDavSyncProgress[] = [];
    expect(
      await syncWebDavSelection(appService, profile, autoSyncOptions, {
        onProgress: (value) => progress.push({ ...value }),
      }),
    ).toEqual({ conflicts: [], failures: [] });
    const snapshot = JSON.parse(server.files.get(REMOTE_WORD_NOTES_PATH)!);
    expect(snapshot.wordNotes).toEqual([note]);
    expect(server.files.get(REMOTE_WORD_NOTES_PATH)).not.toContain('local-only');
    expect(progress.at(-1)).toMatchObject({
      totalItems: 1,
      completedItems: 1,
      failedItems: 0,
      currentPath: WORD_NOTES_SYNC_KEY,
    });

    useSettingsStore.setState({
      settings: { wordNotes: [], localBooksDir: 'phone/books' } as unknown as SystemSettings,
    });
    expect(await syncWebDavSelection(appService, profile, autoSyncOptions)).toEqual({
      conflicts: [],
      failures: [],
    });
    expect(useSettingsStore.getState().settings.wordNotes).toEqual([note]);
    expect(useSettingsStore.getState().settings.localBooksDir).toBe('phone/books');
    expect(saveSettings.mock.calls.at(-1)![0].wordNotes).toEqual([note]);
  });

  it.each([options, { ...autoSyncOptions, dryRun: true }])(
    'skips word notes for book-only runs and dry runs: %o',
    async (syncOptions) => {
      await syncWebDavSelection(appService, profile, syncOptions);
      expect(server.calls.some((call) => call.endsWith(REMOTE_WORD_NOTES_PATH))).toBe(false);
      expect(saveSettings).not.toHaveBeenCalled();
    },
  );

  it('does not touch word notes after cancellation', async () => {
    await syncWebDavSelection(appService, profile, autoSyncOptions, undefined, {
      shouldCancel: () => true,
    });
    expect(server.calls.some((call) => call.endsWith(REMOTE_WORD_NOTES_PATH))).toBe(false);
  });

  it('reports local import failure and retains memory and remote content for retry', async () => {
    await syncWebDavSelection(appService, profile, autoSyncOptions);
    const text = server.files.get(REMOTE_WORD_NOTES_PATH);
    useSettingsStore.setState({ settings: { wordNotes: [] } as unknown as SystemSettings });
    saveSettings.mockRejectedValue(new Error('Disk full'));
    const result = await syncWebDavSelection(appService, profile, autoSyncOptions);
    expect(result.failures).toEqual([
      expect.objectContaining({ path: WORD_NOTES_SYNC_KEY, message: 'Disk full' }),
    ]);
    expect(useSettingsStore.getState().settings.wordNotes).toEqual([]);
    expect(server.files.get(REMOTE_WORD_NOTES_PATH)).toBe(text);
  });
});
