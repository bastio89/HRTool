// Fehler mit einer fuer Anwender lesbaren Meldung. Eigene Datei, damit auch
// die Entitaeten ihn werfen koennen, ohne index.js zirkulaer zu laden.
class ExportValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportValidationError';
    this.status = 400;
  }
}

module.exports = { ExportValidationError };
