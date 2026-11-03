const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads');

// Loescht die hochgeladenen Dateien (CVs, Fotos ...) der Bewerber von der
// Platte. Muss vor dem DELETE laufen, weil candidate_files per CASCADE
// mitgeloescht wird und die Dateinamen danach fehlen.
function cleanupCandidateFiles(db, candidateIds) {
  const ids = (Array.isArray(candidateIds) ? candidateIds : [candidateIds]).filter(id => id !== undefined && id !== null);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  const files = db.prepare(`SELECT filename FROM candidate_files WHERE candidate_id IN (${placeholders})`).all(...ids);
  for (const file of files) {
    const filePath = path.join(uploadsDir, file.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to delete file ${filePath}:`, err.message);
    }
  }
}

module.exports = { cleanupCandidateFiles, uploadsDir };
