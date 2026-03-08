// Copyright (c) 2026 luyishui
import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { parseWebViewInfo } from '@/utils/ua';
import { getAppVersion } from '@/utils/version';
import Dialog from './Dialog';
import Link from './Link';
import SupportLinks from './SupportLinks';

export const setAboutDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('about_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const AboutWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [browserInfo, setBrowserInfo] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setBrowserInfo(parseWebViewInfo(appService));

    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('about_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <Dialog
      id='about_window'
      isOpen={isOpen}
      title={_('About OpenReadest')}
      onClose={handleClose}
      boxClassName='sm:!w-[480px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='about-content flex flex-col gap-5 px-6 py-5'>
          <div className='flex flex-col items-center gap-3 text-center'>
            <Image src='/icon.png' alt='OpenReadest Logo' className='h-20 w-20' width={80} height={80} />
            <div className='select-text space-y-1'>
              <h2 className='text-2xl font-bold'>OpenReadest</h2>
              <p className='text-neutral-content text-sm'>
                {_('Version {{version}}', { version: getAppVersion() })}
              </p>
              <p className='text-neutral-content text-xs'>{browserInfo}</p>
            </div>
          </div>

          <div className='bg-base-200 flex flex-col gap-3 rounded-2xl p-4 text-sm' dir='ltr'>
            <p className='text-base-content/80'>
              {_('OpenReadest is an independent fork and continued re-development of Readest.')}
            </p>
            <p className='text-base-content/80'>
              {_('Copyright (c) 2026 luyishui. Based on Readest, originally developed by Bilingify LLC.')}
            </p>
            <p className='text-base-content/80'>
              {_('License')}:{' '}
              <Link
                href='https://www.gnu.org/licenses/agpl-3.0.html'
                className='text-blue-500 underline'
              >
                GNU Affero General Public License v3.0
              </Link>
            </p>
          </div>

          <SupportLinks />
        </div>
      )}
    </Dialog>
  );
};
