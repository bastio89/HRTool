// ZIP-Archive lesen, ohne sie auf die Platte zu entpacken. yauzl prueft die
// Dateinamen (keine absoluten Pfade, kein ".."; Backslashes gelten als /) und dass
// die entpackte Groesse der angegebenen entspricht; zusaetzlich gilt hier ein
// Groessenlimit je Datei.

const yauzl = require('yauzl');

class ZipArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipArchiveError';
    this.status = 400;
  }
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (error, zipfile) => {
      if (error) reject(new ZipArchiveError(`Kein gültiges ZIP-Archiv: ${error.message}`));
      else resolve(zipfile);
    });
  });
}

// Geht alle Eintraege durch; visit(entry, zipfile) darf ein Promise liefern
// und mit dem Rueckgabewert true die Suche beenden.
async function walk(filePath, visit) {
  const zipfile = await openZip(filePath);
  try {
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        if (error) reject(error instanceof ZipArchiveError ? error : new ZipArchiveError(`ZIP-Archiv nicht lesbar: ${error.message}`));
        else resolve();
      };
      zipfile.on('error', finish);
      zipfile.on('end', () => finish());
      zipfile.on('entry', (entry) => {
        Promise.resolve(visit(entry, zipfile))
          .then((stop) => (stop ? finish() : zipfile.readEntry()))
          .catch(finish);
      });
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
}

// Liste der Dateien (ohne Verzeichnisse): Map Pfad -> { fileName, size }.
async function listEntries(filePath) {
  const entries = new Map();
  await walk(filePath, (entry) => {
    if (!entry.fileName.endsWith('/')) entries.set(entry.fileName, { fileName: entry.fileName, size: entry.uncompressedSize });
  });
  return entries;
}

function readStream(zipfile, entry, maxBytes) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) return reject(new ZipArchiveError(`${entry.fileName} nicht lesbar: ${error.message}`));
      const chunks = [];
      let total = 0;
      stream.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy();
          reject(new ZipArchiveError(`${entry.fileName} ist größer als erlaubt`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (streamError) => reject(new ZipArchiveError(`${entry.fileName} nicht lesbar: ${streamError.message}`)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

// Liest genau eine Datei des Archivs; null, wenn es sie nicht gibt.
async function readEntry(filePath, fileName, maxBytes) {
  let content = null;
  await walk(filePath, async (entry, zipfile) => {
    if (entry.fileName !== fileName) return false;
    if (entry.uncompressedSize > maxBytes) throw new ZipArchiveError(`${fileName} ist größer als erlaubt (${Math.round(maxBytes / 1048576)} MiB)`);
    content = await readStream(zipfile, entry, maxBytes);
    return true;
  });
  return content;
}

module.exports = { ZipArchiveError, listEntries, readEntry };
