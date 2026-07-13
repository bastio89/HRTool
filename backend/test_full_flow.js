const Database = require('better-sqlite3');
const path = require('path');
const db = new Database('./data/hrtool.db');

// Kopiere die exakte parseCandidate-Funktion aus candidates.js
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

// Simuliere GET /candidates/:id
const candidate = db.prepare('SELECT * FROM candidates WHERE id = 39').get();
console.log('Raw candidate from DB:', { id: candidate.id, name: candidate.name, work_history_type: typeof candidate.work_history });

const result = parseCandidate(candidate);
console.log('\nAfter parseCandidate:');
console.log(JSON.stringify({
  id: result.id,
  name: result.name,
  work_history: result.work_history,
  education_history: result.education_history,
}, null, 2));
