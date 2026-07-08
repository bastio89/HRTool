const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'hrtool.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    location TEXT,
    experience TEXT,
    skills TEXT,
    education TEXT,
    desired_salary TEXT,
    availability TEXT,
    languages TEXT,
    certificates TEXT,
    drivers_license TEXT,
    mobility TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Aktiv',
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matching_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_description TEXT NOT NULL,
    job_title TEXT,
    results TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    requirements TEXT,
    location TEXT,
    type TEXT DEFAULT 'Vollzeit',
    status TEXT DEFAULT 'Offen',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pipeline_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    stage TEXT NOT NULL DEFAULT 'Beworben',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    UNIQUE(job_id, candidate_id)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'Notiz',
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pipeline_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_entry_id INTEGER NOT NULL,
    author TEXT DEFAULT 'System',
    content TEXT NOT NULL,
    old_stage TEXT,
    new_stage TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pipeline_entry_id) REFERENCES pipeline_entries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS candidate_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'recruiter',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    entity_label TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS candidate_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'gesamt',
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_entry_id INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    interview_date TEXT NOT NULL,
    interview_time TEXT,
    duration_minutes INTEGER DEFAULT 60,
    interview_type TEXT DEFAULT 'vor Ort',
    location TEXT,
    meeting_link TEXT,
    participants TEXT,
    notes TEXT,
    status TEXT DEFAULT 'geplant',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pipeline_entry_id) REFERENCES pipeline_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    feature TEXT NOT NULL,
    model TEXT,
    model_version TEXT,
    prompt_hash TEXT,
    prompt TEXT,
    response TEXT,
    parsed_result TEXT,
    duration_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    success INTEGER DEFAULT 1,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe migrations for existing databases
const migrations = [
  `ALTER TABLE candidates ADD COLUMN status TEXT DEFAULT 'Aktiv'`,
  `ALTER TABLE candidates ADD COLUMN tags TEXT`,
  `ALTER TABLE jobs ADD COLUMN url TEXT`,
  `ALTER TABLE candidates ADD COLUMN source TEXT`,
  `ALTER TABLE matching_results ADD COLUMN human_reviewed INTEGER DEFAULT 0`,
  `ALTER TABLE matching_results ADD COLUMN reviewed_by TEXT`,
  `ALTER TABLE matching_results ADD COLUMN reviewed_at DATETIME`,
  `ALTER TABLE matching_results ADD COLUMN review_notes TEXT`,
  // --- Erweiterung Bewerberprofil ---
  // Social-Media-Profile (#3)
  `ALTER TABLE candidates ADD COLUMN linkedin_url TEXT`,
  `ALTER TABLE candidates ADD COLUMN xing_url TEXT`,
  `ALTER TABLE candidates ADD COLUMN github_url TEXT`,
  `ALTER TABLE candidates ADD COLUMN portfolio_url TEXT`,
  // Gehaltsstruktur (#4)
  `ALTER TABLE candidates ADD COLUMN salary_min INTEGER`,
  `ALTER TABLE candidates ADD COLUMN salary_max INTEGER`,
  `ALTER TABLE candidates ADD COLUMN salary_currency TEXT DEFAULT 'EUR'`,
  `ALTER TABLE candidates ADD COLUMN salary_interval TEXT DEFAULT 'yearly'`,
  // Kündigungsfrist (#5)
  `ALTER TABLE candidates ADD COLUMN notice_period TEXT`,
  `ALTER TABLE candidates ADD COLUMN available_from TEXT`,
  // DSGVO-Einwilligung (#7)
  `ALTER TABLE candidates ADD COLUMN gdpr_consent_date TEXT`,
  `ALTER TABLE candidates ADD COLUMN gdpr_consent_type TEXT`,
  `ALTER TABLE candidates ADD COLUMN gdpr_consent_expires TEXT`,
  // Kandidaten-Foto (#8)
  `ALTER TABLE candidates ADD COLUMN photo_filename TEXT`,
  // Arbeitserlaubnis / Nationalität (#9)
  `ALTER TABLE candidates ADD COLUMN nationality TEXT`,
  `ALTER TABLE candidates ADD COLUMN work_permit TEXT`,
  `ALTER TABLE candidates ADD COLUMN work_permit_until TEXT`,
  // Empfehlungs-Tracking (#11)
  `ALTER TABLE candidates ADD COLUMN referrer_name TEXT`,
  `ALTER TABLE candidates ADD COLUMN referrer_email TEXT`,
  // Aktuelle Position
  `ALTER TABLE candidates ADD COLUMN current_employer TEXT`,
  `ALTER TABLE candidates ADD COLUMN current_position TEXT`,
  // Absagegründe (#6)
  `ALTER TABLE pipeline_entries ADD COLUMN rejection_category TEXT`,
  `ALTER TABLE pipeline_entries ADD COLUMN rejection_details TEXT`,
  // Matching → Pipeline-Link
  `ALTER TABLE matching_results ADD COLUMN job_id INTEGER`,
  // Anrede / Geschlecht
  `ALTER TABLE candidates ADD COLUMN gender TEXT`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

// --- Neue Tabellen für strukturierten Werdegang, Ausbildung, Custom Fields ---

// Strukturierter Werdegang (#1)
db.exec(`
  CREATE TABLE IF NOT EXISTS candidate_work_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    employer TEXT NOT NULL,
    position TEXT NOT NULL,
    from_date TEXT,
    to_date TEXT,
    is_current INTEGER DEFAULT 0,
    description TEXT,
    location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  )
`);

// Strukturierte Ausbildung (#2)
db.exec(`
  CREATE TABLE IF NOT EXISTS candidate_education (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    institution TEXT NOT NULL,
    degree TEXT,
    field_of_study TEXT,
    from_date TEXT,
    to_date TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  )
`);

// Benutzerdefinierte Felder (#12)
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text',
    options TEXT,
    is_required INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS candidate_custom_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    field_id INTEGER NOT NULL,
    value TEXT,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (field_id) REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
    UNIQUE(candidate_id, field_id)
  )
`);

// --- Matching-Gewichtungsprofile ---
db.exec(`
  CREATE TABLE IF NOT EXISTS matching_weight_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    weights TEXT NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Seed a default matching weight profile if none exists
const profileCount = db.prepare('SELECT COUNT(*) as count FROM matching_weight_profiles').get();
if (profileCount.count === 0) {
  db.prepare(`INSERT INTO matching_weight_profiles (name, is_default, weights) VALUES (?, 1, ?)`).run(
    'Standard',
    JSON.stringify({
      skills: 0,
      experience: 0,
      education: 0,
      location: 0,
      languages: 0,
      salary: 0,
      availability: 0,
      certificates: 0,
      cultural_fit: 0,
      mobility: 0
    })
  );
}

// Performance-Indizes
const indexes = [
  // Candidates: Suche, Filter, Sortierung
  `CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_name ON candidates(name)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON candidates(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_source ON candidates(source)`,
  // Jobs: Filter nach Status
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at)`,
  // Pipeline: FK-Lookups & Stage-Filter
  `CREATE INDEX IF NOT EXISTS idx_pipeline_job_id ON pipeline_entries(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_candidate_id ON pipeline_entries(candidate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline_entries(stage)`,
  // Pipeline Notes: FK-Lookup
  `CREATE INDEX IF NOT EXISTS idx_pipeline_notes_entry_id ON pipeline_notes(pipeline_entry_id)`,
  // Activities: FK-Lookup & Sortierung
  `CREATE INDEX IF NOT EXISTS idx_activities_candidate_id ON activities(candidate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at)`,
  // Files: FK-Lookup
  `CREATE INDEX IF NOT EXISTS idx_files_candidate_id ON candidate_files(candidate_id)`,
  // Matching: Sortierung & Lookup (Pipeline-Override-Check, Matrix-Matching)
  `CREATE INDEX IF NOT EXISTS idx_matching_created_at ON matching_results(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_matching_job_id ON matching_results(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_matching_job_title ON matching_results(job_title)`,
  // Audit Log: Lookup & Sortierung
  `CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)`,
  // Ratings: FK & category lookups
  `CREATE INDEX IF NOT EXISTS idx_ratings_candidate ON candidate_ratings(candidate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_category ON candidate_ratings(category)`,
  // Interviews: FK & date lookups
  `CREATE INDEX IF NOT EXISTS idx_interviews_pipeline_entry ON interviews(pipeline_entry_id)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_date ON interviews(interview_date)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews(candidate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_job ON interviews(job_id)`,
  // AI Logs: Feature & Zeitraum-Filter
  `CREATE INDEX IF NOT EXISTS idx_ai_logs_feature ON ai_logs(feature)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at ON ai_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_logs_user_id ON ai_logs(user_id)`,
  // Work History & Education
  `CREATE INDEX IF NOT EXISTS idx_work_history_candidate ON candidate_work_history(candidate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_education_candidate ON candidate_education(candidate_id)`,
  // Custom Fields
  `CREATE INDEX IF NOT EXISTS idx_custom_values_candidate ON candidate_custom_values(candidate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_values_field ON candidate_custom_values(field_id)`,
];
for (const sql of indexes) {
  try { db.exec(sql); } catch (_) { /* index already exists */ }
}

// Seed default admin user if no users exist
const bcrypt = require('bcryptjs');
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run(
    'admin', hash, 'Sebastian Oczachowski', 'admin'
  );
  console.log('📋 Default Admin erstellt: admin / admin123');
}

// Seed default settings
const defaultSettings = [
  ['dsgvo_retention_months', '6'],
];
const upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of defaultSettings) {
  upsertSetting.run(key, value);
}

// --- Scorecard tables for Interview-Bewertungsbögen ---
db.exec(`
  CREATE TABLE IF NOT EXISTS scorecard_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    title TEXT NOT NULL,
    questions TEXT NOT NULL DEFAULT '[]',
    ai_generated INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS scorecard_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    interview_id INTEGER,
    pipeline_entry_id INTEGER,
    candidate_id INTEGER NOT NULL,
    evaluator_name TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '[]',
    total_score REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES scorecard_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE SET NULL,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  )
`);

// --- E-Mail: Templates + Log ---
db.exec(`
  CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    trigger_stage TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    template_id INTEGER,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    error_message TEXT,
    sent_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL,
    FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE SET NULL
  )
`);

// --- Team-Kollaboration: Kommentare + Benachrichtigungen ---
db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    mentions TEXT,
    parent_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    entity_type TEXT,
    entity_id INTEGER,
    is_read INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )
`);

// --- Rollen-Scoping: Fachbereich-Job-Zuweisungen ---
db.exec(`
  CREATE TABLE IF NOT EXISTS user_job_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    UNIQUE(user_id, job_id)
  )
`);

try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_job_access_user ON user_job_access(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_job_access_job ON user_job_access(job_id)`);
} catch (_) {}

// --- Compliance-Aktionen & Risiko-Maßnahmen ---
db.exec(`
  CREATE TABLE IF NOT EXISTS compliance_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_type TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT DEFAULT 'medium',
    assigned_to TEXT,
    notes TEXT,
    due_date TEXT,
    completed_at DATETIME,
    completed_by TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS risk_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    risk_id TEXT NOT NULL UNIQUE,
    manual_status TEXT,
    notes TEXT,
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Seed default email templates
const tplCount = db.prepare('SELECT COUNT(*) as count FROM email_templates').get();
if (tplCount.count === 0) {
  const seedTemplates = [
    {
      name: 'Bewerbungseingang',
      subject: 'Ihre Bewerbung bei {{unternehmen}}',
      body: '{{anrede}},\n\nvielen Dank für Ihre Bewerbung. Wir haben Ihre Unterlagen erhalten und werden diese sorgfältig prüfen.\n\nWir melden uns zeitnah bei Ihnen.\n\nMit freundlichen Grüßen\n{{unternehmen}}',
      trigger_stage: 'Beworben',
    },
    {
      name: 'Einladung zum Gespräch',
      subject: 'Einladung zum Vorstellungsgespräch – {{stelle}}',
      body: '{{anrede}},\n\nwir freuen uns, Sie zu einem Vorstellungsgespräch für die Position "{{stelle}}" einzuladen.\n\nBitte teilen Sie uns Ihre Verfügbarkeit mit.\n\nMit freundlichen Grüßen\n{{unternehmen}}',
      trigger_stage: 'Interview',
    },
    {
      name: 'Absage',
      subject: 'Rückmeldung zu Ihrer Bewerbung bei {{unternehmen}}',
      body: '{{anrede}},\n\nvielen Dank für Ihr Interesse an unserem Unternehmen und die Zeit, die Sie in den Bewerbungsprozess investiert haben.\n\nLeider müssen wir Ihnen mitteilen, dass wir uns für andere Kandidaten entschieden haben.\n\nWir wünschen Ihnen für Ihre berufliche Zukunft alles Gute.\n\nMit freundlichen Grüßen\n{{unternehmen}}',
      trigger_stage: 'Abgesagt',
    },
    {
      name: 'Angebot',
      subject: 'Stellenangebot – {{stelle}}',
      body: '{{anrede}},\n\nes freut uns, Ihnen für die Position "{{stelle}}" ein Angebot unterbreiten zu können.\n\nBitte finden Sie die Details im Anhang. Bei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{unternehmen}}',
      trigger_stage: 'Angebot',
    },
  ];
  const insertTpl = db.prepare('INSERT INTO email_templates (name, subject, body, trigger_stage) VALUES (?, ?, ?, ?)');
  for (const tpl of seedTemplates) {
    insertTpl.run(tpl.name, tpl.subject, tpl.body, tpl.trigger_stage);
  }
}

module.exports = db;
