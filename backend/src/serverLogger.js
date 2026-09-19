const fs = require('fs');
const path = require('path');
const util = require('util');

const logDir = path.join(__dirname, '..', 'data');
const logFilePath = path.join(logDir, 'server.log');

let installed = false;

function ensureLogFile() {
  fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, '', 'utf8');
  }
}

function formatLogLine(level, args) {
  const message = util.format(...args);
  return `${new Date().toISOString()} [${level}] ${message}`;
}

function installServerFileLogger() {
  if (installed) return;
  installed = true;
  ensureLogFile();

  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  };

  const patch = (method, level) => {
    console[method] = (...args) => {
      try {
        fs.appendFileSync(logFilePath, `${formatLogLine(level, args)}\n`, 'utf8');
      } catch {
        // Keep the process output alive even if the log file is not writable.
      }
      originalConsole[method](...args);
    };
  };

  patch('log', 'INFO');
  patch('info', 'INFO');
  patch('warn', 'WARN');
  patch('error', 'ERROR');
  patch('debug', 'DEBUG');
}

function parseLogLine(line) {
  const match = line.match(/^(\S+) \[(\w+)\] (.*)$/);
  if (!match) {
    return { timestamp: null, level: 'INFO', message: line, raw: line };
  }
  return {
    timestamp: match[1],
    level: match[2],
    message: match[3],
    raw: line,
  };
}

function readServerLogEntries({ limit = 200, level = '', search = '' } = {}) {
  ensureLogFile();
  const raw = fs.readFileSync(logFilePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean).map(parseLogLine);
  const normalizedLevel = String(level || '').trim().toUpperCase();
  const normalizedSearch = String(search || '').trim().toLowerCase();

  const filtered = lines.filter((entry) => {
    if (normalizedLevel && entry.level !== normalizedLevel) return false;
    if (normalizedSearch && !entry.raw.toLowerCase().includes(normalizedSearch)) return false;
    return true;
  });

  const total = filtered.length;
  const selected = filtered.slice(-Math.max(1, Math.min(1000, Number(limit) || 200))).reverse();

  return { entries: selected, total, logFilePath };
}

function getServerLogDownloadName() {
  return `server-logs_${new Date().toISOString().slice(0, 10)}.log`;
}

module.exports = {
  installServerFileLogger,
  readServerLogEntries,
  getServerLogDownloadName,
  logFilePath,
};