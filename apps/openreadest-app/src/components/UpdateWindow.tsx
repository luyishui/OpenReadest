import React, { useEffect, useState } from 'react';
import { RiDownloadCloud2Line, RiGithubLine } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { openExternalUrl } from '@/utils/open';
import { getAppVersion } from '@/utils/version';
import Dialog from './Dialog';

const LOCAL_UPDATE_CONFIG_URL = '/updates/config.json';

type UpdateConfig = {
  remoteConfigUrl?: string;
  eyebrow?: string;
  projectHomepage?: string;
  releaseNotesUrl?: string;
  channelLabel?: string;
  summary?: string;
  detail?: string;
};

const DEFAULT_UPDATE_CONFIG: Required<UpdateConfig> = {
  remoteConfigUrl: '',
  eyebrow: 'OpenReadest Update',
  projectHomepage: 'https://github.com/luyishui/OpenReadest',
  releaseNotesUrl: 'https://github.com/luyishui/OpenReadest/releases',
  channelLabel: 'GitHub Pages / GitHub Releases',
  summary: '这里会同步 OpenReadest 的版本动向，也给你留好项目主页和最新版本入口。',
  detail: '如果一时打不开或加载不出来，多半是 GitHub 网络波动，换个时间或者稍后再试就好。',
};

const mergeUpdateConfig = (
  base: UpdateConfig,
  override?: UpdateConfig,
): Required<UpdateConfig> => ({
  ...DEFAULT_UPDATE_CONFIG,
  ...base,
  ...override,
});

export const setUpdateDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('update_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const UpdateWindow = () => {
  const _ = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<Required<UpdateConfig>>(DEFAULT_UPDATE_CONFIG);

  const openUpdateTarget = async (url: string) => {
    const opened = await openExternalUrl(url);
    if (!opened) {
      eventDispatcher.dispatch('toast', {
        message: _('链接打开失败，请稍后再试。'),
        type: 'warning',
      });
    }
  };

  const loadUpdateConfig = async () => {
    try {
      const localResponse = await fetch(LOCAL_UPDATE_CONFIG_URL, { cache: 'no-store' });
      const localConfig = localResponse.ok
        ? ((await localResponse.json()) as UpdateConfig)
        : DEFAULT_UPDATE_CONFIG;
      let nextConfig = mergeUpdateConfig(DEFAULT_UPDATE_CONFIG, localConfig);

      if (nextConfig.remoteConfigUrl) {
        try {
          const remoteResponse = await fetch(nextConfig.remoteConfigUrl, { cache: 'no-store' });
          if (remoteResponse.ok) {
            const remoteConfig = (await remoteResponse.json()) as UpdateConfig;
            nextConfig = mergeUpdateConfig(nextConfig, remoteConfig);
          }
        } catch (error) {
          console.warn('Failed to load remote update config:', error);
        }
      }

      setConfig(nextConfig);
    } catch (error) {
      console.warn('Failed to load local update config:', error);
      setConfig(DEFAULT_UPDATE_CONFIG);
    }
  };

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        loadUpdateConfig();
      }
    };

    const el = document.getElementById('update_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  return (
    <Dialog
      id='update_window'
      isOpen={isOpen}
      title={_('检查更新')}
      onClose={() => setIsOpen(false)}
      boxClassName='sm:!w-[540px] sm:!max-w-[92vw] sm:h-auto'
      contentClassName='px-5 pb-6 sm:px-6'
    >
      {isOpen && (
        <div className='flex flex-col gap-5 py-2'>
          <div className='bg-base-200 rounded-[28px] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] ring-1 ring-black/5'>
            <div className='space-y-2'>
              <p className='text-neutral-content/50 text-[11px] font-semibold uppercase tracking-[0.28em]'>
                {_(config.eyebrow)}
              </p>
              <h2 className='text-base-content text-2xl font-black tracking-tight'>
                {_('当前版本 {{version}}', { version: getAppVersion() })}
              </h2>
            </div>
            <p className='text-base-content/80 mt-3 text-sm leading-7'>{_(config.summary)}</p>
            <p className='text-base-content/75 mt-2 text-sm leading-7'>{_(config.detail)}</p>
          </div>

          <div className='bg-base-200 grid gap-3 rounded-[28px] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.08)] ring-1 ring-black/5 sm:grid-cols-2'>
            <button
              type='button'
              className='btn bg-base-content text-base-100 hover:bg-base-content/90 active:bg-base-content h-12 rounded-2xl border-none shadow-none focus-visible:outline-none'
              onClick={() => openUpdateTarget(config.projectHomepage)}
            >
              <RiGithubLine className='h-4 w-4' />
              {_('打开项目主页')}
            </button>
            <button
              type='button'
              className='btn border-base-300 bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content active:bg-base-200 h-12 rounded-2xl shadow-none focus-visible:outline-none'
              onClick={() => openUpdateTarget(config.releaseNotesUrl)}
            >
              <RiDownloadCloud2Line className='h-4 w-4' />
              {_('查看最新版本')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
