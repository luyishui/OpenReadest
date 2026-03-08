'use client';

import Link from 'next/link';

export default function AuthCallbackPage() {
  return (
    <div className='bg-base-200/50 text-base-content hero min-h-screen'>
      <div className='hero-content text-center'>
        <div className='max-w-md space-y-4'>
          <h1 className='text-2xl font-semibold'>Account sign-in has been removed</h1>
          <p className='text-base-content/80'>
            OpenReadest no longer connects to online account services. Continue using local
            libraries, OPDS catalogs, and WebDAV sync instead.
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
