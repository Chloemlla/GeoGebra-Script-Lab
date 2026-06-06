export const AUTH_STORAGE_KEY = 'geograba-auth-v1';

const decodeBase64UrlJson = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

const normalizeAuthSession = (session) => {
  if (typeof session?.token !== 'string' || session.token.trim().length === 0) {
    return null;
  }

  return {
    token: session.token,
    tokenType: typeof session?.tokenType === 'string' ? session.tokenType : 'Bearer',
    expiresAt: typeof session?.expiresAt === 'string' ? session.expiresAt : null,
    refreshToken: typeof session?.refreshToken === 'string' ? session.refreshToken : null,
    refreshExpiresAt:
      typeof session?.refreshExpiresAt === 'string' ? session.refreshExpiresAt : null,
    scope: typeof session?.scope === 'string' ? session.scope : '',
    user: session?.user && typeof session.user === 'object' ? session.user : null,
    provider: 'synapse',
  };
};

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
    return normalizeAuthSession(parsed);
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
      refreshToken: session.refreshToken || null,
      refreshExpiresAt: session.refreshExpiresAt || null,
      scope: session.scope || '',
      user: session.user || null,
      provider: 'synapse',
    })
  );
};

export const clearStoredAuthSession = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};

export const consumeSynapseOAuthResult = () => {
  if (typeof window === 'undefined' || !window.location) {
    return null;
  }

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(hash);
  const encodedSession = params.get('synapseAuth');
  const error = params.get('synapseError');
  if (!encodedSession && !error) {
    return null;
  }

  params.delete('synapseAuth');
  params.delete('synapseError');
  const cleanHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${cleanHash ? `#${cleanHash}` : ''}`;
  window.history.replaceState(null, '', nextUrl);

  if (error) {
    return {
      error,
    };
  }

  try {
    const session = normalizeAuthSession(decodeBase64UrlJson(encodedSession));
    if (!session) {
      return {
        error: 'Synapse OAuth callback did not include a valid token',
      };
    }

    return {
      session,
    };
  } catch (_error) {
    return {
      error: 'Unable to read Synapse OAuth callback',
    };
  }
};

export const isAuthSessionExpiringSoon = (session, skewMs = 60000) => {
  if (!session?.expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return expiresAtMs - Date.now() <= skewMs;
};
