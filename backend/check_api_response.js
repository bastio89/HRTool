// Simuliere genau was der API /candidates zurückgibt
const Database = require('better-sqlite3');
const db = new Database('./data/hrtool.db');

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

// Simuliere GET /candidates (list)
const candidates = db.prepare('SELECT * FROM candidates LIMIT 1').all();
console.log('Raw candidates from DB:', candidates.length);
if (candidates.length > 0) {
  console.log('  ID:', candidates[0].id);
  console.log('  work_history type:', typeof candidates[0].work_history);
}

// Mit parseCandidate
const parsed = candidates.map(parseCandidate);
console.log('\nAfter parseCandidate:');
if (parsed.length > 0) {
  console.log('  ID:', parsed[0].id);
  console.log('  Name:', parsed[0].name);
  console.log('  work_history is array:', Array.isArray(parsed[0].work_history));
  console.log('  work_history length:', parsed[0].work_history?.length);
}

// Simuliere JSON.stringify für API Response
console.log('\nAPI response (JSON.stringify):');
console.log(JSON.stringify({
  data: parsed,
  total: 1,
  page: 1,
  limit: 1,
}).substring(0, 300) + '...');
