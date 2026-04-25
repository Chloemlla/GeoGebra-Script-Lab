const normalizeBaseUrl = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\/+$/, '');
};

const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
let authToken = '';

const buildUrl = (path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

const resolveUploadUrl = (value) => {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return buildUrl(value);
};

async function parseEnvelope(response) {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    const error = new Error(`Backend returned an invalid response (${response.status})`);
    error.status = response.status;
    throw error;
  }

  if (!response.ok || payload.success === false) {
    const message =
      payload?.error?.message
      || payload?.message
      || `Backend request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.code || null;
    throw error;
  }

  return payload.data;
}

async function request(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(buildUrl(path), {
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers,
  });

  return parseEnvelope(response);
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function setAuthToken(value) {
  authToken = typeof value === 'string' ? value.trim() : '';
}

export function clearAuthToken() {
  authToken = '';
}

export async function fetchHealth() {
  return request('/health');
}

export async function fetchModelConfig() {
  return request('/api/v1/model/config');
}

export async function fetchAdminDashboard() {
  return request('/api/v1/admin/dashboard');
}

export async function reserveUpload(payload) {
  return request('/api/v1/assets/uploads', {
    method: 'POST',
    body: payload,
  });
}

export async function uploadAsset({ uploadUrl, file, mimeType }) {
  if (!file) {
    return null;
  }

  const response = await fetch(resolveUploadUrl(uploadUrl), {
    method: 'PUT',
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      'Content-Type': mimeType || file.type || 'application/octet-stream',
    },
    body: file,
  });

  return parseEnvelope(response);
}

export async function createDrawingJob(payload) {
  return request('/api/v1/ai/drawing-jobs', {
    method: 'POST',
    body: payload,
  });
}

export async function createScriptInsights(payload) {
  return request('/api/v1/ai/script-insights', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchDrawingJob(jobId) {
  return request(`/api/v1/ai/drawing-jobs/${jobId}`);
}

export async function pollDrawingJob(jobId, options = {}) {
  const intervalMs = options.intervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 45000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await fetchDrawingJob(jobId);

    if (result?.status === 'completed' && Array.isArray(result.commands)) {
      return result;
    }

    if (typeof options.onUpdate === 'function') {
      options.onUpdate(result);
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, intervalMs);
    });
  }

  throw new Error('Polling drawing job timed out');
}

export async function createShare(payload) {
  return request('/api/v1/shares', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchShare(slug) {
  return request(`/api/v1/shares/${slug}`);
}

export async function registerUser(payload) {
  return request('/api/v1/auth/register', {
    method: 'POST',
    body: payload,
  });
}

export async function loginUser(payload) {
  return request('/api/v1/auth/login', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchCurrentUser() {
  return request('/api/v1/auth/me');
}

export async function logoutUser() {
  return request('/api/v1/auth/logout', {
    method: 'POST',
  });
}
