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
`);

// Safe migrations for existing databases
const migrations = [
  `ALTER TABLE candidates ADD COLUMN status TEXT DEFAULT 'Aktiv'`,
  `ALTER TABLE candidates ADD COLUMN tags TEXT`,
  `ALTER TABLE jobs ADD COLUMN url TEXT`,
  `ALTER TABLE candidates ADD COLUMN source TEXT`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

module.exports = db;
