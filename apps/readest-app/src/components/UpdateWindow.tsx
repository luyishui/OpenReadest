import React, { useEffect, useState } from 'react';
import { RiDownloadCloud2Line, RiGithubLine } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { getAppVersion } from '@/utils/version';
import Link from './Link';
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
  summary:
    'OpenReadest 的独立更新源正在接入中。当前阶段先保留独立“检查更新”页面，后续会接上远程版本信息、更新日志和下载分发。',
  detail:
    '现在你可以先通过项目主页查看最新进展；Android 包会继续按 ARM64 和 x86 分开提供测试包。',
};

const mergeUpdateConfig = (base: UpdateConfig, override?: UpdateConfig): Required<UpdateConfig> => ({
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
          <div className='rounded-[28px] bg-[linear-gradient(155deg,rgba(242,246,255,0.98),rgba(255,255,255,0.92))] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] ring-1 ring-black/5'>
            <div className='space-y-2'>
              <p className='text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-content/50'>
                {_(config.eyebrow)}
              </p>
              <h2 className='text-2xl font-black tracking-tight text-base-content'>
                {_('当前版本 {{version}}', { version: getAppVersion() })}
              </h2>
            </div>
            <p className='mt-3 text-sm leading-7 text-base-content/80'>
              {_(config.summary)}
            </p>
            <p className='mt-2 text-sm leading-7 text-base-content/75'>
              {_(config.detail)}
            </p>
            <p className='mt-2 text-xs leading-6 text-base-content/60'>
              {_('推荐分发通道：{{channel}}', { channel: config.channelLabel })}
            </p>
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <Link
              href={config.projectHomepage}
              className='btn h-12 rounded-2xl border-none bg-black text-white hover:bg-black/90'
            >
              <RiGithubLine className='h-4 w-4' />
              {_('打开项目主页')}
            </Link>
            <Link
              href={config.releaseNotesUrl}
              className='btn btn-outline h-12 rounded-2xl'
            >
              <RiDownloadCloud2Line className='h-4 w-4' />
              {_('查看最新发布说明')}
            </Link>
          </div>
        </div>
      )}
    </Dialog>
  );
};