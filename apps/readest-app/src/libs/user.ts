const AUTH_DISABLED_ERROR = 'Cloud account features are disabled in OpenReadest';

export const deleteUser = async () => {
  throw new Error(AUTH_DISABLED_ERROR);
};
