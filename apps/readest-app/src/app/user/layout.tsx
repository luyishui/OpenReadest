import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Online Features Disabled',
  description: 'OpenReadest does not include the original cloud account or subscription pages.',
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
