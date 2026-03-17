const API_BASE = '/api';

function authHeaders() {
  const token = localStorage.getItem('hrtool_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(url, options = {}) {
  const { timeout, ...fetchOptions } = options;
  let controller, timeoutId;
  if (timeout) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${url}`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...fetchOptions.headers },
      ...fetchOptions,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Zeitüberschreitung — die Anfrage hat zu lange gedauert. Bitte erneut versuchen.');
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

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
  resetPassword: (id, newPassword) =>
    request(`/auth/users/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ newPassword }) }),
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
    if (params.tags) q.set('tags', params.tags);
    const qs = q.toString();
    return request(`/candidates${qs ? `?${qs}` : ''}`);
  },
  getById: (id) => request(`/candidates/${id}`),
  getHistory: (id) => request(`/candidates/${id}/history`),
  create: (data) => request('/candidates', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/candidates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request(`/candidates/${id}`, { method: 'DELETE' }),
  batchDelete: (ids) => request('/candidates/batch/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  batchStatus: (ids, status) => request('/candidates/batch/status', { method: 'POST', body: JSON.stringify({ ids, status }) }),
  importCSV: (rows, skipDuplicates = true) => request('/candidates/import', { method: 'POST', body: JSON.stringify({ rows, skipDuplicates }) }),
  getStats: (days) => request(`/candidates/stats/overview${days ? `?days=${days}` : ''}`),
  getSourceStats: () => request('/candidates/stats/sources'),
  getTimeToHire: () => request('/candidates/stats/time-to-hire'),
  getTags: () => request('/candidates/stats/tags'),
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
  reviewResult: (id, notes) => request(`/matching/history/${id}/review`, { method: 'PUT', body: JSON.stringify({ notes }) }),
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
  generateDescription: (data) => request('/jobs/generate-description', { method: 'POST', body: JSON.stringify(data), timeout: 200000 }),
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

// Audit-Log API
export const auditApi = {
  getLog: (params = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', params.page);
    if (params.limit) q.set('limit', params.limit);
    if (params.entity_type) q.set('entity_type', params.entity_type);
    if (params.action) q.set('action', params.action);
    if (params.search) q.set('search', params.search);
    if (params.date_from) q.set('date_from', params.date_from);
    if (params.date_to) q.set('date_to', params.date_to);
    const qs = q.toString();
    return request(`/audit${qs ? `?${qs}` : ''}`);
  },
  getStats: () => request('/audit/stats'),
  exportCSV: async (filters = {}) => {
    const q = new URLSearchParams();
    if (filters.entity_type) q.set('entity_type', filters.entity_type);
    if (filters.action) q.set('action', filters.action);
    if (filters.search) q.set('search', filters.search);
    if (filters.date_from) q.set('date_from', filters.date_from);
    if (filters.date_to) q.set('date_to', filters.date_to);
    const qs = q.toString();
    const token = localStorage.getItem('token');
    const resp = await fetch(`/api/audit/export${qs ? `?${qs}` : ''}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error('Export fehlgeschlagen');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
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
  getDownloadUrl: (fileId) => {
    const token = localStorage.getItem('hrtool_token');
    return `${API_BASE}/uploads/download/${fileId}${token ? `?token=${token}` : ''}`;
  },
  getPreviewUrl: (fileId) => {
    const token = localStorage.getItem('hrtool_token');
    return `${API_BASE}/uploads/preview/${fileId}${token ? `?token=${token}` : ''}`;
  },
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

// AI-Logs API (EU AI Act Compliance)
export const aiLogsApi = {
  getAll: (params = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', params.page);
    if (params.limit) q.set('limit', params.limit);
    if (params.feature) q.set('feature', params.feature);
    if (params.success) q.set('success', params.success);
    if (params.date_from) q.set('date_from', params.date_from);
    if (params.date_to) q.set('date_to', params.date_to);
    const qs = q.toString();
    return request(`/ai-logs${qs ? `?${qs}` : ''}`);
  },
  getById: (id) => request(`/ai-logs/${id}`),
  getStats: () => request('/ai-logs/stats/overview'),
  getBiasReport: () => request('/ai-logs/stats/bias-report'),
  getCompliance: () => request('/ai-logs/compliance/checklist'),
  getModelCard: () => request('/ai-logs/model-card'),
  getRiskRegister: () => request('/ai-logs/risk-register'),
  getBiasTestset: () => request('/ai-logs/bias-testset'),
  runBiasTest: (data) => request('/ai-logs/bias-testset/run', { method: 'POST', body: JSON.stringify(data), timeout: 300000 }),
  getExplanation: (logId) => request(`/ai-logs/explain/${logId}`),
  getBiasAlerts: () => request('/ai-logs/bias-alerts'),
};

// Email API
export const emailApi = {
  getSmtpSettings: () => request('/emails/smtp/settings'),
  saveSmtpSettings: (data) =>
    request('/emails/smtp/settings', { method: 'PUT', body: JSON.stringify(data) }),
  testSmtp: () => request('/emails/smtp/test', { method: 'POST' }),
  getTriggers: () => request('/emails/triggers'),
  saveTriggers: (triggers) =>
    request('/emails/triggers', { method: 'PUT', body: JSON.stringify({ triggers }) }),
  getTemplates: () => request('/emails/templates'),
  getTemplate: (id) => request(`/emails/templates/${id}`),
  createTemplate: (data) =>
    request('/emails/templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id, data) =>
    request(`/emails/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTemplate: (id) => request(`/emails/templates/${id}`, { method: 'DELETE' }),
  generateTemplate: (data) =>
    request('/emails/generate-template', { method: 'POST', body: JSON.stringify(data), timeout: 130000 }),
  send: (data) =>
    request('/emails/send', { method: 'POST', body: JSON.stringify(data) }),
  sendWithTemplate: (data) =>
    request('/emails/send-with-template', { method: 'POST', body: JSON.stringify(data) }),
  preview: (data) =>
    request('/emails/preview', { method: 'POST', body: JSON.stringify(data) }),
  getLog: (params = {}) => {
    const q = new URLSearchParams();
    if (params.candidate_id) q.set('candidate_id', params.candidate_id);
    if (params.page) q.set('page', params.page);
    if (params.limit) q.set('limit', params.limit);
    const qs = q.toString();
    return request(`/emails/log${qs ? `?${qs}` : ''}`);
  },
};

// Settings API
export const settingsApi = {
  getAll: () => request('/settings'),
  update: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  getExpired: () => request('/settings/dsgvo/expired'),
  deleteExpired: () => request('/settings/dsgvo/delete-expired', { method: 'DELETE' }),
};

// Ratings API
export const ratingsApi = {
  getByCandidate: (candidateId) => request(`/ratings/candidate/${candidateId}`),
  getAverage: (candidateId) => request(`/ratings/candidate/${candidateId}/average`),
  getBatchAverages: (candidateIds) => request('/ratings/candidates/averages', { method: 'POST', body: JSON.stringify({ candidateIds }) }),
  create: (candidateId, data) => request(`/ratings/candidate/${candidateId}`, { method: 'POST', body: JSON.stringify(data) }),
  delete: (id) => request(`/ratings/${id}`, { method: 'DELETE' }),
};

// Interviews API
export const interviewsApi = {
  getAll: (params = {}) => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.status) q.set('status', params.status);
    const qs = q.toString();
    return request(`/interviews${qs ? `?${qs}` : ''}`);
  },
  getUpcoming: () => request('/interviews/upcoming'),
  getByPipelineEntry: (entryId) => request(`/interviews/pipeline/${entryId}`),
  create: (data) => request('/interviews', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/interviews/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request(`/interviews/${id}`, { method: 'DELETE' }),
};

// Scorecards API
export const scorecardsApi = {
  getTemplates: (jobId) => request(`/scorecards/templates${jobId ? `?job_id=${jobId}` : ''}`),
  getTemplate: (id) => request(`/scorecards/templates/${id}`),
  createTemplate: (data) => request('/scorecards/templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id, data) => request(`/scorecards/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTemplate: (id) => request(`/scorecards/templates/${id}`, { method: 'DELETE' }),
  getResponses: (params = {}) => {
    const q = new URLSearchParams();
    if (params.candidate_id) q.set('candidate_id', params.candidate_id);
    if (params.interview_id) q.set('interview_id', params.interview_id);
    if (params.template_id) q.set('template_id', params.template_id);
    return request(`/scorecards/responses?${q.toString()}`);
  },
  createResponse: (data) => request('/scorecards/responses', { method: 'POST', body: JSON.stringify(data) }),
  deleteResponse: (id) => request(`/scorecards/responses/${id}`, { method: 'DELETE' }),
  compareResponses: (candidateId) => request(`/scorecards/responses/compare?candidate_id=${candidateId}`),
  generateQuestions: (data) => request('/scorecards/generate-questions', { method: 'POST', body: JSON.stringify(data), timeout: 180000 }),
};

// Collaboration API (Team-Kollaboration)
export const collaborationApi = {
  getComments: (entityType, entityId) => request(`/collaboration/comments?entity_type=${entityType}&entity_id=${entityId}`),
  createComment: (data) => request('/collaboration/comments', { method: 'POST', body: JSON.stringify(data) }),
  deleteComment: (id) => request(`/collaboration/comments/${id}`, { method: 'DELETE' }),
  getCommentCounts: (entityType, entityIds) => request(`/collaboration/comments/count?entity_type=${entityType}&entity_ids=${entityIds.join(',')}`),
  getNotifications: (params = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', params.page);
    if (params.unread) q.set('unread', params.unread);
    const qs = q.toString();
    return request(`/collaboration/notifications${qs ? `?${qs}` : ''}`);
  },
  markRead: (id) => request(`/collaboration/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () => request('/collaboration/notifications/read-all', { method: 'PUT' }),
  getUnreadCount: () => request('/collaboration/notifications/unread-count'),
  getUsers: () => request('/collaboration/users'),
};

// Candidate Details API (Werdegang, Ausbildung, Foto, Custom Fields, Merge)
export const candidateDetailsApi = {
  // Work History
  getWorkHistory: (candidateId) => request(`/candidate-details/${candidateId}/work-history`),
  addWorkHistory: (candidateId, data) => request(`/candidate-details/${candidateId}/work-history`, { method: 'POST', body: JSON.stringify(data) }),
  updateWorkHistory: (id, data) => request(`/candidate-details/work-history/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWorkHistory: (id) => request(`/candidate-details/work-history/${id}`, { method: 'DELETE' }),
  bulkWorkHistory: (candidateId, entries) => request(`/candidate-details/${candidateId}/work-history/bulk`, { method: 'POST', body: JSON.stringify({ entries }) }),
  // Education
  getEducation: (candidateId) => request(`/candidate-details/${candidateId}/education`),
  addEducation: (candidateId, data) => request(`/candidate-details/${candidateId}/education`, { method: 'POST', body: JSON.stringify(data) }),
  updateEducation: (id, data) => request(`/candidate-details/education/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEducation: (id) => request(`/candidate-details/education/${id}`, { method: 'DELETE' }),
  bulkEducation: (candidateId, entries) => request(`/candidate-details/${candidateId}/education/bulk`, { method: 'POST', body: JSON.stringify({ entries }) }),
  // Photo
  uploadPhoto: async (candidateId, file) => {
    const formData = new FormData();
    formData.append('photo', file);
    const response = await fetch(`${API_BASE}/candidate-details/${candidateId}/photo`, { method: 'POST', headers: authHeaders(), body: formData });
    if (!response.ok) { const err = await response.json().catch(() => ({ error: 'Upload fehlgeschlagen' })); throw new Error(err.error); }
    return response.json();
  },
  deletePhoto: (candidateId) => request(`/candidate-details/${candidateId}/photo`, { method: 'DELETE' }),
  getPhotoUrl: (candidateId) => {
    const token = localStorage.getItem('hrtool_token');
    return `${API_BASE}/candidate-details/${candidateId}/photo${token ? `?token=${token}` : ''}`;
  },
  // Custom Fields
  getCustomFieldDefinitions: () => request('/candidate-details/custom-fields/definitions'),
  createCustomField: (data) => request('/candidate-details/custom-fields/definitions', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomField: (id, data) => request(`/candidate-details/custom-fields/definitions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomField: (id) => request(`/candidate-details/custom-fields/definitions/${id}`, { method: 'DELETE' }),
  getCustomValues: (candidateId) => request(`/candidate-details/${candidateId}/custom-fields`),
  saveCustomValues: (candidateId, values) => request(`/candidate-details/${candidateId}/custom-fields`, { method: 'PUT', body: JSON.stringify({ values }) }),
  // Merge
  merge: (keepId, mergeId) => request('/candidate-details/merge', { method: 'POST', body: JSON.stringify({ keepId, mergeId }) }),
};

// Reports API (Reporting & Analytics)
export const reportsApi = {
  getOverview: (days) => request(`/reports/overview${days ? `?days=${days}` : ''}`),
  getPipelineFunnel: (jobId) => request(`/reports/pipeline-funnel${jobId ? `?job_id=${jobId}` : ''}`),
  getTimeToHire: () => request('/reports/time-to-hire'),
  getSourceEffectiveness: () => request('/reports/source-effectiveness'),
  getActivityTimeline: (days) => request(`/reports/activity-timeline${days ? `?days=${days}` : ''}`),
  getTeamPerformance: (days) => request(`/reports/team-performance${days ? `?days=${days}` : ''}`),
  exportCSV: async (type) => {
    const token = localStorage.getItem('hrtool_token');
    const resp = await fetch(`/api/reports/export/csv?type=${type}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error('Export fehlgeschlagen');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
