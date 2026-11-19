import { describe, expect, it } from 'vitest';
import { mergeWebDavJsonContent } from '@/services/webdav/sync/contentMerge';

describe('WebDAV reading progress', () => {
  it('preserves a valid position when a newer config has only layout fields', () => {
    expect(
      mergeWebDavJsonContent(
        'book/config.json',
        JSON.stringify({ location: 'here', progressUpdatedAt: 1, updatedAt: 1 }),
        JSON.stringify({ updatedAt: 9 }),
      )?.value,
    ).toMatchObject({ location: 'here' });
  });
  it('merges progress for books with no annotations', () => {
    const local = { location: 'one-percent', progress: [1, 100], updatedAt: 1 };
    const remote = { location: 'three-percent', progress: [3, 100], updatedAt: 2 };
    expect(
      mergeWebDavJsonContent('book/config.json', JSON.stringify(local), JSON.stringify(remote))
        ?.value,
    ).toMatchObject(remote);
  });
  it('uses the last reading change independently of newer layout changes', () => {
    const local = {
      location: 'one-percent',
      progress: [1, 100],
      progressUpdatedAt: 10,
      updatedAt: 30,
      viewSettings: { writingMode: 'vertical-rl' },
    };
    const remote = {
      location: 'three-percent',
      progress: [3, 100],
      progressUpdatedAt: 20,
      updatedAt: 20,
    };
    const merged = mergeWebDavJsonContent(
      'book/config.json',
      JSON.stringify(local),
      JSON.stringify(remote),
    )?.value;
    expect(merged).toMatchObject({
      location: 'three-percent',
      progress: [3, 100],
      progressUpdatedAt: 20,
      viewSettings: local.viewSettings,
    });
  });
  it('syncs a deliberate return to an earlier page when it is the latest reading action', () => {
    const local = {
      location: 'one-percent',
      progress: [1, 100],
      progressUpdatedAt: 30,
      updatedAt: 30,
    };
    const remote = {
      location: 'three-percent',
      progress: [3, 100],
      progressUpdatedAt: 20,
      updatedAt: 20,
    };
    expect(
      mergeWebDavJsonContent('book/config.json', JSON.stringify(local), JSON.stringify(remote))
        ?.value,
    ).toMatchObject(local);
  });
});
