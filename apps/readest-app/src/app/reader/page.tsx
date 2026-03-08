'use client';

import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import Reader from './components/Reader';

// This is only used for the Tauri app in the app router
export default function Page() {
  useOpenWithBooks();

  return <Reader />;
}
