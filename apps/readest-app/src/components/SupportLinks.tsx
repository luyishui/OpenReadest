import { FaGithub } from 'react-icons/fa';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Link from './Link';

const GITHUB_REPOSITORY = 'https://github.com/luyishui/OpenReadest';

const SupportLinks = () => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(24);

  return (
    <div className='my-2 flex flex-col items-center gap-3'>
      <p className='text-neutral-content text-sm'>{_('Project Links')}</p>
      <Link
        href={GITHUB_REPOSITORY}
        className='bg-base-100 text-base-content hover:bg-base-300 inline-flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors'
        title='GitHub'
        aria-label='GitHub'
      >
        <span className='inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white'>
          <FaGithub size={iconSize} />
        </span>
        <span className='flex flex-col text-left leading-tight'>
          <span className='text-sm font-medium'>{_('GitHub Homepage')}</span>
          <span className='text-neutral-content text-xs'>github.com/luyishui/OpenReadest</span>
        </span>
      </Link>
    </div>
  );
};

export default SupportLinks;
