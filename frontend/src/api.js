const API_BASE = '/api';

async function request(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Netzwerkfehler' }));
    throw new Error(error.error || error.details || `HTTP ${response.status}`);
  }

  return response.json();
}

// Candidates API
export const candidatesApi = {
  getAll: (search = '') => request(`/candidates${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getById: (id) => request(`/candidates/${id}`),
  create: (data) => request('/candidates', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/candidates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request(`/candidates/${id}`, { method: 'DELETE' }),
  getStats: () => request('/candidates/stats/overview'),
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
  getAll: (status = '') => request(`/jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getById: (id) => request(`/jobs/${id}`),
  create: (data) => request('/jobs', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/jobs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request(`/jobs/${id}`, { method: 'DELETE' }),
};

// Pipeline API
export const pipelineApi = {
  getByJob: (jobId) => request(`/pipeline/job/${jobId}`),
  addCandidate: (jobId, candidateId, stage) =>
    request(`/pipeline/job/${jobId}/add`, { method: 'POST', body: JSON.stringify({ candidate_id: candidateId, stage }) }),
  updateStage: (entryId, stage) =>
    request(`/pipeline/${entryId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
  removeEntry: (entryId) => request(`/pipeline/${entryId}`, { method: 'DELETE' }),
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
