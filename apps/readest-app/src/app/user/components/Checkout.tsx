'use client';

import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface CheckoutProps {
  clientSecret: string;
  sessionId: string;
  planName?: string;
  className?: string;
  onSuccess?: (sessionId: string) => void;
}

const Checkout: React.FC<CheckoutProps> = ({
  clientSecret,
  sessionId,
  planName,
  className = '',
}) => {
  void clientSecret;
  void sessionId;
  const _ = useTranslation();

  return (
    <div className={clsx('w-full', className)}>
      <div className='mb-4 flex items-center justify-center'>
        <h3 className='text-center text-lg font-semibold'>
          {planName
            ? _('Upgrade to {{plan}}', { plan: _(planName) })
            : _('Complete Your Subscription')}
        </h3>
      </div>

      <div className='border-base-300 rounded-lg border p-6 text-center'>
        <p className='text-base-content/70'>
          {_('Subscription and payment flows are disabled in OpenReadest.')}
        </p>
        <p className='text-base-content/60 mt-2 text-sm'>
          {_('No Stripe checkout session will be created from this build.')}
        </p>
      </div>
    </div>
  );
};

export default Checkout;
