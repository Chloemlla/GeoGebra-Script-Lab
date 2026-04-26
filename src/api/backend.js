const normalizeBaseUrl = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\/+$/, '');
};

const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const WORKSPACE_STORAGE_KEY = 'geograba-workspace-key';
const WORKSPACE_HEADER_NAME = 'X-Workspace-Key';
let authToken = '';
let unauthorizedHandler = null;

const notifyUnauthorized = (error, payload = null) => {
  if (typeof unauthorizedHandler !== 'function') {
    return;
  }

  try {
    unauthorizedHandler(error, payload);
  } catch (_handlerError) {
    // Ignore handler failures to preserve the original request error.
  }
};

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

const createWorkspaceKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `wk_${crypto.randomUUID().replace(/-/g, '')}`;
  }

  return `wk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

export function getWorkspaceKey() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'wk_server_side_fallback';
  }

  const existing = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextValue = createWorkspaceKey();
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, nextValue);
  return nextValue;
}

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
    if (response.status === 401 && authToken) {
      notifyUnauthorized(error, payload);
    }
    throw error;
  }

  return payload.data;
}

async function request(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    [WORKSPACE_HEADER_NAME]: getWorkspaceKey(),
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

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

export async function fetchHealth() {
  return request('/health');
}

export async function fetchModelConfig() {
  return request('/api/v1/model/config');
}

export async function fetchIpThreatConfig() {
  return request('/api/v1/ip-threat/config');
}

export async function lookupIpThreat({ ip, testMode = false }) {
  const query = new URLSearchParams();
  if (typeof ip === 'string' && ip.trim()) {
    query.set('ip', ip.trim());
  }
  if (testMode) {
    query.set('test', '1');
  }

  return request(`/api/v1/ip-threat/lookup?${query.toString()}`);
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
      [WORKSPACE_HEADER_NAME]: getWorkspaceKey(),
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

export async function createAnnotationJob(payload) {
  return request('/api/v1/ai/annotation-jobs', {
    method: 'POST',
    body: payload,
  });
}

export async function createObjectExplanations(payload) {
  return request('/api/v1/ai/object-explanations', {
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

export async function listProjects(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, `${value}`);
    }
  });

  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return request(`/api/v1/projects${suffix}`);
}

export async function createProject(payload) {
  return request('/api/v1/projects', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchProject(projectId) {
  return request(`/api/v1/projects/${projectId}`);
}

export async function updateProject(projectId, payload) {
  return request(`/api/v1/projects/${projectId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function listProjectVersions(projectId) {
  return request(`/api/v1/projects/${projectId}/versions`);
}

export async function createProjectVersion(projectId, payload) {
  return request(`/api/v1/projects/${projectId}/versions`, {
    method: 'POST',
    body: payload,
  });
}

export async function listTeams() {
  return request('/api/v1/teams');
}

export async function createTeam(payload) {
  return request('/api/v1/teams', {
    method: 'POST',
    body: payload,
  });
}

export async function listTeamMembers(teamId) {
  return request(`/api/v1/teams/${teamId}/members`);
}

export async function createTeamMember(teamId, payload) {
  return request(`/api/v1/teams/${teamId}/members`, {
    method: 'POST',
    body: payload,
  });
}

export async function listReviewComments(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, `${value}`);
    }
  });
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return request(`/api/v1/review-comments${suffix}`);
}

export async function createReviewComment(payload) {
  return request('/api/v1/review-comments', {
    method: 'POST',
    body: payload,
  });
}

export async function updateReviewComment(commentId, payload) {
  return request(`/api/v1/review-comments/${commentId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function createExportJob(payload) {
  return request('/api/v1/exports', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchExportJob(exportJobId) {
  return request(`/api/v1/exports/${exportJobId}`);
}

export async function pollExportJob(exportJobId, options = {}) {
  const intervalMs = options.intervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 60000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await fetchExportJob(exportJobId);

    if (result?.status === 'completed') {
      return result;
    }

    if (result?.status === 'failed') {
      throw new Error(result?.errorMessage || 'Export job failed');
    }

    if (typeof options.onUpdate === 'function') {
      options.onUpdate(result);
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, intervalMs);
    });
  }

  throw new Error('Polling export job timed out');
}

export async function downloadExportJob(exportJobId) {
  const response = await fetch(buildUrl(`/api/v1/exports/${exportJobId}/download`), {
    headers: {
      Accept: 'application/octet-stream',
      [WORKSPACE_HEADER_NAME]: getWorkspaceKey(),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload?.error?.message
      || payload?.message
      || `Backend request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.code || null;
    if (response.status === 401 && authToken) {
      notifyUnauthorized(error, payload);
    }
    throw error;
  }

  const disposition = response.headers.get('Content-Disposition') || '';
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);

  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || `export-${exportJobId}`,
    contentType: response.headers.get('Content-Type') || 'application/octet-stream',
  };
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
