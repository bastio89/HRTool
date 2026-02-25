const API_BASE = '/api';

function authHeaders() {
  const token = localStorage.getItem('hrtool_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...options.headers },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Netzwerkfehler' }));
    throw new Error(error.error || error.details || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  getMe: () => request('/auth/me'),
  getUsers: () => request('/auth/users'),
  createUser: (data) =>
    request('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/auth/users/${id}`, { method: 'DELETE' }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
};

// Candidates API
export const candidatesApi = {
  getAll: (params = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', params.page);
    if (params.limit) q.set('limit', params.limit);
    if (params.sort) q.set('sort', params.sort);
    if (params.order) q.set('order', params.order);
    if (params.skills) q.set('skills', params.skills);
    if (params.status) q.set('status', params.status);
    if (params.location) q.set('location', params.location);
    const qs = q.toString();
    return request(`/candidates${qs ? `?${qs}` : ''}`);
  },
  getById: (id) => request(`/candidates/${id}`),
  create: (data) => request('/candidates', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/candidates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request(`/candidates/${id}`, { method: 'DELETE' }),
  batchDelete: (ids) => request('/candidates/batch/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  batchStatus: (ids, status) => request('/candidates/batch/status', { method: 'POST', body: JSON.stringify({ ids, status }) }),
  getStats: () => request('/candidates/stats/overview'),
  checkDuplicate: (name, email, excludeId) =>
    request('/candidates/check-duplicate', { method: 'POST', body: JSON.stringify({ name, email, excludeId }) }),
};

// Matching API
export const matchingApi = {
  run: (jobDescription, jobTitle, candidateIds = []) =>
    request('/matching/run', {
      method: 'POST',
      body: JSON.stringify({ jobDescription, jobTitle, candidateIds }),
    }),
  getHistory: () => request('/matching/history'),
  getResult: (id) => request(`/matching/history/${id}`),
  deleteResult: (id) => request(`/matching/history/${id}`, { method: 'DELETE' }),
};

// Jobs API
export const jobsApi = {
  getAll: (params = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.page) q.set('page', params.page);
    if (params.limit) q.set('limit', params.limit);
    const qs = q.toString();
    return request(`/jobs${qs ? `?${qs}` : ''}`);
  },
  getById: (id) => request(`/jobs/${id}`),
  create: (data) => request('/jobs', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/jobs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request(`/jobs/${id}`, { method: 'DELETE' }),
};

// Pipeline API
export const pipelineApi = {
  getActiveJobs: () => request('/pipeline/active-jobs'),
  getByJob: (jobId) => request(`/pipeline/job/${jobId}`),
  addCandidate: (jobId, candidateId, stage) =>
    request(`/pipeline/job/${jobId}/add`, { method: 'POST', body: JSON.stringify({ candidate_id: candidateId, stage }) }),
  updateStage: (entryId, stage, notes) =>
    request(`/pipeline/${entryId}/stage`, { method: 'PUT', body: JSON.stringify({ stage, notes }) }),
  removeEntry: (entryId) => request(`/pipeline/${entryId}`, { method: 'DELETE' }),
  getNotes: (entryId) => request(`/pipeline/${entryId}/notes`),
  addNote: (entryId, content) =>
    request(`/pipeline/${entryId}/notes`, { method: 'POST', body: JSON.stringify({ content }) }),
};

// Activities API
export const activitiesApi = {
  getByCandidate: (candidateId) => request(`/activities/candidate/${candidateId}`),
  create: (candidateId, type, content) =>
    request(`/activities/candidate/${candidateId}`, { method: 'POST', body: JSON.stringify({ type, content }) }),
  delete: (id) => request(`/activities/${id}`, { method: 'DELETE' }),
};

// Health
export const healthApi = {
  check: () => request('/health'),
};

// Uploads API
export const uploadsApi = {
  getByCandidate: (candidateId) => request(`/uploads/candidate/${candidateId}`),
  upload: async (candidateId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/uploads/candidate/${candidateId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload fehlgeschlagen' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  },
  getDownloadUrl: (fileId) => `${API_BASE}/uploads/download/${fileId}`,
  delete: (fileId) => request(`/uploads/${fileId}`, { method: 'DELETE' }),
};

// CV Parser API
export const cvParserApi = {
  parse: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/cv-parser/parse`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'CV-Analyse fehlgeschlagen' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  },
};
