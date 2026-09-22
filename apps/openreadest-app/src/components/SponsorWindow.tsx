import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { makeSafeFilename } from '@/utils/misc';
import Dialog from './Dialog';

const LOCAL_SUPPORT_CONFIG_URL = '/support/config.json';

type SupportConfig = {
  remoteConfigUrl?: string;
  eyebrow?: string;
  title?: string;
  summary?: string;
  detail?: string;
  imageUrl?: string;
  fallbackImageUrl?: string;
  projectHomepage?: string;
  releaseNotesUrl?: string;
};

const DEFAULT_SUPPORT_CONFIG: Required<SupportConfig> = {
  remoteConfigUrl: '',
  eyebrow: 'OpenReadest Support',
  title: '请作者吃顿拼好饭',
  summary:
    'OpenReadest 是 Readest 的独立分支，继续维护 EPUB、PDF、TXT 等阅读能力，并补强 WebDAV 同步与本地优先体验。',
  detail: '如果这些改动帮你把书库稳定用起来了，可以扫下面这张码支持一下开发、测试设备和持续更新。',
  imageUrl: '/support/sponsor-poster.jpg',
  fallbackImageUrl: '/icon.png',
  projectHomepage: 'https://github.com/luyishui/OpenReadest',
  releaseNotesUrl: 'https://github.com/luyishui/OpenReadest/releases',
};

const mergeSupportConfig = (
  base: SupportConfig,
  override?: SupportConfig,
): Required<SupportConfig> => ({
  ...DEFAULT_SUPPORT_CONFIG,
  ...base,
  ...override,
});

export const setSponsorDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('sponsor_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const SponsorWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<Required<SupportConfig>>(DEFAULT_SUPPORT_CONFIG);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isAndroid = !!appService?.isAndroidApp;

  const effectiveImageUrl = imageLoadFailed ? config.fallbackImageUrl : config.imageUrl;
  const hasRealPoster = !imageLoadFailed && config.imageUrl !== config.fallbackImageUrl;

  const resolvedPosterUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return effectiveImageUrl;
    }
    return new URL(effectiveImageUrl, window.location.href).toString();
  }, [effectiveImageUrl]);

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' | 'warning' = 'info',
    className = '',
  ) => {
    eventDispatcher.dispatch('toast', { message, type, className });
  };

  const loadSupportConfig = async () => {
    try {
      const localResponse = await fetch(LOCAL_SUPPORT_CONFIG_URL, { cache: 'no-store' });
      const localConfig = localResponse.ok
        ? ((await localResponse.json()) as SupportConfig)
        : DEFAULT_SUPPORT_CONFIG;
      let nextConfig = mergeSupportConfig(DEFAULT_SUPPORT_CONFIG, localConfig);

      if (nextConfig.remoteConfigUrl) {
        try {
          const remoteResponse = await fetch(nextConfig.remoteConfigUrl, { cache: 'no-store' });
          if (remoteResponse.ok) {
            const remoteConfig = (await remoteResponse.json()) as SupportConfig;
            nextConfig = mergeSupportConfig(nextConfig, remoteConfig);
          }
        } catch (error) {
          console.warn('Failed to load remote support config:', error);
        }
      }

      setConfig(nextConfig);
      setImageLoadFailed(false);
    } catch (error) {
      console.warn('Failed to load local support config:', error);
      setConfig(DEFAULT_SUPPORT_CONFIG);
      setImageLoadFailed(false);
    }
  };

  const loadPosterBinary = async () => {
    const response = await fetch(resolvedPosterUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const extension = blob.type.includes('png')
      ? 'png'
      : blob.type.includes('webp')
        ? 'webp'
        : 'jpg';
    const filename = makeSafeFilename(`OpenReadest_support_qr.${extension}`);

    return {
      blob,
      filename,
      arrayBuffer: await blob.arrayBuffer(),
    };
  };

  const savePosterToLocal = async () => {
    const { arrayBuffer, blob, filename } = await loadPosterBinary();

    if (appService) {
      const saved = await appService.saveFile(filename, arrayBuffer, blob.type || 'image/jpeg');
      if (!saved) {
        showToast(_('已取消保存。'), 'info');
        return false;
      }
    } else {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    }

    showToast(_('收款码已开始保存，请到下载目录查看。'), 'success');
    return true;
  };

  const handleSupportAction = async () => {
    if (!hasRealPoster) {
      showToast(_('赞助海报暂未找到，请稍后重试。'), 'warning');
      return;
    }

    if (isAndroid) {
      showToast(
        [_('请直接截图二维码。'), _('打开支付宝扫一扫'), _('再从相册里识别')].join('\n'),
        'info',
        'mx-auto w-[12em] max-w-[80vw] whitespace-pre-line break-keep text-center leading-7',
      );
      return;
    }

    setIsSaving(true);
    try {
      await savePosterToLocal();
    } catch (error) {
      console.error('Failed to save support poster:', error);
      showToast(_('保存收款码失败，请稍后重试。'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        loadSupportConfig();
      }
    };

    const el = document.getElementById('sponsor_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <Dialog
      id='sponsor_window'
      isOpen={isOpen}
      title={_('为我发"声"')}
      onClose={handleClose}
      boxClassName='sm:!w-[560px] sm:!max-w-[92vw] sm:h-auto'
      contentClassName='px-5 pb-6 sm:px-6'
    >
      {isOpen && (
        <div className='flex flex-col gap-5 py-2'>
          <div className='bg-base-200 rounded-[28px] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] ring-1 ring-black/5'>
            <div className='flex flex-col gap-3'>
              <div className='space-y-2'>
                <p className='text-neutral-content/50 text-[11px] font-semibold uppercase tracking-[0.28em]'>
                  {_(config.eyebrow)}
                </p>
                <h2 className='text-base-content text-2xl font-black tracking-tight'>
                  {_(config.title)}
                </h2>
              </div>
              <p className='text-base-content/80 text-sm leading-7'>{_(config.summary)}</p>
              <p className='text-base-content/75 text-sm leading-7'>{_(config.detail)}</p>
            </div>
          </div>

          <div className='bg-base-200 rounded-[28px] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.1)] ring-1 ring-black/5'>
            <div className='group flex w-full flex-col gap-4 text-left'>
              <div className='bg-base-100 overflow-hidden rounded-[24px] ring-1 ring-black/5'>
                <Image
                  src={effectiveImageUrl}
                  alt='OpenReadest Support Poster'
                  width={512}
                  height={512}
                  className='mx-auto h-auto w-full max-w-[240px] object-contain py-6'
                  onError={() => setImageLoadFailed(true)}
                />
              </div>
            </div>
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <button
              type='button'
              className='btn btn-primary h-12 rounded-2xl'
              onClick={handleSupportAction}
              disabled={!hasRealPoster || isSaving}
            >
              {isSaving ? _('保存中...') : _('我来助你')}
            </button>
            <button
              type='button'
              className='btn btn-outline h-12 rounded-2xl'
              onClick={handleClose}
            >
              {_('下次一定')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
