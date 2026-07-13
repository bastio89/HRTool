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

// Get latest candidate
const latest = db.prepare('SELECT id, name, work_history, education_history FROM candidates ORDER BY id DESC LIMIT 1').get();
console.log('Latest candidate ID:', latest.id);
console.log('Name:', latest.name);

const parsed = parseCandidate(latest);
console.log('\nAfter parsing:');
console.log('work_history is array:', Array.isArray(parsed.work_history));
console.log('work_history length:', parsed.work_history.length);
console.log('education_history is array:', Array.isArray(parsed.education_history));
console.log('education_history length:', parsed.education_history.length);

if (parsed.work_history.length > 0) {
  console.log('\nFirst work entry:');
  console.log('  Position:', parsed.work_history[0].position);
  console.log('  Employer:', parsed.work_history[0].employer);
}
