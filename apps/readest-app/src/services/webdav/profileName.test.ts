import { describe, expect, it } from 'vitest';
import { getUniqueWebDavProfileName, isValidWebDavProfileName, validateWebDavProfileName } from './profileName';

describe('profileName', () => {
  it('validates allowed characters', () => {
    expect(isValidWebDavProfileName('WebDAV_1')).toBe(true);
    expect(isValidWebDavProfileName('中文配置_2')).toBe(true);
    expect(isValidWebDavProfileName('A1_中文')).toBe(true);
    expect(isValidWebDavProfileName('with space')).toBe(false);
    expect(isValidWebDavProfileName('dash-name')).toBe(false);
    expect(isValidWebDavProfileName('')).toBe(false);
  });

  it('validates length <= 32', () => {
    const ok = 'a'.repeat(32);
    const tooLong = 'a'.repeat(33);
    expect(isValidWebDavProfileName(ok)).toBe(true);
    expect(isValidWebDavProfileName(tooLong)).toBe(false);
  });

  it('rejects duplicate names', () => {
    const usedNames = ['WebDAV', 'WebDAV_1'];
    const idToName = { p1: 'WebDAV' };
    expect(validateWebDavProfileName('WebDAV', usedNames, null, idToName).ok).toBe(false);
    expect(validateWebDavProfileName('WebDAV', usedNames, 'p1', idToName).ok).toBe(true);
  });

  it('returns correct error messages', () => {
    const usedNames: string[] = [];
    const idToName = {};
    expect(validateWebDavProfileName('', usedNames, null, idToName)).toMatchObject({ ok: false, error: '备注名不能为空' });
    expect(validateWebDavProfileName('a'.repeat(33), usedNames, null, idToName)).toMatchObject({
      ok: false,
      error: '备注名长度不能超过 32 个字符',
    });
    expect(validateWebDavProfileName('bad name', usedNames, null, idToName)).toMatchObject({
      ok: false,
      error: '备注名仅支持中文、英文、数字及下划线',
    });
  });

  it('generates unique names', () => {
    expect(getUniqueWebDavProfileName('WebDAV', [])).toBe('WebDAV');
    expect(getUniqueWebDavProfileName('WebDAV', ['WebDAV'])).toBe('WebDAV_1');
    expect(getUniqueWebDavProfileName('WebDAV', ['WebDAV', 'WebDAV_1'])).toBe('WebDAV_2');
  });

  it('falls back when baseName is invalid', () => {
    expect(getUniqueWebDavProfileName('bad name', [])).toBe('WebDAV');
  });
});
