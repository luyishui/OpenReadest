'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';

const SuccessPage = () => {
  const _ = useTranslation();
  const router = useRouter();

  return (
    <div className='bg-base-100 flex min-h-screen items-center justify-center p-6'>
      <div className='bg-base-200 w-full max-w-2xl rounded-2xl p-8 shadow-lg'>
        <h1 className='text-base-content mb-4 text-2xl font-semibold'>
          {_('Subscription and payment flows are disabled')}
        </h1>
        <p className='text-base-content/70 mb-3'>
          {_(
            'OpenReadest no longer uses the original payment, subscription, or in-app purchase services.',
          )}
        </p>
        <p className='text-base-content/70 mb-6'>
          {_('Return to your library to continue using local reading features and WebDAV synchronization.')}
        </p>
        <div className='flex gap-3'>
          <button className='btn btn-primary' onClick={() => router.push('/library')}>
            {_('Go to Library')}
          </button>
          <button className='btn btn-outline' onClick={() => router.push('/user')}>
            {_('Back to Profile')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SuccessPage;
