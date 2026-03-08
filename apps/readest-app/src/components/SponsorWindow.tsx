import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { makeSafeFilename } from '@/utils/misc';
import Link from './Link';
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
  title: '请作者吃个鸡腿儿',
  summary:
    'OpenReadest 是 Readest 的独立分支，继续维护 EPUB、PDF、TXT 等阅读能力，并补强 WebDAV 同步与本地优先体验。',
  detail:
    '如果这些改动帮你把书库稳定用起来了，可以扫下面这张码支持一下开发、测试设备和持续更新。',
  imageUrl: '/support/sponsor-poster.jpg',
  fallbackImageUrl: '/icon.png',
  projectHomepage: 'https://github.com/luyishui/OpenReadest',
  releaseNotesUrl: 'https://github.com/luyishui/OpenReadest/releases',
};

const mergeSupportConfig = (base: SupportConfig, override?: SupportConfig): Required<SupportConfig> => ({
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
  const isDesktop = !!appService?.isDesktopApp;

  const effectiveImageUrl = imageLoadFailed ? config.fallbackImageUrl : config.imageUrl;
  const hasRealPoster = !imageLoadFailed && config.imageUrl !== config.fallbackImageUrl;

  const resolvedPosterUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return effectiveImageUrl;
    }
    return new URL(effectiveImageUrl, window.location.href).toString();
  }, [effectiveImageUrl]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    eventDispatcher.dispatch('toast', { message, type });
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

  const handleCopyPosterLink = async () => {
    try {
      await navigator.clipboard.writeText(resolvedPosterUrl);
      showToast(_('收款码链接已复制。'), 'success');
    } catch (error) {
      console.error('Failed to copy support poster link:', error);
      showToast(_('复制收款码链接失败。'), 'error');
    }
  };

  const handleOpenPoster = () => {
    window.open(resolvedPosterUrl, '_blank', 'noopener,noreferrer');
  };

  const handleSavePoster = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(resolvedPosterUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = makeSafeFilename(`OpenReadest_support_qr.${extension}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);

      showToast(_('收款码已开始保存，请到下载目录查看。'), 'success');
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
      title={_('赞助一下')}
      onClose={handleClose}
      boxClassName='sm:!w-[560px] sm:!max-w-[92vw] sm:h-auto'
      contentClassName='px-5 pb-6 sm:px-6'
    >
      {isOpen && (
        <div className='flex flex-col gap-5 py-2'>
          <div className='rounded-[28px] bg-[linear-gradient(160deg,rgba(255,248,239,0.98),rgba(255,255,255,0.92))] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] ring-1 ring-black/5'>
            <div className='flex flex-col gap-3'>
              <div className='space-y-2'>
                <p className='text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-content/50'>
                  {_(config.eyebrow)}
                </p>
                <h2 className='text-2xl font-black tracking-tight text-base-content'>
                  {_(config.title)}
                </h2>
              </div>
              <p className='text-sm leading-7 text-base-content/80'>
                {_(config.summary)}
              </p>
              <p className='text-sm leading-7 text-base-content/75'>
                {_(config.detail)}
              </p>
            </div>
          </div>

          <div className='rounded-[28px] bg-base-100 p-4 shadow-[0_20px_70px_rgba(0,0,0,0.1)] ring-1 ring-black/5'>
            <div className='group flex w-full flex-col gap-3 text-left'>
              <div className='overflow-hidden rounded-[24px] bg-[#f6f1e8]'>
                <Image
                  src={effectiveImageUrl}
                  alt='OpenReadest Logo'
                  width={512}
                  height={512}
                  className='mx-auto h-auto w-full max-w-[220px] object-contain py-8'
                  onError={() => setImageLoadFailed(true)}
                />
              </div>
              <div className='flex items-center justify-between gap-3 px-1'>
                <div>
                  <p className='text-sm font-semibold text-base-content'>
                    {hasRealPoster ? _('收款码已就绪') : _('赞助码准备中')}
                  </p>
                  <p className='text-xs text-neutral-content/70'>
                    {isAndroid
                      ? hasRealPoster
                        ? _('Android 端可以继续长按图片保存；桌面端会显示显式按钮，避免把长按当成主要操作。')
                        : _('当前页面先使用 OpenReadest logo 占位，后续会切换为可远程替换的赞助二维码。')
                      : hasRealPoster
                        ? _('Windows 和桌面端改为“保存图片 / 打开大图 / 复制链接”操作，不再依赖长按。')
                        : _('当前页面先使用 OpenReadest logo 占位，后续会切换为可远程替换的赞助二维码。')}
                  </p>
                </div>
                <span className='rounded-full border border-base-300 px-3 py-1 text-xs text-neutral-content/70'>
                  {hasRealPoster ? _('可测试') : _('敬请期待')}
                </span>
              </div>
            </div>
          </div>

          {isDesktop && hasRealPoster && (
            <div className='grid gap-3 sm:grid-cols-3'>
              <button
                type='button'
                className='btn btn-outline h-12 rounded-2xl'
                onClick={handleSavePoster}
                disabled={isSaving}
              >
                {isSaving ? _('保存中...') : _('保存收款码')}
              </button>
              <button type='button' className='btn btn-outline h-12 rounded-2xl' onClick={handleOpenPoster}>
                {_('打开大图')}
              </button>
              <button
                type='button'
                className='btn btn-outline h-12 rounded-2xl'
                onClick={handleCopyPosterLink}
              >
                {_('复制收款码链接')}
              </button>
            </div>
          )}

          <div className='grid gap-3 sm:grid-cols-2'>
            <Link
              href={config.projectHomepage}
              className='btn h-12 rounded-2xl border-none bg-black text-white hover:bg-black/90'
            >
              {_('关注项目进展')}
            </Link>
            {hasRealPoster && !isDesktop ? (
              <Link href={config.releaseNotesUrl} className='btn btn-outline h-12 rounded-2xl'>
                {_('查看发布页')}
              </Link>
            ) : (
            <button type='button' className='btn btn-outline h-12 rounded-2xl' onClick={handleClose}>
              {_('下次一定')}
            </button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};