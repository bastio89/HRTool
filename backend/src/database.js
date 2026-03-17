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
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
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
  // Matching: Sortierung
  `CREATE INDEX IF NOT EXISTS idx_matching_created_at ON matching_results(created_at)`,
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

// Seed default email templates
const tplCount = db.prepare('SELECT COUNT(*) as count FROM email_templates').get();
if (tplCount.count === 0) {
  const seedTemplates = [
    {
      name: 'Bewerbungseingang',
      subject: 'Ihre Bewerbung bei {{unternehmen}}',
      body: 'Sehr geehrte/r {{vorname}} {{nachname}},\n\nvielen Dank für Ihre Bewerbung. Wir haben Ihre Unterlagen erhalten und werden diese sorgfältig prüfen.\n\nWir melden uns zeitnah bei Ihnen.\n\nMit freundlichen Grüßen\n{{unternehmen}}',
      trigger_stage: 'Beworben',
    },
    {
      name: 'Einladung zum Gespräch',
      subject: 'Einladung zum Vorstellungsgespräch – {{stelle}}',
      body: 'Sehr geehrte/r {{vorname}} {{nachname}},\n\nwir freuen uns, Sie zu einem Vorstellungsgespräch für die Position "{{stelle}}" einzuladen.\n\nBitte teilen Sie uns Ihre Verfügbarkeit mit.\n\nMit freundlichen Grüßen\n{{unternehmen}}',
      trigger_stage: 'Interview',
    },
    {
      name: 'Absage',
      subject: 'Rückmeldung zu Ihrer Bewerbung bei {{unternehmen}}',
      body: 'Sehr geehrte/r {{vorname}} {{nachname}},\n\nvielen Dank für Ihr Interesse an unserem Unternehmen und die Zeit, die Sie in den Bewerbungsprozess investiert haben.\n\nLeider müssen wir Ihnen mitteilen, dass wir uns für andere Kandidaten entschieden haben.\n\nWir wünschen Ihnen für Ihre berufliche Zukunft alles Gute.\n\nMit freundlichen Grüßen\n{{unternehmen}}',
      trigger_stage: 'Abgesagt',
    },
    {
      name: 'Angebot',
      subject: 'Stellenangebot – {{stelle}}',
      body: 'Sehr geehrte/r {{vorname}} {{nachname}},\n\nes freut uns, Ihnen für die Position "{{stelle}}" ein Angebot unterbreiten zu können.\n\nBitte finden Sie die Details im Anhang. Bei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{unternehmen}}',
      trigger_stage: 'Angebot',
    },
  ];
  const insertTpl = db.prepare('INSERT INTO email_templates (name, subject, body, trigger_stage) VALUES (?, ?, ?, ?)');
  for (const tpl of seedTemplates) {
    insertTpl.run(tpl.name, tpl.subject, tpl.body, tpl.trigger_stage);
  }
}

module.exports = db;
