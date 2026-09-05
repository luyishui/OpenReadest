import { ViewSettings } from '@/types/book';

export const getMaxInlineSize = (viewSettings: ViewSettings) => {
  const isVertical = viewSettings.vertical;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  const screenAspectRatio = isVertical ? screenHeight / screenWidth : screenWidth / screenHeight;
  const isUnfoldedScreen = screenAspectRatio < 1.3 && screenAspectRatio > 0.77 && screenWidth > 600;

  if (isVertical) {
    return Math.max(screenWidth, screenHeight, 720, viewSettings.maxInlineSize);
  }

  const maxInlineSize = isUnfoldedScreen
    ? viewSettings.maxInlineSize * 0.8
    : viewSettings.maxInlineSize;
  // cap the column width so the configured column count stays reachable, but
  // only while each column keeps a readable width; below that keep the user
  // value and let the paginator fall back to fewer columns on its own
  // (maxColumnCount is an upper bound, not a target)
  if (!viewSettings.scrolled && viewSettings.maxColumnCount > 1) {
    const perColumnSize = Math.floor(screenWidth / viewSettings.maxColumnCount);
    if (perColumnSize >= 300) {
      return Math.min(maxInlineSize, perColumnSize);
    }
  }
  return maxInlineSize;
};

export const getDefaultMaxInlineSize = () => {
  if (typeof window === 'undefined') return 720;

  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  return screenWidth < screenHeight ? Math.max(screenWidth, 720) : 720;
};

export const getDefaultMaxBlockSize = () => {
  if (typeof window === 'undefined') return 1440;

  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  return Math.max(screenWidth, screenHeight, 1440);
};
