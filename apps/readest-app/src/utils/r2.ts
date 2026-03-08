const createDisabledStorageError = () =>
  new Error('OpenReadest has disabled the original cloud object storage services.');

export const r2Storage = {
  getR2Client: () => {
    throw createDisabledStorageError();
  },

  getR2Url: () => {
    throw createDisabledStorageError();
  },

  getDownloadSignedUrl: async (_bucketName: string, _fileKey: string, _expiresIn: number) => {
    throw createDisabledStorageError();
  },

  getUploadSignedUrl: async (
    _bucketName: string,
    _fileKey: string,
    _contentLength: number,
    _expiresIn: number,
  ) => {
    throw createDisabledStorageError();
  },

  deleteObject: async (_bucketName: string, _fileKey: string) => {
    throw createDisabledStorageError();
  },
};
