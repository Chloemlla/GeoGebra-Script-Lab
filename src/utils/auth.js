export const AUTH_STORAGE_KEY = 'geograba-auth-v1';

export const readStoredAuthSession = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (typeof parsed?.token !== 'string' || parsed.token.trim().length === 0) {
      return null;
    }

    return {
      token: parsed.token,
      tokenType: typeof parsed?.tokenType === 'string' ? parsed.tokenType : 'Bearer',
      expiresAt: typeof parsed?.expiresAt === 'string' ? parsed.expiresAt : null,
      user: parsed?.user && typeof parsed.user === 'object' ? parsed.user : null,
    };
  } catch (_error) {
    return null;
  }
};

export const writeStoredAuthSession = (session) => {
  if (typeof window === 'undefined' || !window.localStorage || !session?.token) {
    return;
  }

  window.localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      token: session.token,
      tokenType: session.tokenType || 'Bearer',
      expiresAt: session.expiresAt || null,
      user: session.user || null,
    })
  );
};

export const clearStoredAuthSession = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};
