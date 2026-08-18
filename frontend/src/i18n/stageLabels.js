// Pipeline stages and job statuses are stored in German (matching the backend's
// fixed values) and used directly as keys throughout the app. These maps let
// display code render them through the DE/EN translation system while the
// underlying value stays unchanged for comparisons, API calls, and styling.
const STAGE_KEYS = {
  Beworben: 'stage.applied',
  Vorauswahl: 'stage.preselection',
  Interview: 'stage.interview',
  Angebot: 'stage.offer',
  Hired: 'stage.hired',
  Abgesagt: 'stage.rejected',
}

const JOB_STATUS_KEYS = {
  Offen: 'jobs.status_open',
  Besetzt: 'jobs.status_filled',
  Pausiert: 'jobs.status_paused',
  Archiviert: 'jobs.status_archived',
}

const JOB_TYPE_KEYS = {
  Vollzeit: 'jobs.type_fulltime',
  Teilzeit: 'jobs.type_parttime',
  Freelance: 'jobs.type_freelance',
  Praktikum: 'jobs.type_internship',
  Werkstudent: 'jobs.type_workstudy',
}

export function stageLabel(t, stage) {
  if (!stage) return stage
  return t(STAGE_KEYS[stage] || stage, stage)
}

export function jobStatusLabel(t, status) {
  if (!status) return status
  return t(JOB_STATUS_KEYS[status] || status, status)
}

export function jobTypeLabel(t, type) {
  if (!type) return type
  return t(JOB_TYPE_KEYS[type] || type, type)
}
