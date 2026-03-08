'use client';

import { useRouter } from 'next/navigation';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';

const ProfilePage = () => {
  const _ = useTranslation();
  const router = useRouter();
  useTheme({ systemUIVisible: false });

  return (
    <div className='bg-base-100 flex min-h-screen items-center justify-center p-6'>
      <div className='bg-base-200 w-full max-w-2xl rounded-2xl p-8 shadow-lg'>
        <h1 className='text-base-content mb-4 text-2xl font-semibold'>
          {_('Online account features have been removed')}
        </h1>
        <p className='text-base-content/70 mb-3'>
          {_(
            'OpenReadest does not include the original account system, cloud storage, subscriptions, or payment management.',
          )}
        </p>
        <p className='text-base-content/70 mb-6'>
          {_('You can continue using local reading features and WebDAV synchronization from your library.')}
        </p>
        <div className='flex gap-3'>
          <button className='btn btn-primary' onClick={() => router.push('/library')}>
            {_('Go to Library')}
          </button>
          <button className='btn btn-outline' onClick={() => router.back()}>
            {_('Go Back')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
