const express = require('express');
const request = require('supertest');
const path = require('path');

const nativeFetch = globalThis.fetch;

function createMockDb(seed = {}) {
  const state = {
    candidates: seed.candidates ? [...seed.candidates] : [],
    jobs: seed.jobs ? [...seed.jobs] : [],
    candidateFiles: seed.candidateFiles ? [...seed.candidateFiles] : [],
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
            const [userId, feature, model, modelVersion, promptHash, prompt, response, parsedResult, durationMs, inputTokens, outputTokens, success, errorMessage] = args;
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
            const [title, description, requirements, location, type, status, url] = args;
            const row = {
              id: state.seq.jobId++,
              title,
              description,
              requirements,
              location,
              type,
              status,
              url,
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
  });

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

  test('CV parser parses a real PDF fixture file', async () => {
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

  test('CV parser parses Daniel fixture and stores education in database', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.dontMock('../aiConfig');
    global.fetch = nativeFetch;

    const cvParserRouter = require('../routes/cv-parser');
    const candidatesRouter = require('../routes/candidates');
    const app = express();
    app.use(express.json());
    app.use('/api/cv-parser', cvParserRouter);
    app.use('/api/candidates', candidatesRouter);

    const fixtureName = 'CV 2 - Daniel Huber.pdf';
    const fixturePath = path.join(__dirname, 'fixtures', fixtureName);
    const parseResponse = await request(app)
      .post('/api/cv-parser/parse')
      .attach('file', fixturePath);

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
  }, 180000);

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
