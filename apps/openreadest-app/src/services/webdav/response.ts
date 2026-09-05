import { WebDavResponse } from './client/types';

export const requireWebDavSuccess = (
  response: WebDavResponse<unknown>,
  fallbackMessage: string,
): void => {
  if (response.ok) return;
  throw new Error(
    response.error || (response.status ? `状态码：${response.status}` : fallbackMessage),
  );
};
