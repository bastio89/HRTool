#!/usr/bin/env node

const bcrypt = require('bcryptjs');
const db = require('../src/database');

const username = process.env.ADMIN_USERNAME || process.argv[2] || 'admin';
const password = process.env.ADMIN_PASSWORD || process.argv[3] || 'admin123';
const displayName = process.env.ADMIN_DISPLAY_NAME || process.argv[4] || 'Sebastian Oczachowski';
const role = process.env.ADMIN_ROLE || 'admin';

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
const hash = bcrypt.hashSync(password, 10);

if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, display_name = ?, role = ? WHERE username = ?').run(
    hash,
    displayName,
    role,
    username,
  );
  console.log(`Updated user: ${username}`);
} else {
  db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run(
    username,
    hash,
    displayName,
    role,
  );
  console.log(`Created user: ${username}`);
}

console.log(`Login reset complete for ${username}`);
console.log(`Username: ${username}`);
console.log(`Password: ${password}`);
db.close();