'use client';

import Link from 'next/link';

export default function AuthUpdatePage() {
  return (
    <div className='bg-base-200/50 text-base-content hero min-h-screen'>
      <div className='hero-content text-center'>
        <div className='max-w-md space-y-4'>
          <h1 className='text-2xl font-semibold'>Account updates are disabled</h1>
          <p className='text-base-content/80'>
            Email and profile updates through hosted account services have been removed from
            OpenReadest.
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
