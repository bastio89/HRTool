/**
 * CRM-Schnittstelle: ZIP aus dem CRM pruefen und importieren (CRM-UUID wird
 * zur UUID des Bewerbers) sowie die Rueckgabe-CSV nach den Regeln des CRM.
 * GraphRAG wird per fetch-Mock ersetzt; laeuft gegen DATABASE_URL wie in CI.
 */
const express = require('express');
const request = require('supertest');
const zlib = require('zlib');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const nativeFetch = global.fetch;
const db = require('../database');
const crmRouter = require('../routes/crm');
const { parseCsv, toCsv, unprotectCell } = require('../crm/csv');
const { splitIntoParts, plainText, LIMITS } = require('../crm/returnExport');
const { extractJobSalary } = require('../crm/salary');
const { ensureMatchingPairSchema } = require('../matchingPairs');
const { cleanupCandidateFiles } = require('../utils/candidateFiles');

const marker = `crm-${Date.now()}`;
const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
const newUuid = () => `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-8${hex().slice(1)}-${hex()}${hex()}${hex()}`;

let graphCalls = [];
let tokens = [];

// Kleines ZIP (Methode "stored") fuer die Tests.
function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const name = Buffer.from(file.name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

async function makePdf(lines) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  lines.forEach((line, index) => page.drawText(line, { x: 40, y: 780 - index * 20, size: 12, font }));
  return Buffer.from(await pdf.save());
}

function makeDocx(lines) {
  const paragraphs = lines.map(line => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('');
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>` },
  ]);
}

// kandidaten.csv wie vom CRM: UTF-8 mit BOM, Komma, CRLF, JSON-Labels.
function candidatesCsv(rows) {
  const quote = value => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [['UUID', 'Vorname', 'Nachname', 'Labels', 'CV_Dokument'], ...rows].map(row => row.map(quote).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

function app(role = 'admin') {
  const instance = express();
  instance.use(express.json());
  instance.use((req, res, next) => {
    req.user = { id: 1, username: role, role };
    next();
  });
  instance.use('/api/crm', crmRouter);
  return instance;
}

async function upload(zip, role) {
  const res = await request(app(role)).post('/api/crm/import').attach('file', zip, 'hr-matching-kandidaten.zip');
  if (res.body.token) tokens.push(res.body.token);
  return res;
}

beforeEach(() => {
  graphCalls = [];
  process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
  global.fetch = jest.fn(async (url, options) => {
    const path = new URL(String(url)).pathname;
    const body = options?.body ? JSON.parse(options.body) : null;
    graphCalls.push({ path, body });
    if (path === '/ingest/candidate') {
      const text = body.raw_text;
      const birth = /Geburtsdatum: (\S+)/.exec(text)?.[1] || null;
      return { ok: true, json: async () => ({ id: '', persisted: false, profile: { name: 'Name aus CV', email: /(\S+@\S+)/.exec(text)?.[1] || null, birth_date: birth, skills: [{ name: 'Projektmanagement' }] } }) };
    }
    if (path === '/sync/candidates') return { ok: true, json: async () => ({ synced: body.candidate_ids.length, failed: 0, errors: [] }) };
    return { ok: false, status: 404, json: async () => ({ detail: `kein Mock fuer ${path}` }) };
  });
});

afterAll(async () => {
  global.fetch = nativeFetch;
  for (const token of tokens) await request(app()).delete(`/api/crm/import/${token}`);
  const ids = db.prepare('SELECT id FROM candidates WHERE name LIKE ? OR email LIKE ?').all(`%${marker}%`, `%${marker}%`).map(row => row.id);
  if (ids.length) {
    cleanupCandidateFiles(db, ids);
    db.prepare(`DELETE FROM candidate_texts WHERE candidate_id IN (${ids.map(() => '?').join(',')})`).run(...ids.map(String));
    db.prepare(`DELETE FROM candidates WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }
  db.prepare('DELETE FROM jobs WHERE title LIKE ?').run(`%${marker}%`);
});

describe('CSV of the interface', () => {
  test('reads quoted cells, CRLF, BOM and removes the formula protection', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","[""Deutsch""]"\r\n\'-5,\'=SUMME\r\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', '["Deutsch"]'], ["'-5", "'=SUMME"]]);
    expect(unprotectCell("'-5")).toBe('-5');
    expect(unprotectCell("'Hallo")).toBe("'Hallo");
    expect(toCsv([['a;b', '-1', 'x']], { bom: false })).toBe('"a;b";\'-1;x\r\n');
  });
});

describe('CRM import', () => {
  test('checks the archive and lists what will happen per candidate', async () => {
    const valid = newUuid();
    const zip = makeZip([
      { name: 'kandidaten.csv', data: candidatesCsv([
        [valid.toUpperCase(), 'Maria', 'Beispiel', '["Deutsch", "Projektleiter"]', `cvs/${valid}.pdf`],
        ['keine-uuid', 'A', 'B', '[]', 'cvs/x.pdf'],
        [valid, 'Doppelt', 'Da', '[]', `cvs/${valid}.pdf`],
        [newUuid(), 'Ohne', 'CV', '[]', 'cvs/fehlt.pdf'],
        [newUuid(), 'Text', 'Datei', '[]', 'cvs/cv.txt'],
        [newUuid(), 'Kaputte', 'Labels', 'Deutsch', 'cvs/cv.pdf'],
      ]) },
      { name: `cvs/${valid}.pdf`, data: await makePdf(['Maria Beispiel']) },
      { name: 'cvs/cv.pdf', data: await makePdf(['x']) },
    ]);

    const res = await upload(zip);

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total: 6, new: 1, update: 0, errors: 5 });
    const [first, ...others] = res.body.rows;
    expect(first).toMatchObject({ uuid: valid, firstName: 'Maria', lastName: 'Beispiel', labels: ['Deutsch', 'Projektleiter'], action: 'new', error: null });
    expect(others.map(row => row.error)).toEqual([
      'UUID fehlt oder ist ungültig',
      'UUID kommt mehrfach vor (auch in Zeile 2)',
      'CV-Datei cvs/fehlt.pdf fehlt im Archiv',
      'CV-Format .txt wird nicht unterstützt (PDF, DOCX, DOC)',
      'Labels sind kein gültiges JSON-Array',
    ]);
  });

  test('rejects archives with paths outside the archive and archives without kandidaten.csv', async () => {
    const evil = await upload(makeZip([{ name: 'kandidaten.csv', data: candidatesCsv([]) }, { name: '../boese.pdf', data: 'x' }]));
    expect(evil.status).toBe(400);
    expect(evil.body.error).toMatch(/invalid relative path/);

    const noCsv = await upload(makeZip([{ name: 'liste.csv', data: 'x' }]));
    expect(noCsv.status).toBe(400);
    expect(noCsv.body.error).toBe('kandidaten.csv fehlt im Archiv');

    const notZip = await upload(Buffer.from('kein zip'));
    expect(notZip.status).toBe(400);
  });

  test('creates the candidate with the CRM UUID, labels as tags and the CV; a second import only updates', async () => {
    const uuid = newUuid();
    const csv = labels => candidatesCsv([[uuid, 'Maria', `Beispiel ${marker}`, labels, `cvs/${uuid}.docx`]]);
    const cv = makeDocx(['Maria Beispiel', `maria.${marker}@example.com`, 'Projektleiterin mit 10 Jahren Erfahrung']);
    const first = await upload(makeZip([{ name: 'kandidaten.csv', data: csv('["Deutsch", "Projektleiter"]') }, { name: `cvs/${uuid}.docx`, data: cv }]));
    expect(first.body.rows[0].action).toBe('new');

    const created = await request(app()).post(`/api/crm/import/${first.body.token}/candidates/${uuid}`);

    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ uuid, status: 'created', warning: null });
    const candidate = db.prepare('SELECT * FROM candidates WHERE uuid = ?').get(uuid);
    expect(candidate).toMatchObject({ name: `Maria Beispiel ${marker}`, tags: 'Deutsch, Projektleiter', source: 'CRM', crm_first_name: 'Maria', crm_last_name: `Beispiel ${marker}`, email: `maria.${marker}@example.com` });
    expect(db.prepare('SELECT original_text, source FROM candidate_texts WHERE candidate_id = CAST(? AS TEXT)').get(candidate.id)).toMatchObject({ source: 'CRM' });
    const files = db.prepare('SELECT original_name, mime_type FROM candidate_files WHERE candidate_id = ?').all(candidate.id);
    expect(files).toEqual([{ original_name: `CV Maria Beispiel ${marker}.docx`, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]);
    await new Promise(resolve => setImmediate(resolve));
    expect(graphCalls.find(call => call.path === '/sync/candidates').body).toEqual({ candidate_ids: [candidate.id] });

    // Gleiches CV, neues Label: kein neues Auslesen, Labels kommen hinzu.
    graphCalls = [];
    const second = await upload(makeZip([{ name: 'kandidaten.csv', data: csv('["Englisch"]') }, { name: `cvs/${uuid}.docx`, data: cv }]));
    expect(second.body.rows[0]).toMatchObject({ action: 'update', existingId: candidate.id });
    const updated = await request(app()).post(`/api/crm/import/${second.body.token}/candidates/${uuid}`);
    expect(updated.body.status).toBe('unchanged');
    expect(graphCalls.some(call => call.path === '/ingest/candidate')).toBe(false);
    expect(db.prepare('SELECT tags FROM candidates WHERE id = ?').get(candidate.id).tags).toBe('Deutsch, Projektleiter, Englisch');
    expect(db.prepare('SELECT COUNT(*) AS count FROM candidates WHERE uuid = ?').get(uuid).count).toBe(1);
  });

  test('a person already in the tool (same name and birth date) is linked to the CRM UUID', async () => {
    const existing = db.prepare("INSERT INTO candidates (name, birth_date, source, tags) VALUES (?, '1985-03-12', 'Manuell', 'Bestand')").run(`Lena Link ${marker}`).lastInsertRowid;
    const uuid = newUuid();
    const zip = makeZip([
      { name: 'kandidaten.csv', data: candidatesCsv([[uuid, 'Lena', `Link ${marker}`, '["Deutsch"]', `cvs/${uuid}.doc`]]) },
      // .doc, das in Wahrheit ein DOCX ist: word-extractor erkennt das am Inhalt.
      { name: `cvs/${uuid}.doc`, data: makeDocx(['Lena Link', 'Geburtsdatum: 1985-03-12', 'Data Engineer seit 2015']) },
    ]);
    const { body } = await upload(zip);

    const res = await request(app()).post(`/api/crm/import/${body.token}/candidates/${uuid}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('linked');
    expect(res.body.candidate.id).toBe(existing);
    expect(db.prepare('SELECT uuid::text AS uuid, tags, source FROM candidates WHERE id = ?').get(existing)).toEqual({ uuid, tags: 'Bestand, Deutsch', source: 'CRM' });
  });

  test('says clearly when GraphRAG is not reachable', async () => {
    const uuid = newUuid();
    const { body } = await upload(makeZip([
      { name: 'kandidaten.csv', data: candidatesCsv([[uuid, 'Julia', `Offline ${marker}`, '["Klient"]', `cvs/${uuid}.docx`]]) },
      { name: `cvs/${uuid}.docx`, data: makeDocx(['Julia Offline', 'Projektleiterin mit langer Erfahrung']) },
    ]));
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); });

    const res = await request(app()).post(`/api/crm/import/${body.token}/candidates/${uuid}`);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('GraphRAG ist nicht erreichbar (ENOTFOUND) – das CV kann nicht ausgewertet werden. Läuft der GraphRAG-Container?');
    expect(db.prepare('SELECT 1 FROM candidates WHERE uuid = ?').get(uuid)).toBeUndefined();
  });

  test('reports a CV without readable text and unknown UUIDs, and is admin only', async () => {
    const uuid = newUuid();
    const { body } = await upload(makeZip([
      { name: 'kandidaten.csv', data: candidatesCsv([[uuid, 'Leer', `CV ${marker}`, '[]', `cvs/${uuid}.pdf`]]) },
      { name: `cvs/${uuid}.pdf`, data: await makePdf(['']) },
    ]));
    const empty = await request(app()).post(`/api/crm/import/${body.token}/candidates/${uuid}`);
    expect(empty.status).toBe(422);
    expect(db.prepare('SELECT 1 FROM candidates WHERE uuid = ?').get(uuid)).toBeUndefined();

    const unknown = await request(app()).post(`/api/crm/import/${body.token}/candidates/${newUuid()}`);
    expect(unknown.status).toBe(404);

    const forbidden = await upload(makeZip([{ name: 'kandidaten.csv', data: candidatesCsv([]) }]), 'recruiter');
    expect(forbidden.status).toBe(403);
  });
});

describe('CRM return CSV', () => {
  let crmCandidate;
  let otherCandidate;

  beforeAll(() => {
    ensureMatchingPairSchema(db);
    crmCandidate = db.prepare("INSERT INTO candidates (name, source, crm_first_name, crm_last_name, uuid) VALUES (?, 'CRM', 'Maria', ?, CAST(? AS UUID))").run(`Maria Rück ${marker}`, `Rück ${marker}`, '11111111-1111-4111-8111-111111111111').lastInsertRowid;
    otherCandidate = db.prepare("INSERT INTO candidates (name, source) VALUES (?, 'CV-Import')").run(`Nicht Crm ${marker}`).lastInsertRowid;
    const job = (title, company, url, extra = {}) => db.prepare(`
      INSERT INTO jobs (title, company, url, location, requirements, raw_text, salary) VALUES (?, ?, ?, 'Zürich', ?, ?, ?)
    `).run(`${title} ${marker}`, company, url, extra.requirements ?? null, extra.raw_text ?? null, extra.salary ?? null).lastInsertRowid;
    const jobs = {
      lead: job('Projektleitung', 'Beispiel AG', `https://example.org/stellen/${marker}/123`, { requirements: '<ul><li>Projektmanagement</li><li>Deutsch &amp; Englisch</li></ul>', raw_text: "Projektleitung\nLohn: CHF 110'000 - 125'000\nAnforderungen ..." }),
      analyst: job('Business Analyst', 'Muster AG', `https://example.org/stellen/${marker}/456`, { salary: 'CHF 95000' }),
      noUrl: job('Ohne URL', 'Muster AG', null),
      noCompany: job('Ohne Firma', null, `https://example.org/stellen/${marker}/789`),
    };
    const pair = db.prepare("INSERT INTO matching_pair_results (method, candidate_id, job_id, score) VALUES (?, ?, ?, ?) RETURNING id");
    pair.run('ai', crmCandidate, jobs.lead, 87.5);
    pair.run('ai', crmCandidate, jobs.analyst, 72);
    pair.run('ai', crmCandidate, jobs.noUrl, 90);
    pair.run('ai', crmCandidate, jobs.noCompany, 91);
    pair.run('ai', otherCandidate, jobs.lead, 99);
    pair.run('vector', crmCandidate, jobs.lead, 40);
  });

  test('previews rows for CRM candidates only and explains excluded pairs', async () => {
    const res = await request(app()).get('/api/crm/return/preview').query({ method: 'ai', score_above: 50 });
    expect(res.status).toBe(200);
    const mine = res.body.sample.filter(row => row.Firma && row.UUID === '11111111-1111-4111-8111-111111111111');
    expect(mine.map(row => row.Stelle)).toEqual([`Projektleitung ${marker}`, `Business Analyst ${marker}`]);
    const excluded = res.body.excluded.filter(entry => entry.candidateId === crmCandidate);
    expect(excluded.map(entry => entry.reasons)).toEqual([['Stelle ohne Firma'], ['Stelle ohne URL']]);
    expect(res.body.excluded.some(entry => entry.candidateId === otherCandidate)).toBe(false);
  });

  test('writes exactly the CRM format: semicolon, BOM, header, salary of the job, plain text', async () => {
    const res = await request(app()).get('/api/crm/return/download').query({ method: 'ai', score_above: 80 });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="hr-matching-rueckgabe-ki.csv"');
    expect(res.text.startsWith('﻿UUID;Vorname;Nachname;Firma;Stelle;URL;Matching;Bewerbungsdatum;Startdatum;Ort;Lohnvorstellung;Anforderungen;Status\r\n')).toBe(true);
    const rows = parseCsv(res.text).slice(1).filter(row => row[0] === '11111111-1111-4111-8111-111111111111');
    expect(rows).toEqual([[
      '11111111-1111-4111-8111-111111111111', 'Maria', `Rück ${marker}`, 'Beispiel AG', `Projektleitung ${marker}`,
      `https://example.org/stellen/${marker}/123`, '87.5', '', '', 'Zürich', "CHF 110'000 - 125'000", '• Projektmanagement\n• Deutsch & Englisch', '',
    ]]);
    expect(res.text).not.toMatch(/[<>]/);

    const vector = await request(app()).get('/api/crm/return/download').query({ method: 'vector', score_above: 50 });
    expect(vector.status).toBe(404);
  });

  test('uses the salary field of the job before the text and rejects bad input', async () => {
    const res = await request(app()).get('/api/crm/return/download').query({ method: 'ai', score_above: 70 });
    const analyst = parseCsv(res.text).find(row => row[4] === `Business Analyst ${marker}`);
    expect(analyst[10]).toBe('CHF 95000');
    expect((await request(app()).get('/api/crm/return/preview').query({ method: 'x' })).status).toBe(400);
    expect((await request(app()).get('/api/crm/return/preview').query({ method: 'ai', score_above: 120 })).status).toBe(400);
  });

  test('splits into files of at most 5000 rows and below 5 MiB', () => {
    const row = ['u', 'v', 'n', 'f', 's', 'https://x', '50', '', '', 'o', '', 'x'.repeat(LIMITS.text), ''];
    const parts = splitIntoParts(Array.from({ length: 600 }, () => row));
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect(Buffer.byteLength(toCsv(part), 'utf8')).toBeLessThan(5 * 1024 * 1024);
    expect(splitIntoParts(Array.from({ length: 12001 }, () => ['a'])).map(part => part.length)).toEqual([5000, 5000, 2001]);
    expect(plainText('Erfahrung > 5 Jahre<br>gut')).toBe('Erfahrung › 5 Jahre\ngut');
  });
});

describe('salary of a job', () => {
  test.each([
    ["Lohn: CHF 100'000 - 120'000 brutto pro Jahr", "CHF 100'000 - 120'000 brutto pro Jahr"],
    ["Wir bieten einen Jahreslohn von CHF 95'000.– bis 110'000.–", "CHF 95'000.– bis 110'000.–"],
    ['Gehalt: 65.000 – 75.000 € p.a.', '65.000 – 75.000 € p.a.'],
    ['<p>Bruttojahresgehalt</p><p>EUR 60.000</p>', 'EUR 60.000'],
    ['Lohn: nach Vereinbarung', null],
    ["Projektbudget von CHF 2'000'000", null],
    ["Attraktiver Lohn.\nUmsatz CHF 5'000'000", null],
  ])('%s', (text, expected) => {
    expect(extractJobSalary([text])).toBe(expected);
  });
});
