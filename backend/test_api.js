const Database = require('better-sqlite3');
const db = new Database('./data/hrtool.db');

function parseCandidate(candidate) {
  console.log('Input candidate:', candidate ? 'exists' : 'null');
  if (!candidate) return candidate;
  console.log('Before parsing - work_history type:', typeof candidate.work_history);
  try {
    if (candidate.work_history && typeof candidate.work_history === 'string') {
      candidate.work_history = JSON.parse(candidate.work_history);
      console.log('Parsed work_history, now array:', Array.isArray(candidate.work_history));
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

const candidate = db.prepare('SELECT * FROM candidates WHERE id = 34').get();
const parsed = parseCandidate(candidate);

console.log('After parse - work_history is array:', Array.isArray(parsed?.work_history));
console.log('After parse - work_history length:', parsed?.work_history?.length);
if (parsed?.work_history?.[0]) {
  console.log('First entry employer:', parsed.work_history[0].employer);
}
