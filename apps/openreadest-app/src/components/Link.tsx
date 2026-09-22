import { isTauriAppPlatform } from '@/services/environment';
import { openExternalUrl } from '@/utils/open';

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  title?: string;
}

const Link: React.FC<LinkProps> = ({
  href,
  children,
  target = '_blank',
  rel = 'noopener noreferrer',
  ...props
}) => {
  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }

    e.preventDefault();

    const opened = await openExternalUrl(href, target);
    if (!opened && !isTauriAppPlatform()) {
      window.location.href = href;
    }
  };

  return (
    <a href={href} target={target} rel={rel} onClick={handleClick} {...props}>
      {children}
    </a>
  );
};

export default Link;
