import { Book } from '@/types/book';

/**
 * Hook to manage Discord Rich Presence for a book
 * @param book - Current book being read (null if no book)
 * @param isPrimary - Whether this is the primary book (for multi-book scenarios)
 */
export const useDiscordPresence = (book: Book | null, isPrimary: boolean, enabled: boolean) => {
  void book;
  void isPrimary;
  void enabled;
};
