import React, { useState } from 'react';
import { MdAdd, MdDelete, MdKeyboardArrowDown, MdKeyboardArrowUp } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useFileSelector } from '@/hooks/useFileSelector';
import { useTranslation } from '@/hooks/useTranslation';
import {
  deleteImportedDictionary,
  DictionaryImportError,
  getDictionaryStem,
  importStarDictBundles,
} from '@/services/dictionaries/dictionaryService';
import { ImportedDictionary } from '@/services/dictionaries/types';
import { useSettingsStore } from '@/store/settingsStore';

const LocalDictionaries: React.FC = () => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { selectFiles } = useFileSelector(appService, _);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const dictionaries = settings.customDictionaries ?? [];

  const persist = async (customDictionaries: ImportedDictionary[]) => {
    const nextSettings = { ...settings, customDictionaries };
    setSettings(nextSettings);
    await saveSettings(envConfig, nextSettings);
  };

  const handleImport = async () => {
    if (!appService || busy) return;
    setError('');
    setInfo('');
    const selection = await selectFiles({ type: 'dictionaries', multiple: true });
    if (selection.error) {
      setError(selection.error);
      return;
    }
    if (!selection.files.length) return;

    setBusy(true);
    try {
      // 去重在 service 层：同 stem 指纹一致自动跳过（不重写盘、保留原条目）；
      // 指纹变化自动覆盖（旧条目缓存与目录已由 service 清理）。
      const result = await importStarDictBundles(appService, selection.files, dictionaries);
      const replacedIds = new Set(result.replaced);
      const kept = dictionaries.filter((dictionary) => !replacedIds.has(dictionary.id));
      // 无替换时追加到末尾；有替换时插到首个被替换条目的原位置（保持用户排序意图）
      const firstReplaced = dictionaries.findIndex((dictionary) => replacedIds.has(dictionary.id));
      const at = firstReplaced >= 0 ? firstReplaced : kept.length;
      await persist([...kept.slice(0, at), ...result.imported, ...kept.slice(at)]);
      const notes: string[] = [];
      if (result.replaced.length > 0) {
        const names = result.replaced
          .map((id) => {
            const existing = dictionaries.find((d) => d.id === id);
            return existing ? getDictionaryStem(existing) ?? id : id;
          })
          .join(', ');
        notes.push(
          _('Updated existing dictionaries: {{names}}', { names }),
        );
      }
      if (result.skipped.length > 0) {
        notes.push(
          _('Already imported, skipped: {{names}}', { names: result.skipped.join(', ') }),
        );
      }
      if (notes.length > 0) setInfo(notes.join('; '));
    } catch (cause) {
      // 结构化错误按 code 本地化；其余错误回退原文（非 Error 值兜底显示其字符串）
      if (cause instanceof DictionaryImportError) {
        setError(
          cause.code === 'no-complete-bundle'
            ? _('No complete dictionary bundle could be imported')
            : _('Failed to store dictionary files'),
        );
      } else if (cause instanceof Error) {
        setError(cause.message);
      } else {
        setError(String(cause));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (dictionary: ImportedDictionary) => {
    if (!appService || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteImportedDictionary(appService, dictionary);
      await persist(dictionaries.filter(({ id }) => id !== dictionary.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : _('Unable to remove dictionary'));
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!appService || busy) return;
    const target = index + direction;
    setError('');
    if (target < 0 || target >= dictionaries.length) return;
    setBusy(true);
    try {
      const next = [...dictionaries];
      [next[index], next[target]] = [next[target]!, next[index]!];
      await persist(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  // 启用开关：显式 false 时词典不参与任何查询；置回 undefined 免于持久化冗余字段
  const handleToggleEnabled = async (dictionary: ImportedDictionary) => {
    if (!appService || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = dictionaries.map((d) =>
        d.id === dictionary.id ? { ...d, enabled: d.enabled === false ? undefined : false } : d,
      );
      await persist(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='w-full'>
      <h2 className='mb-2 font-medium'>{_('Local Dictionaries')}</h2>
      <div className='card border-base-200 bg-base-100 border shadow'>
        <div className='divide-base-200 divide-y'>
          <div className='config-item'>
            <div className='flex flex-col gap-1'>
              <span>{_('Dictionary files')}</span>
              <span className='text-base-content/60 text-xs'>
                {_('Select the .ifo, .idx, .dict/.dict.dz and optional .syn files together.')}
              </span>
            </div>
            <button
              type='button'
              className='btn btn-ghost btn-sm gap-2'
              onClick={handleImport}
              disabled={!appService || busy}
              aria-label={_('Import Dictionary')}
            >
              <MdAdd className='h-5 w-5' />
              {_('Import')}
            </button>
          </div>

          {dictionaries.length === 0 ? (
            <div className='text-base-content/60 px-4 py-3 text-sm'>
              {_('No local dictionaries')}
            </div>
          ) : (
            dictionaries.map((dictionary, index) => (
              <div className='config-item' key={dictionary.id}>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={dictionary.enabled !== false}
                  onChange={() => handleToggleEnabled(dictionary)}
                  disabled={busy}
                  aria-label={
                    dictionary.enabled === false
                      ? _('Enable Dictionary')
                      : _('Disable Dictionary')
                  }
                />
                <div className='min-w-0 flex-1'>
                  <div className='truncate'>{dictionary.name}</div>
                  {dictionary.unsupported && (
                    <div className='text-error truncate text-xs'>
                      {_('Unsupported dictionary')}: {dictionary.unsupportedReason}
                    </div>
                  )}
                </div>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm btn-square'
                  onClick={() => handleMove(index, -1)}
                  disabled={!appService || busy || index === 0}
                  aria-label={_('Move Up')}
                  title={_('Move Up')}
                >
                  <MdKeyboardArrowUp className='h-5 w-5' />
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm btn-square'
                  onClick={() => handleMove(index, 1)}
                  disabled={!appService || busy || index === dictionaries.length - 1}
                  aria-label={_('Move Down')}
                  title={_('Move Down')}
                >
                  <MdKeyboardArrowDown className='h-5 w-5' />
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm btn-square'
                  onClick={() => handleRemove(dictionary)}
                  disabled={!appService || busy}
                  aria-label={_('Remove Dictionary')}
                  title={_('Remove Dictionary')}
                >
                  <MdDelete className='h-5 w-5' />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      {info && <p className='text-info mt-2 text-sm'>{info}</p>}
      {error && <p className='text-error mt-2 text-sm'>{error}</p>}
    </div>
  );
};

export default LocalDictionaries;