interface UseAuthCallbackOptions {
  accessToken?: string | null;
  refreshToken?: string | null;
  login: (accessToken: string, user: unknown) => void;
  navigate: (path: string) => void;
  type?: string | null;
  next?: string;
  error?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
}

export function handleAuthCallback({
  navigate,
}: UseAuthCallbackOptions) {
  console.warn('Auth callback handling is disabled in OpenReadest. Redirecting to library.');
  navigate('/library');
}
