// Copyright (c) 2026 luyishui
import { getConfigFilename, getCoverFilename, getLibraryFilename, getLocalBookFilename } from '@/utils/book';
import { Book } from '@/types/book';

export const READEST_WEBDAV_ROOT_DIRNAME = 'OpenReadest';
export const READEST_WEBDAV_SYSTEM_DIR = `${READEST_WEBDAV_ROOT_DIRNAME}/System`;
export const READEST_WEBDAV_BOOKS_DIR = `${READEST_WEBDAV_ROOT_DIRNAME}/Books`;

export const getRemoteSyncStatePath = () => `${READEST_WEBDAV_SYSTEM_DIR}/webdav-sync-state.json`;
export const getLocalSyncStatePath = () => `webdav/${READEST_WEBDAV_ROOT_DIRNAME}/webdav-sync-state.json`;

export const getLocalLibraryPath = () => getLibraryFilename();
export const getRemoteLibraryPath = () => `${READEST_WEBDAV_BOOKS_DIR}/library.json`;

export const getLocalBookPaths = (book: Book) => {
  return {
    bookFile: getLocalBookFilename(book),
    coverFile: getCoverFilename(book),
    configFile: getConfigFilename(book),
  };
};

export const getRemoteBookPaths = (book: Book) => {
  const local = getLocalBookPaths(book);
  return {
    bookFile: `${READEST_WEBDAV_BOOKS_DIR}/${local.bookFile}`,
    coverFile: `${READEST_WEBDAV_BOOKS_DIR}/${local.coverFile}`,
    configFile: `${READEST_WEBDAV_BOOKS_DIR}/${local.configFile}`,
  };
};

