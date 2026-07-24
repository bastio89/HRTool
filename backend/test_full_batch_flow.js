const Database = require('better-sqlite3');
const db = new Database('./data/hrtool.db');

// Simuliere: was der CV-Parser zurückgibt
const cvParserResult = {
  success: true,
  candidate: {
    name: "Test User",
    email: "test@example.com",
    work_history: [
      {
        employer: "Test Company",
        position: "Senior Developer",
        from_date: "2020-01",
        to_date: "",
        is_current: true,
        description: "Test work description"
      }
    ],
    education_history: [
      {
        institution: "Test University",
        degree: "BS",
        field_of_study: "CS",
        from_date: "2010-01",
        to_date: "2014-01",
        description: "Test education"
      }
    ]
  }
};

// Simuliere: was BatchCVImportDialog mit den Daten macht
const c = cvParserResult.candidate;
const candidateData = {
  name: c.name,
  email: c.email,
  work_history: Array.isArray(c.work_history) ? c.work_history : [],
  education_history: Array.isArray(c.education_history) ? c.education_history : [],
};

console.log('BatchCVImportDialog creates candidateData:');
console.log('  work_history type:', Array.isArray(candidateData.work_history) ? 'array' : typeof candidateData.work_history);
console.log('  work_history length:', candidateData.work_history.length);
console.log('  education_history type:', Array.isArray(candidateData.education_history) ? 'array' : typeof candidateData.education_history);
console.log('  education_history length:', candidateData.education_history.length);

// Simuliere: was der Backend macht (JSON.stringify for POST)
const bodyToSend = JSON.stringify(candidateData);
console.log('\nSerialized for POST:');
console.log(bodyToSend.substring(0, 200) + '...');

// Simuliere: Backend INSERT
const insertedCandidate = db.prepare(`
  INSERT INTO candidates (name, email, work_history, education_history, status, source)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(
  candidateData.name,
  candidateData.email,
  candidateData.work_history ? JSON.stringify(candidateData.work_history) : null,
  candidateData.education_history ? JSON.stringify(candidateData.education_history) : null,
  'Aktiv',
  'CV-Import'
);

console.log('\nInserted candidate ID:', insertedCandidate.lastInsertRowid);

// Lese zurück
const retrieved = db.prepare('SELECT * FROM candidates WHERE id = ?').get(insertedCandidate.lastInsertRowid);
console.log('\nRetrieved from DB:');
console.log('  name:', retrieved.name);
console.log('  work_history (raw):', retrieved.work_history.substring(0, 80) + '...');

// Wende parseCandidate an
function parseCandidate(candidate) {
  if (!candidate) return candidate;
  try {
    if (candidate.work_history && typeof candidate.work_history === 'string') {
      candidate.work_history = JSON.parse(candidate.work_history);
    } else if (!candidate.work_history) {
      candidate.work_history = [];
    }
    if (candidate.education_history && typeof candidate.education_history === 'string') {
      candidate.education_history = JSON.parse(candidate.education_history);
    } else if (!candidate.education_history) {
      candidate.education_history = [];
    }
  } catch (e) {
    console.error('Error parsing candidate JSON fields:', e);
    candidate.work_history = [];
    candidate.education_history = [];
  }
  return candidate;
}

const parsed = parseCandidate(retrieved);
console.log('\nAfter parseCandidate:');
console.log('  work_history is array:', Array.isArray(parsed.work_history));
console.log('  work_history[0].employer:', parsed.work_history?.[0]?.employer);
console.log('  education_history is array:', Array.isArray(parsed.education_history));
console.log('  education_history[0].institution:', parsed.education_history?.[0]?.institution);
