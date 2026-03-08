'use client';

import Link from 'next/link';

export default function AuthRecoveryPage() {
  return (
    <div className='bg-base-200/50 text-base-content hero min-h-screen'>
      <div className='hero-content text-center'>
        <div className='max-w-md space-y-4'>
          <h1 className='text-2xl font-semibold'>Password recovery is unavailable</h1>
          <p className='text-base-content/80'>
            OpenReadest does not use hosted account authentication anymore, so password reset
            links are intentionally disabled.
          </p>
          <div className='flex justify-center'>
            <Link href='/library' className='btn btn-primary rounded-xl'>
              Go to Library
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
