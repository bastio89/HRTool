const Database = require('better-sqlite3');
const db = new Database('./data/hrtool.db');

const candidate = db.prepare('SELECT * FROM candidates WHERE id = 34').get();
console.log('Keys:', Object.keys(candidate).sort());
console.log('---');
console.log('work_history exists:', 'work_history' in candidate);
console.log('work_history type:', typeof candidate.work_history);
console.log('work_history value:', candidate.work_history?.substring?.(0, 150));
