const express = require('express');
const request = require('supertest');
const path = require('path');

const nativeFetch = globalThis.fetch;
const nativeOllamaModel = process.env.OLLAMA_MODEL;
const nativeOllamaBaseUrl = process.env.OLLAMA_BASE_URL;
const nativeAiProvider = process.env.AI_PROVIDER;
const nativeGraphRagBaseUrl = process.env.GRAPHRAG_BASE_URL;

function createMockDb(seed = {}) {
  const state = {
    candidates: seed.candidates ? [...seed.candidates] : [],
    jobs: seed.jobs ? [...seed.jobs] : [],
    candidateFiles: seed.candidateFiles ? [...seed.candidateFiles] : [],
    candidateWorkHistory: seed.candidateWorkHistory ? [...seed.candidateWorkHistory] : [],
    candidateEducation: seed.candidateEducation ? [...seed.candidateEducation] : [],
    activities: seed.activities ? [...seed.activities] : [],
    aiLogs: seed.aiLogs ? [...seed.aiLogs] : [],
    matchingResults: seed.matchingResults ? [...seed.matchingResults] : [],
    seq: {
      candidateId: 1,
      candidateFileId: 1,
      jobId: 1,
      matchingId: 1,
      ...seed.seq,
    },
  };

  const normalize = (sql) => sql.replace(/\s+/g, ' ').trim();

  const db = {
    __state: state,
    transaction(fn) {
      return (...args) => fn(...args);
    },
    prepare(sql) {
      const q = normalize(sql);

      return {
        get: (...args) => {
          if (q.includes('SELECT id FROM candidates WHERE id = ?')) {
            return state.candidates.find((c) => c.id === Number(args[0]));
          }

          if (q.includes('SELECT * FROM candidates WHERE id = ?')) {
            return state.candidates.find((c) => c.id === Number(args[0]));
          }

          if (q.includes('SELECT * FROM candidate_files WHERE id = ?')) {
            return state.candidateFiles.find((f) => f.id === Number(args[0]));
          }

          if (q.includes('SELECT * FROM jobs WHERE id = ?')) {
            return state.jobs.find((j) => j.id === Number(args[0]));
          }

          return undefined;
        },

        all: (...args) => {
          if (q.includes('FROM candidates WHERE id IN')) {
            const ids = args.map(Number);
            return state.candidates.filter((c) => ids.includes(c.id));
          }

          if (q.includes('FROM candidates')) {
            return [...state.candidates];
          }

          if (q.includes('SELECT * FROM candidate_files WHERE candidate_id = ?')) {
            return state.candidateFiles.filter((f) => f.candidate_id === Number(args[0]));
          }

          if (q.includes('SELECT * FROM candidate_work_history WHERE candidate_id = ?')) {
            return state.candidateWorkHistory.filter((f) => f.candidate_id === Number(args[0]));
          }

          if (q.includes('SELECT * FROM candidate_education WHERE candidate_id = ?')) {
            return state.candidateEducation.filter((f) => f.candidate_id === Number(args[0]));
          }

          return [];
        },

        run: (...args) => {
          if (q.includes('INSERT INTO candidates')) {
            const [
              name, email, phone, location, experience, skills,
              education, desiredSalary, availability, languages,
              certificates, driversLicense, mobility, notes, status, tags, source,
              linkedinUrl, xingUrl, githubUrl, portfolioUrl,
              salaryMin, salaryMax, salaryCurrency, salaryInterval,
              noticePeriod, availableFrom,
              gdprConsentDate, gdprConsentType, gdprConsentExpires,
              nationality, workPermit, workPermitUntil,
              referrerName, referrerEmail,
              currentEmployer, currentPosition, gender,
            ] = args;

            const row = {
              id: state.seq.candidateId++,
              name,
              email,
              phone,
              location,
              experience,
              skills,
              education,
              desired_salary: desiredSalary,
              availability,
              languages,
              certificates,
              drivers_license: driversLicense,
              mobility,
              notes,
              status,
              tags,
              source,
              linkedin_url: linkedinUrl,
              xing_url: xingUrl,
              github_url: githubUrl,
              portfolio_url: portfolioUrl,
              salary_min: salaryMin,
              salary_max: salaryMax,
              salary_currency: salaryCurrency,
              salary_interval: salaryInterval,
              notice_period: noticePeriod,
              available_from: availableFrom,
              gdpr_consent_date: gdprConsentDate,
              gdpr_consent_type: gdprConsentType,
              gdpr_consent_expires: gdprConsentExpires,
              nationality,
              work_permit: workPermit,
              work_permit_until: workPermitUntil,
              referrer_name: referrerName,
              referrer_email: referrerEmail,
              current_employer: currentEmployer,
              current_position: currentPosition,
              gender,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            state.candidates.push(row);
            return { lastInsertRowid: row.id };
          }

          if (q.includes('INSERT INTO candidate_files')) {
            const [candidateId, filename, originalName, mimeType, size] = args;
            const row = {
              id: state.seq.candidateFileId++,
              candidate_id: Number(candidateId),
              filename,
              original_name: originalName,
              mime_type: mimeType,
              size,
              created_at: new Date().toISOString(),
            };
            state.candidateFiles.push(row);
            return { lastInsertRowid: row.id };
          }

          if (q.includes('INSERT INTO candidate_work_history')) {
            const [candidateId, employer, position, fromDate, toDate, isCurrent, description, location] = args;
            if (!employer || !position) {
              throw new Error('candidate_work_history requires employer and position');
            }
            const row = {
              id: state.candidateWorkHistory.length + 1,
              candidate_id: Number(candidateId),
              employer,
              position,
              from_date: fromDate,
              to_date: toDate,
              is_current: isCurrent,
              description,
              location,
              created_at: new Date().toISOString(),
            };
            state.candidateWorkHistory.push(row);
            return { lastInsertRowid: row.id };
          }

          if (q.includes('INSERT INTO candidate_education')) {
            const [candidateId, institution, degree, fieldOfStudy, fromDate, toDate, description] = args;
            if (!institution) {
              throw new Error('candidate_education requires institution');
            }
            const row = {
              id: state.candidateEducation.length + 1,
              candidate_id: Number(candidateId),
              institution,
              degree,
              field_of_study: fieldOfStudy,
              from_date: fromDate,
              to_date: toDate,
              description,
              created_at: new Date().toISOString(),
            };
            state.candidateEducation.push(row);
            return { lastInsertRowid: row.id };
          }

          if (q.includes('INSERT INTO activities')) {
            const [candidateId, type, content] = args;
            state.activities.push({
              id: state.activities.length + 1,
              candidate_id: Number(candidateId),
              type,
              content,
              created_at: new Date().toISOString(),
            });
            return { lastInsertRowid: state.activities.length };
          }

          if (q.includes('INSERT INTO ai_logs')) {
            const [userId, feature, model, modelVersion, promptHash, prompt, response, parsedResult, skills, durationMs, inputTokens, outputTokens, success, errorMessage] = args;
            const row = {
              id: state.aiLogs.length + 1,
              user_id: userId,
              feature,
              model,
              model_version: modelVersion,
              prompt_hash: promptHash,
              prompt,
              response,
              parsed_result: parsedResult,
              skills,
              duration_ms: durationMs,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              success,
              error_message: errorMessage,
              created_at: new Date().toISOString(),
            };
            state.aiLogs.push(row);
            return { lastInsertRowid: row.id };
          }

          if (q.includes('INSERT INTO jobs')) {
            const [
              title,
              maybeAboutUs,
              maybeDescription,
              maybeRequirements,
              maybeSkills,
              maybeBenefits,
              maybeLocation,
              maybeType,
              maybeStatus,
              maybeUrl,
            ] = args;

            // Support both legacy 7-arg and current 10-arg INSERT signatures.
            const hasExtendedShape = args.length >= 10;
            const row = {
              id: state.seq.jobId++,
              title,
              about_us: hasExtendedShape ? maybeAboutUs : null,
              description: hasExtendedShape ? maybeDescription : maybeAboutUs,
              requirements: hasExtendedShape ? maybeRequirements : maybeDescription,
              skills: hasExtendedShape ? maybeSkills : null,
              benefits: hasExtendedShape ? maybeBenefits : null,
              location: hasExtendedShape ? maybeLocation : maybeRequirements,
              type: hasExtendedShape ? maybeType : maybeLocation,
              status: hasExtendedShape ? maybeStatus : maybeType,
              url: hasExtendedShape ? maybeUrl : maybeStatus,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            state.jobs.push(row);
            return { lastInsertRowid: row.id };
          }

          if (q.includes('INSERT INTO matching_results')) {
            const [jobDescription, jobTitle, results, jobId] = args;
            const row = {
              id: state.seq.matchingId++,
              job_description: jobDescription,
              job_title: jobTitle,
              results,
              job_id: jobId,
              created_at: new Date().toISOString(),
            };
            state.matchingResults.push(row);
            return { lastInsertRowid: row.id };
          }

          return { lastInsertRowid: 0 };
        },
      };
    },
  };

  return db;
}

describe('Regression tests for CV upload, job upload and matching evaluation', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    jest.dontMock('pdf-parse');
    jest.dontMock('../aiConfig');
    global.fetch = nativeFetch;
    if (nativeOllamaModel === undefined) {
      delete process.env.OLLAMA_MODEL;
    } else {
      process.env.OLLAMA_MODEL = nativeOllamaModel;
    }
    if (nativeOllamaBaseUrl === undefined) {
      delete process.env.OLLAMA_BASE_URL;
    } else {
      process.env.OLLAMA_BASE_URL = nativeOllamaBaseUrl;
    }
    if (nativeAiProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = nativeAiProvider;
    }
    if (nativeGraphRagBaseUrl === undefined) {
      delete process.env.GRAPHRAG_BASE_URL;
    } else {
      process.env.GRAPHRAG_BASE_URL = nativeGraphRagBaseUrl;
    }
  });

  async function runDanielFixtureTest({ modelName, baseUrl, provider }) {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.dontMock('../aiConfig');
    global.fetch = nativeFetch;
    process.env.OLLAMA_MODEL = modelName;
    if (baseUrl) process.env.OLLAMA_BASE_URL = baseUrl;
    if (provider) process.env.AI_PROVIDER = provider;

    const cvParserRouter = require('../routes/cv-parser');
    const candidatesRouter = require('../routes/candidates');
    const app = express();
    app.use(express.json());
    app.use('/api/cv-parser', cvParserRouter);
    app.use('/api/candidates', candidatesRouter);

    const fixtureName = 'CV 2 - Daniel Huber.pdf';
    const fixturePath = path.join(__dirname, 'fixtures', fixtureName);
    const sendParseRequest = () => request(app)
      .post('/api/cv-parser/parse')
      .attach('file', fixturePath);

    let parseResponse = await sendParseRequest();
    if (parseResponse.status === 502 && /model has crashed/i.test(String(parseResponse.body?.details || ''))) {
      parseResponse = await sendParseRequest();
    }

    expect(parseResponse.status).toBe(200);
    expect(parseResponse.body.success).toBe(true);
    expect(parseResponse.body.filename).toBe(fixtureName);
    expect(parseResponse.body.candidate.name).toBeTruthy();

    const createResponse = await request(app)
      .post('/api/candidates')
      .send(parseResponse.body.candidate);

    expect(createResponse.status).toBe(201);
    expect(mockDb.__state.candidates).toHaveLength(1);
    const educationValue = String(mockDb.__state.candidates[0].education || '');
    expect(educationValue).toMatch(/Wirtschaftsinformatik/i);
    expect(educationValue).toMatch(/FHNW/i);
    expect(educationValue).toMatch(/Bachelor of Science|BSc/i);
    const storedPhone = String(mockDb.__state.candidates[0].phone || '');
    const normalizedStoredPhone = storedPhone.replace(/\D+/g, '');
    const normalizedExpectedPhone = '+41 79 555 01 02'.replace(/\D+/g, '');
    expect(normalizedStoredPhone).toBe(normalizedExpectedPhone);
  }

  test('CV parser accepts PDF upload and returns extracted candidate fields', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model', provider: 'ollama' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai/api/generate', body: { prompt: 'x' } }),
      extractAiText: () => ({
        text: JSON.stringify({
          name: 'Max Mustermann',
          email: 'max@example.com',
          skills: 'JavaScript, Node.js',
          work_history: [],
          education_history: [],
        }),
      }),
      pingAiService: async () => true,
    }));

    jest.doMock('pdf-parse', () => jest.fn(async () => ({
      text: 'Max Mustermann\nmax@example.com\nJavaScript Node.js',
    })));

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    const cvParserRouter = require('../routes/cv-parser');
    const app = express();
    app.use('/api/cv-parser', cvParserRouter);

    const response = await request(app)
      .post('/api/cv-parser/parse')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.filename).toBe('cv.pdf');
    expect(response.body.candidate.name).toBe('Max Mustermann');
    expect(response.body.candidate.email).toBe('max@example.com');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('CV parser with persist=1 stores the candidate in SQLite and keeps histories', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../utils/documentText', () => ({
      tmpDir: path.join(__dirname, '..', '..', 'data', 'tmp'),
      extractText: jest.fn(async () => 'Max Mustermann\nmax@example.com\nJavaScript Node.js\nFHNW Bachelor'),
    }));
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'graph-rag-candidate-1',
        message: 'Candidate ingested successfully',
        persisted: true,
        profile: {
          name: 'Max Mustermann',
          email: 'max@example.com',
          phone: '+41 79 555 01 02',
          location: 'Zürich',
          experience: null,
          education: 'Bachelor of Science FHNW',
          skills: [{ name: 'JavaScript' }, { name: 'Node.js' }],
          languages: [{ name: 'Deutsch', level: 'C2' }],
          educations: [{ level: 'Bachelor', field_of_study: 'Informatik' }],
          industries: [],
          work_history: [
            { employer: 'ACME', position: 'Developer', from_date: '2020-01', to_date: '2022-12', is_current: false, description: 'Builds APIs', location: 'Berlin' },
            { employer: 'Globex', position: 'Senior Developer', from_date: '2023-01', to_date: null, is_current: true, description: 'Leads platform work', location: 'Zürich' },
          ],
          education_history: [{ institution: 'FHNW', degree: 'BSc', field_of_study: 'Informatik', from_date: '2016-09', to_date: '2019-06', description: 'Studium' }],
          preferred_roles: ['Software Engineer'],
        },
      }),
    }));

    const cvParserRouter = require('../routes/cv-parser');
    const app = express();
    app.use('/api/cv-parser', cvParserRouter);

    const response = await request(app)
      .post('/api/cv-parser/parse?persist=1')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(200);
    expect(response.body.persisted).toBe(true);
    expect(response.body.storage.sqlite).toBe(true);
    expect(response.body.storage.neo4j).toBe(true);
    expect(response.body.candidate.id).toBe(1);
    expect(response.body.candidate.name).toBe('Max Mustermann');
    expect(mockDb.__state.candidates).toHaveLength(1);
    expect(String(mockDb.__state.candidates[0].experience || '')).toContain('Developer');
    expect(String(mockDb.__state.candidates[0].experience || '')).toContain('ACME');
    expect(String(mockDb.__state.candidates[0].experience || '')).toContain('Globex');
    expect(mockDb.__state.candidateWorkHistory).toHaveLength(2);
    expect(mockDb.__state.candidateEducation).toHaveLength(1);
    expect(mockDb.__state.aiLogs).toHaveLength(1);
    expect(mockDb.__state.aiLogs[0].feature).toBe('cv-parser');
    expect(mockDb.__state.aiLogs[0].prompt).toContain('Max Mustermann');
    expect(mockDb.__state.aiLogs[0].response).toContain('Candidate ingested successfully');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/ingest/candidate?persist=1');
    expect(JSON.parse(options.body)).toEqual({ raw_text: expect.any(String) });
  });

  test('CV parser with persist=1 skips incomplete history rows instead of failing SQLite persistence', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../utils/documentText', () => ({
      tmpDir: path.join(__dirname, '..', '..', 'data', 'tmp'),
      extractText: jest.fn(async () => 'Max Mustermann\nmax@example.com\nJavaScript Node.js\nFHNW Bachelor'),
    }));
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'graph-rag-candidate-1',
        message: 'Candidate ingested successfully',
        persisted: true,
        profile: {
          name: 'Max Mustermann',
          email: 'max@example.com',
          phone: '+41 79 555 01 02',
          location: 'Zürich',
          experience: null,
          education: 'Bachelor of Science FHNW',
          skills: [{ name: 'JavaScript' }, { name: 'Node.js' }],
          languages: [{ name: 'Deutsch', level: 'C2' }],
          educations: [{ level: 'Bachelor', field_of_study: 'Informatik' }],
          industries: [],
          work_history: [
            { employer: 'ACME', position: 'Developer', from_date: '2020-01', to_date: '2022-12', is_current: false, description: 'Builds APIs', location: 'Berlin' },
            { employer: 'Globex', position: null, from_date: '2023-01', to_date: null, is_current: true, description: 'Leads platform work', location: 'Zürich' },
          ],
          education_history: [
            { institution: 'FHNW', degree: 'BSc', field_of_study: 'Informatik', from_date: '2016-09', to_date: '2019-06', description: 'Studium' },
            { institution: null, degree: 'MBA', field_of_study: 'Business', from_date: '2020-09', to_date: '2022-06', description: 'Unvollständig' },
          ],
          preferred_roles: ['Software Engineer'],
        },
      }),
    }));

    const cvParserRouter = require('../routes/cv-parser');
    const app = express();
    app.use('/api/cv-parser', cvParserRouter);

    const response = await request(app)
      .post('/api/cv-parser/parse?persist=1')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), {
        filename: 'cv-incomplete-history.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(200);
    expect(response.body.storage.sqlite).toBe(true);
    expect(mockDb.__state.candidateWorkHistory).toHaveLength(1);
    expect(mockDb.__state.candidateWorkHistory[0].employer).toBe('ACME');
    expect(mockDb.__state.candidateEducation).toHaveLength(1);
    expect(mockDb.__state.candidateEducation[0].institution).toBe('FHNW');
  });

  test('CV parser backfills SQLite work history when GraphRAG returns no work history', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../utils/documentText', () => ({
      tmpDir: path.join(__dirname, '..', '..', 'data', 'tmp'),
      extractText: jest.fn(async () => [
        'LEBENSLAUF 299 — IT-QUALIFIKATIONSPROFILE — SEITE 1',
        'Senior .NET Core Developer',
        'Name: Werner Meier  •  Alter: 51  •  Frauenfeld, Schweiz',
        '3. PRAKTISCHE INDUSTRIE- & PROJEKTERFAHRUNG (AUSZUG)',
        'Senior IT Specialist, Swisscom AG, Zürich',
        'Umfassende Konzeption, Implementierung und Architektur moderner IT-Infrastruktursysteme.',
        'Software Engineer, Swiss Re, Zürich',
        'Erfolgreiche Leitung agiler Projektteams (Scrum/Kanban).',
        '4. TECHNISCHE & IT-ENGINEERING KOMPETENZMATRIX',
      ].join('\n')),
    }));
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'graph-rag-candidate-1',
        message: 'Candidate ingested successfully',
        persisted: true,
        profile: {
          name: 'Werner Meier',
          location: 'Frauenfeld, Schweiz',
          experience: null,
          education: 'Master of Science in Computer Science, ETH Zürich',
          skills: [{ name: 'C#' }, { name: '.NET Core' }],
          languages: [{ name: 'Deutsch', level: 'C2' }],
          educations: [],
          industries: [],
          work_history: [],
          education_history: [],
          preferred_roles: ['Senior .NET Core Developer'],
        },
      }),
    }));

    const cvParserRouter = require('../routes/cv-parser');
    const app = express();
    app.use('/api/cv-parser', cvParserRouter);

    const response = await request(app)
      .post('/api/cv-parser/parse?persist=1')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), {
        filename: 'Meier-Werner.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(200);
    expect(response.body.storage.sqlite).toBe(true);
    expect(mockDb.__state.candidateWorkHistory).toHaveLength(2);
    expect(mockDb.__state.candidateWorkHistory[0].employer).toBe('Swisscom AG');
    expect(mockDb.__state.candidateWorkHistory[0].position).toBe('Senior IT Specialist');
    expect(mockDb.__state.candidateWorkHistory[1].employer).toBe('Swiss Re');
    expect(mockDb.__state.candidateWorkHistory[1].position).toBe('Software Engineer');
  });

  test('CV parser backfills work history from Berufliche Tätigkeiten section', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../utils/documentText', () => ({
      tmpDir: path.join(__dirname, '..', '..', 'data', 'tmp'),
      extractText: jest.fn(async () => [
        'Lebenslauf',
        'Berufliche Tätigkeiten',
        'Senior Developer, Example AG, Zürich',
        'Entwicklung von Webanwendungen mit React und Node.js.',
        'Software Engineer, Another GmbH, Bern',
        'Implementierung und Betrieb von APIs.',
        'Ausbildung',
        'Bachelor of Science, FHNW',
      ].join('\n')),
    }));
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'graph-rag-candidate-1',
        message: 'Candidate ingested successfully',
        persisted: true,
        profile: {
          name: 'Max Mustermann',
          location: 'Zürich',
          experience: null,
          education: null,
          skills: [],
          languages: [],
          educations: [],
          industries: [],
          work_history: [],
          education_history: [],
          preferred_roles: [],
        },
      }),
    }));

    const cvParserRouter = require('../routes/cv-parser');
    const app = express();
    app.use('/api/cv-parser', cvParserRouter);

    const response = await request(app)
      .post('/api/cv-parser/parse?persist=1')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), {
        filename: 'berufliche-taetigkeiten.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(200);
    expect(response.body.storage.sqlite).toBe(true);
    expect(mockDb.__state.candidateWorkHistory).toHaveLength(2);
    expect(mockDb.__state.candidateWorkHistory[0].employer).toBe('Example AG');
    expect(mockDb.__state.candidateWorkHistory[0].position).toBe('Senior Developer');
    expect(mockDb.__state.candidateWorkHistory[1].employer).toBe('Another GmbH');
    expect(mockDb.__state.candidateWorkHistory[1].position).toBe('Software Engineer');
  });

  test('CV parser handles fixture PDF upload through the real multipart path', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model', provider: 'ollama' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai/api/generate', body: { prompt: 'x' } }),
      extractAiText: () => ({
        text: JSON.stringify({
          name: 'Max Mustermann',
          email: 'max@example.com',
          skills: 'JavaScript, Node.js, Express',
          work_history: [],
          education_history: [],
        }),
      }),
      pingAiService: async () => true,
    }));

    jest.doMock('pdf-parse', () => jest.fn(async () => ({
      text: 'Max Mustermann\nmax@example.com\nJavaScript Node.js Express',
    })));

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    const cvParserRouter = require('../routes/cv-parser');
    const app = express();
    app.use('/api/cv-parser', cvParserRouter);

    const fixturePath = path.join(__dirname, 'fixtures', 'cv-real.pdf');
    const response = await request(app)
      .post('/api/cv-parser/parse')
      .attach('file', fixturePath);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.filename).toBe('cv-real.pdf');
    expect(response.body.textLength).toBeGreaterThan(20);
    expect(response.body.candidate.name).toBe('Max Mustermann');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('CV parser parses Thomas fixture PDF with spaces in filename', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.dontMock('../aiConfig');

    global.fetch = nativeFetch;

    const cvParserRouter = require('../routes/cv-parser');
    const app = express();
    app.use('/api/cv-parser', cvParserRouter);

    const fixtureName = 'CV 1 - Thomas Zimmermann.pdf';
    const fixturePath = path.join(__dirname, 'fixtures', fixtureName);
    const response = await request(app)
      .post('/api/cv-parser/parse')
      .attach('file', fixturePath);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.filename).toBe(fixtureName);
    expect(response.body.textLength).toBeGreaterThan(20);
    expect(response.body.candidate.name).toBe('Thomas Zimmermann');
    console.log('Thomas fixture tags:', response.body.candidate.tags);
    /*const tagsValue = response.body.candidate.tags;
    const tagsArray = Array.isArray(tagsValue)
      ? tagsValue.map((t) => String(t).trim()).filter(Boolean)
      : String(tagsValue || '').split(',').map((t) => t.trim()).filter(Boolean); 
    expect(tagsArray).toContainEqual(expect.stringMatching(/^Senior$/i));*/
    const thomasExperience = String(response.body.candidate.experience || '').trim();
    expect(thomasExperience.length).toBeGreaterThan(10);
  }, 120000);

  //Ollama --------------------------------
  /*
  test('CV parser parses Daniel fixture with ollama:llama3.2 and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'llama3.2',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  test('CV parser parses Daniel fixture with ollama:gemma4:latest and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma4:latest',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  test('CV parser parses Daniel fixture with ollama:gemma4:26b and stores data in database', async () => {
    await runDanielFixtureTest({ 
      modelName: 'gemma4:26b',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

    test('CV parser parses Daniel fixture with ollama:gemma4:31b and stores data in database', async () => {
    await runDanielFixtureTest({ 
      modelName: 'gemma4:31b',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  */
  test('CV parser parses Daniel fixture with ollama:qwen3.6:35b and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'qwen3.6:35b',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  //lmstudio ------------------------
  /*
  test('CV parser parses Daniel fixture with lmstudio:gemma-4-e4b-it-mlx and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma-4-e4b-it-mlx',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

  test('CV parser parses Daniel fixture with lmstudio:gemma-4-26b-a4b-it-mlx and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma-4-26b-a4b-it-mlx',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

    test('CV parser parses Daniel fixture with lmstudio:gemma-4-31b-a4b-it-mlx and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma-4-31b-a4b-it-mlx',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

  test('CV parser parses Daniel fixture with lmstudio:qwen3.6-35b-a3b-ud-mlx and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'qwen3.6-35b-a3b-ud-mlx',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

  test('CV parser parses Daniel fixture with lmstudio:llama-3.2-3b-instruct  and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'llama-3.2-3b-instruct',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

  */

  test('CV parser rejects unsupported upload format', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model', provider: 'ollama' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai/api/generate', body: { prompt: 'x' } }),
      extractAiText: () => ({ text: '{}' }),
      pingAiService: async () => true,
    }));

    const cvParserRouter = require('../routes/cv-parser');
    const app = express();
    app.use('/api/cv-parser', cvParserRouter);

    const response = await request(app)
      .post('/api/cv-parser/parse')
      .attach('file', Buffer.from('not a pdf'), {
        filename: 'cv.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Nur PDF, Word und Bilddateien erlaubt/i);
  });

  test('Jobs endpoint stores uploaded job description payload', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      generatorRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
    }));
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai', body: {} }),
      extractAiText: () => ({ text: '{}' }),
      pingAiService: async () => true,
    }));

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const payload = {
      title: 'Senior Backend Engineer',
      description: 'Node.js, APIs, Skalierung',
      requirements: '5+ Jahre Erfahrung',
      location: 'Berlin',
      type: 'Vollzeit',
      status: 'Offen',
      url: 'https://example.com/jobs/backend',
    };

    const response = await request(app).post('/api/jobs').send(payload);

    expect(response.status).toBe(201);
    expect(response.body.title).toBe(payload.title);
    expect(response.body.description).toBe(payload.description);
    expect(response.body.requirements).toBe(payload.requirements);
    expect(mockDb.__state.jobs).toHaveLength(1);
  });

  test('Jobs generate-description API flow persists generated job data in database', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      generatorRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
    }));
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model', provider: 'ollama' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai/api/generate', body: { prompt: 'x' } }),
      extractAiText: () => ({
        text: JSON.stringify({
          description: 'Wir suchen eine erfahrene Person fuer die Backend-Entwicklung.',
          requirements: '• Node.js\n• REST APIs\n• Teamarbeit',
        }),
      }),
      pingAiService: async () => true,
    }));

    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === 'http://fake-ai/') {
        return { ok: true, json: async () => ({}) };
      }

      if (String(url) === 'http://fake-ai/api/generate' && options?.method === 'POST') {
        return { ok: true, json: async () => ({}) };
      }

      return { ok: false, text: async () => 'unexpected fetch call' };
    });

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const generateResponse = await request(app)
      .post('/api/jobs/generate-description')
      .send({
        title: 'Senior Backend Engineer',
        keywords: 'Node.js, REST API, Microservices',
        type: 'Vollzeit',
        location: 'Berlin',
      });

    expect(generateResponse.status).toBe(200);
    expect(generateResponse.body.description).toMatch(/Backend-Entwicklung/i);
    expect(generateResponse.body.requirements).toMatch(/Node\.js/i);

    const createResponse = await request(app)
      .post('/api/jobs')
      .send({
        title: 'Senior Backend Engineer',
        description: generateResponse.body.description,
        requirements: generateResponse.body.requirements,
        location: 'Berlin',
        type: 'Vollzeit',
        status: 'Offen',
      });

    expect(createResponse.status).toBe(201);
    expect(mockDb.__state.jobs).toHaveLength(1);
    expect(mockDb.__state.jobs[0].title).toBe('Senior Backend Engineer');
    expect(mockDb.__state.jobs[0].description).toBe(generateResponse.body.description);
    expect(mockDb.__state.jobs[0].requirements).toBe(generateResponse.body.requirements);
  });

  test('Jobs create API also syncs parsed job data to GraphRAG', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === 'http://fake-graphrag/ingest/job' && options?.method === 'POST') {
        const payload = JSON.parse(options.body);
        expect(payload.profile.title).toBe('Senior Backend Engineer');
        expect(payload.profile.location).toBe('Berlin');
        expect(payload.profile.employment_type).toBe('Vollzeit');
        expect(payload.raw_text).toContain('Jobtitel: Senior Backend Engineer');
        expect(payload.raw_text).toContain('Anforderungen:');
        expect(payload.raw_text).toContain('Node.js');
        return {
          ok: true,
          json: async () => ({ id: 'graph-job-1', message: 'Job ingested successfully' }),
        };
      }

      return { ok: false, text: async () => 'unexpected fetch call' };
    });

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const response = await request(app)
      .post('/api/jobs')
      .send({
        title: 'Senior Backend Engineer',
        description: 'Node.js, APIs, Skalierung',
        requirements: '5+ Jahre Erfahrung',
        location: 'Berlin',
        type: 'Vollzeit',
        status: 'Offen',
      });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe('Senior Backend Engineer');
    expect(response.body.graphRag).toEqual({ id: 'graph-job-1', message: 'Job ingested successfully' });
    expect(mockDb.__state.jobs).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('Jobs endpoint returns 400 when title is missing', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      generatorRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
    }));
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai', body: {} }),
      extractAiText: () => ({ text: '{}' }),
      pingAiService: async () => true,
    }));

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const response = await request(app).post('/api/jobs').send({
      description: 'Ohne Titel',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Titel ist erforderlich/i);
    expect(mockDb.__state.jobs).toHaveLength(0);
  });

  test('Jobs description upload returns a structured job description payload for text files', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      generatorRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
    }));
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai', body: {} }),
      extractAiText: () => ({ text: '{}' }),
      pingAiService: async () => true,
    }));

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const response = await request(app)
      .post('/api/jobs/parse-description')
      .attach('file', Buffer.from([
        'Senior Backend Engineer',
        '',
        'Aufgaben',
        'Entwicklung und Betrieb verteilter APIs.',
        '',
        'Anforderungen',
        'Node.js Erfahrung',
        'API-Design',
      ].join('\n')), {
        filename: 'job-description.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.filename).toBe('job-description.txt');
    expect(response.body.text).toMatch(/Senior Backend Engineer/);
    expect(response.body.description).toMatch(/Senior Backend Engineer/);
    expect(response.body.description).toMatch(/Entwicklung und Betrieb verteilter APIs\./);
    expect(response.body.requirements).toMatch(/Node\.js Erfahrung/);
    expect(response.body.requirements).toMatch(/API-Design/);
  });

  test('Jobs description upload parses real PDF Java Developer Sopra Steria.pdf', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      generatorRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
    }));
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai', body: {} }),
      extractAiText: () => ({ text: '{}' }),
      pingAiService: async () => true,
    }));

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const fixturePath = path.join(__dirname, 'fixtures', 'Java Developer Sopra Steria.pdf');
    const response = await request(app)
      .post('/api/jobs/parse-description')
      .attach('file', fixturePath);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.filename).toBe('Java Developer Sopra Steria.pdf');
    expect(response.body.text).toMatch(/Java Developer/i);
    expect(response.body.text).toMatch(/Sopra Steria/i);
    expect(response.body.description).toMatch(/Unternehmensbeschreibung/i);
    expect(response.body.description).toMatch(/Sopra Steria ist einer der führenden europäischen IT-Dienstleister/i);
  });

  test('Jobs description upload parses real PDF Java Developer Software+.pdf and persists to SQLite and GraphRAG', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      generatorRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
    }));
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai', body: {} }),
      extractAiText: () => ({ text: '{}' }),
      pingAiService: async () => true,
    }));

    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    global.fetch = jest.fn(async (url, options) => {
      if (String(url).startsWith('http://fake-graphrag/ingest/job') && options?.method === 'POST') {
        const payload = JSON.parse(options.body);
        expect(payload.raw_text).toContain('Java Developer');
        expect(payload.raw_text).toContain('Software');
        return {
          ok: true,
          json: async () => ({
            id: 'graph-job-java-software',
            message: 'Job ingested successfully',
            profile: {
              title: 'Java Developer',
              description: 'Entwicklung von Java-basierten Backend-Services.',
              requirements: 'Java, Spring Boot, SQL',
              required_skills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'SQL' }],
            },
          }),
        };
      }

      return { ok: false, json: async () => ({}), text: async () => 'unexpected fetch call' };
    });

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const fixturePath = path.join(__dirname, 'fixtures', 'Java Developer Software+.pdf');
    const parseResponse = await request(app)
      .post('/api/jobs/parse-description?persist=1')
      .attach('file', fixturePath);

    expect(parseResponse.status).toBe(200);
    expect(parseResponse.body.success).toBe(true);
    expect(parseResponse.body.filename).toBe('Java Developer Software+.pdf');
    expect(parseResponse.body.text).toMatch(/Java Developer/i);

    const jobTitle = String(parseResponse.body.title || 'Java Developer Software+').trim();

    expect(parseResponse.body.id).toBe(1);
    expect(parseResponse.body.job).toBeTruthy();
    expect(parseResponse.body.job.title).toBe(jobTitle);
    expect(parseResponse.body.skills).toBe('Java, Spring Boot, SQL');
    expect(mockDb.__state.jobs).toHaveLength(1);
    expect(mockDb.__state.jobs[0].title).toBe(jobTitle);
    expect(mockDb.__state.jobs[0].description).toBe(parseResponse.body.description);
    expect(mockDb.__state.jobs[0].requirements).toBe(parseResponse.body.requirements);
    expect(mockDb.__state.jobs[0].skills).toBe(parseResponse.body.skills);
    expect(parseResponse.body.graphRag).toEqual({
      id: 'graph-job-java-software',
      message: 'Job ingested successfully',
      profile: {
        title: 'Java Developer',
        description: 'Entwicklung von Java-basierten Backend-Services.',
        requirements: 'Java, Spring Boot, SQL',
        required_skills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'SQL' }],
      },
    });
    expect(global.fetch.mock.calls.some(([url]) => String(url).startsWith('http://fake-graphrag/ingest/job'))).toBe(true);
  });

  test('Jobs parse-description with real AI parses Senior Data Engineer fixture and persists job', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.dontMock('../aiConfig');
    global.fetch = nativeFetch;

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const fixturePath = path.join(__dirname, 'fixtures', 'Senior Data Engineer (Job Cloud).pdf');
    const parseResponse = await request(app)
      .post('/api/jobs/parse-description')
      .attach('file', fixturePath);

    expect(parseResponse.status).toBe(200);
    expect(parseResponse.body.success).toBe(true);
    expect(parseResponse.body.filename).toBe('Senior Data Engineer (Job Cloud).pdf');
    expect(String(parseResponse.body.title || '').trim().length).toBeGreaterThan(0);
    expect(String(parseResponse.body.description || '').trim().length).toBeGreaterThan(80);
    expect(String(parseResponse.body.requirements || '').trim().length).toBeGreaterThan(30);

    const createResponse = await request(app)
      .post('/api/jobs')
      .send({
        title: parseResponse.body.title,
        about_us: parseResponse.body.about_us,
        description: parseResponse.body.description,
        requirements: parseResponse.body.requirements,
        skills: parseResponse.body.skills,
        benefits: parseResponse.body.benefits,
        location: 'Remote',
        type: 'Vollzeit',
        status: 'Offen',
      });

    expect(createResponse.status).toBe(201);
    expect(mockDb.__state.jobs).toHaveLength(1);
    expect(mockDb.__state.jobs[0].title).toBe(parseResponse.body.title);
    expect(mockDb.__state.jobs[0].description).toBe(parseResponse.body.description);
    expect(mockDb.__state.jobs[0].requirements).toBe(parseResponse.body.requirements);
  }, 180000);

  test('Jobs parse-description with real AI and real DB persists Java Developer Software+.pdf', async () => {
    if (!process.env.GRAPHRAG_BASE_URL?.trim()) {
      console.warn('Skipping real DB job import test because GRAPHRAG_BASE_URL is not set.');
      return;
    }

    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.dontMock('../database');
    jest.dontMock('../aiConfig');
    global.fetch = nativeFetch;

    const db = require('../database');
    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const fixtureName = 'Java Developer Software+.pdf';
    const fixturePath = path.join(__dirname, 'fixtures', fixtureName);
    const parseResponse = await request(app)
      .post('/api/jobs/parse-description')
      .attach('file', fixturePath);

    expect(parseResponse.status).toBe(200);
    expect(parseResponse.body.success).toBe(true);
    expect(parseResponse.body.filename).toBe(fixtureName);
    expect(parseResponse.body.text).toMatch(/Java Developer/i);

    const jobTitle = String(parseResponse.body.title || 'Java Developer Software+').trim();

    const createResponse = await request(app)
      .post('/api/jobs')
      .send({
        title: jobTitle,
        about_us: parseResponse.body.about_us,
        description: parseResponse.body.description,
        requirements: parseResponse.body.requirements,
        benefits: parseResponse.body.benefits,
        location: 'Remote',
        type: 'Vollzeit',
        status: 'Offen',
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.title).toBe(jobTitle);
    expect(createResponse.body.graphRag).toBeTruthy();
    expect(createResponse.body.graphRag.message).toBe('Job ingested successfully');

    const storedJob = db.prepare('SELECT * FROM jobs WHERE title = ? ORDER BY id DESC LIMIT 1').get(jobTitle);
    expect(storedJob).toBeTruthy();
    expect(storedJob.description).toContain('Java Developer');
    expect(storedJob.requirements).toBeTruthy();

    if (storedJob?.id != null) {
      db.prepare('DELETE FROM jobs WHERE id = ?').run(storedJob.id);
    }
  }, 180000);

  test('Matching run evaluates candidates and persists a regression-safe result', async () => {
    const mockDb = createMockDb({
      candidates: [
        {
          id: 1,
          name: 'Max Mustermann',
          email: 'max@example.com',
          location: 'Berlin',
          experience: '6 Jahre Backend',
          skills: 'Node.js, Express',
          education: 'B.Sc. Informatik',
          desired_salary: '80000',
          availability: 'Sofort',
          languages: 'Deutsch C2, Englisch C1',
          certificates: '',
          mobility: 'Remote',
        },
      ],
    });

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      matchingRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
      sanitizeObject: (obj) => ({ sanitized: obj }),
    }));
    jest.doMock('../middleware/apiKey', () => (req, res, next) => next());
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model', provider: 'ollama' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai/api/generate', body: { prompt: 'x' } }),
      extractAiText: () => ({
        text: JSON.stringify({
          results: [
            {
              candidateId: 1,
              candidateName: 'Kandidat 1',
              score: 87,
              strengths: ['Starke Backend-Erfahrung'],
              weaknesses: ['Wenig DevOps'],
              summary: 'Sehr guter Fit fuer Backend-Rolle',
            },
          ],
        }),
      }),
    }));

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ok: true }),
      });

    const matchingRouter = require('../routes/matching');
    const app = express();
    app.use(express.json());
    app.use('/api/matching', matchingRouter);

    const response = await request(app)
      .post('/api/matching/run')
      .send({
        jobDescription: 'Wir suchen eine erfahrene Node.js Person fuer API-Entwicklung.',
        jobTitle: 'Backend Engineer',
        candidateIds: [1],
      });

    expect(response.status).toBe(200);
    expect(response.body.results.results).toHaveLength(1);
    expect(response.body.results.results[0].candidateName).toBe('Max Mustermann');
    expect(response.body.results.results[0].score).toBe(87);
    expect(mockDb.__state.matchingResults).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('Matching run returns 400 when job description is missing', async () => {
    const mockDb = createMockDb({
      candidates: [
        {
          id: 1,
          name: 'Max Mustermann',
          email: 'max@example.com',
          location: 'Berlin',
          experience: '6 Jahre Backend',
          skills: 'Node.js, Express',
          education: 'B.Sc. Informatik',
          desired_salary: '80000',
          availability: 'Sofort',
          languages: 'Deutsch C2, Englisch C1',
          certificates: '',
          mobility: 'Remote',
        },
      ],
    });

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      matchingRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
      sanitizeObject: (obj) => ({ sanitized: obj }),
    }));
    jest.doMock('../middleware/apiKey', () => (req, res, next) => next());
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model', provider: 'ollama' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai/api/generate', body: { prompt: 'x' } }),
      extractAiText: () => ({ text: '{"results":[]}' }),
    }));

    const matchingRouter = require('../routes/matching');
    const app = express();
    app.use(express.json());
    app.use('/api/matching', matchingRouter);

    const response = await request(app)
      .post('/api/matching/run')
      .send({
        jobTitle: 'Backend Engineer',
        candidateIds: [1],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Stellenbeschreibung ist erforderlich/i);
  });

  test('Matching run returns 503 when AI host is unreachable', async () => {
    const mockDb = createMockDb({
      candidates: [
        {
          id: 1,
          name: 'Max Mustermann',
          email: 'max@example.com',
          location: 'Berlin',
          experience: '6 Jahre Backend',
          skills: 'Node.js, Express',
          education: 'B.Sc. Informatik',
          desired_salary: '80000',
          availability: 'Sofort',
          languages: 'Deutsch C2, Englisch C1',
          certificates: '',
          mobility: 'Remote',
        },
      ],
    });

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../middleware/rateLimiter', () => ({
      matchingRateLimiter: (req, res, next) => next(),
    }));
    jest.doMock('../middleware/promptSanitizer', () => ({
      promptGuard: () => (req, res, next) => next(),
      sanitizeObject: (obj) => ({ sanitized: obj }),
    }));
    jest.doMock('../middleware/apiKey', () => (req, res, next) => next());
    jest.doMock('../aiConfig', () => ({
      getAiConfig: () => ({ baseUrl: 'http://fake-ai', model: 'test-model', provider: 'ollama' }),
      stripReasoningTags: (text) => text,
      resolveAiProvider: async () => 'ollama',
      buildAiRequest: () => ({ url: 'http://fake-ai/api/generate', body: { prompt: 'x' } }),
      extractAiText: () => ({ text: '{"results":[]}' }),
    }));

    global.fetch = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const matchingRouter = require('../routes/matching');
    const app = express();
    app.use(express.json());
    app.use('/api/matching', matchingRouter);

    const response = await request(app)
      .post('/api/matching/run')
      .send({
        jobDescription: 'Node.js Rolle',
        jobTitle: 'Backend Engineer',
        candidateIds: [1],
      });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/KI-Host nicht erreichbar/i);
  });
});
