import clsx from 'clsx';
import React from 'react';
import BookCover from '@/components/BookCover';
import type { Book } from '@/types/book';

// Same cover the library grid draws (BookCover); a plain placeholder only for books that
// left the library or have no cover image.
export const StatsCover: React.FC<{ book?: Book; className: string }> = ({ book, className }) => {
  const cover =
    book && !book.deletedAt && (book.metadata?.coverImageUrl || book.coverImageUrl) ? book : null;
  return (
    <span
      className={clsx('relative block shrink-0 overflow-hidden', className)}
      data-testid='stats-cover'
      data-has-cover={cover ? 'true' : undefined}
      aria-hidden
    >
      {cover ? (
        <BookCover book={cover} isPreview imageClassName='rounded-[2px]' />
      ) : (
        <span className='bg-base-300 block h-full w-full' />
      )}
    </span>
  );
};
