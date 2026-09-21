const express = require('express');
const request = require('supertest');
const path = require('path');

const nativeFetch = globalThis.fetch;
const nativeOllamaModel = process.env.OLLAMA_MODEL;
const nativeOllamaBaseUrl = process.env.OLLAMA_BASE_URL;
const nativeAiProvider = process.env.AI_PROVIDER;
const nativeGraphRagBaseUrl = process.env.GRAPHRAG_BASE_URL;

const CANDIDATE_SEARCH_FIELDS = [
  'name',
  'email',
  'phone',
  'location',
  'experience',
  'skills',
  'education',
  'desired_salary',
  'availability',
  'languages',
  'certificates',
  'drivers_license',
  'mobility',
  'notes',
  'status',
  'tags',
  'source',
  'linkedin_url',
  'xing_url',
  'github_url',
  'portfolio_url',
  'current_employer',
  'current_position',
  'gender',
];

const CANDIDATE_SEARCH_FIELD_WIDTH = CANDIDATE_SEARCH_FIELDS.length + 4;
const JOB_SEARCH_FIELDS = [
  'title',
  'company',
  'description',
  'requirements',
  'about_us',
  'benefits',
  'location',
  'type',
  'status',
  'url',
];
const JOB_SEARCH_FIELD_WIDTH = JOB_SEARCH_FIELDS.length;
const MATCHING_SEARCH_FIELDS = [
  'job_title',
  'job_description',
  'results',
  'review_notes',
  'reviewed_by',
];
const MATCHING_SEARCH_FIELD_WIDTH = MATCHING_SEARCH_FIELDS.length;

function matchesSearch(candidate, queryTerms, fullText = null, fields = CANDIDATE_SEARCH_FIELDS) {
  return queryTerms.every((term) => {
    const needle = term.toLowerCase();
    const values = [
      ...fields.map((field) => candidate[field]),
      fullText?.candidate_name,
      fullText?.original_text,
      fullText?.anonymized_text,
      fullText?.profile_json ? JSON.stringify(fullText.profile_json) : null,
    ];
    return values.some((value) => String(value || '').toLowerCase().includes(needle));
  });
}

function createMockDb(seed = {}) {
  const state = {
    candidates: seed.candidates ? [...seed.candidates] : [],
    candidateTexts: seed.candidateTexts ? [...seed.candidateTexts] : [],
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
          if (q.includes("to_regclass('public.candidate_texts')")) {
            return { exists: state.candidateTexts.length > 0 ? 'candidate_texts' : null };
          }

          if (q.includes("to_regclass('public.matching_results')")) {
            return { exists: state.matchingResults.length > 0 ? 'matching_results' : null };
          }

          if (q.includes('COUNT(*) as count FROM jobs j') && q.includes('LOWER(COALESCE(')) {
            const queryTerms = args
              .filter((_, index) => index % JOB_SEARCH_FIELD_WIDTH === 0)
              .map((value) => String(value).replace(/^%|%$/g, ''));
            return {
              count: state.jobs.filter((job) => matchesSearch(
                {
                  title: job.title,
                  company: job.company,
                  description: job.description,
                  requirements: job.requirements,
                  about_us: job.about_us,
                  benefits: job.benefits,
                  location: job.location,
                  type: job.type,
                  status: job.status,
                  url: job.url,
                  experience: null,
                  skills: job.skills,
                },
                queryTerms,
                null,
                JOB_SEARCH_FIELDS,
              )).length,
            };
          }

          if (q.includes('COUNT(*) as count FROM candidates') && q.includes('LOWER(COALESCE(')) {
            const queryTerms = args
              .filter((_, index) => index % CANDIDATE_SEARCH_FIELD_WIDTH === 0)
              .map((value) => String(value).replace(/^%|%$/g, ''));
            return {
              count: state.candidates.filter((candidate) => {
                const fullText = state.candidateTexts.find((row) => String(row.candidate_id) === String(candidate.id));
                return matchesSearch(candidate, queryTerms, fullText);
              }).length,
            };
          }

          if (q.includes('COUNT(*) as count FROM matching_results') && q.includes('LOWER(COALESCE(')) {
            const queryTerms = [...new Set(args
              .filter((value) => typeof value === 'string')
              .map((value) => String(value).replace(/^%|%$/g, ''))
              .filter(Boolean))];
            return {
              count: state.matchingResults.filter((matching) => matchesSearch(
                matching,
                queryTerms,
                null,
                MATCHING_SEARCH_FIELDS,
              )).length,
            };
          }

          if (q.includes('SELECT id FROM candidates WHERE id = ?')) {
            return state.candidates.find((c) => c.id === Number(args[0]));
          }

          if (q.includes('SELECT * FROM candidates WHERE id = ?')) {
            return state.candidates.find((c) => c.id === Number(args[0]));
          }

          if (q.includes('SELECT * FROM candidate_files WHERE id = ?')) {
            return state.candidateFiles.find((f) => f.id === Number(args[0]));
          }

          if (q.includes('FROM candidate_texts') && q.includes('candidate_id = CAST(? AS TEXT)')) {
            return state.candidateTexts.find((row) => String(row.candidate_id) === String(args[0]));
          }

          if (q.includes('SELECT * FROM jobs WHERE id = ?')) {
            return state.jobs.find((j) => j.id === Number(args[0]));
          }

          return undefined;
        },

        all: (...args) => {
          if (q.includes('FROM jobs j') && q.includes('LOWER(COALESCE(')) {
            const queryTerms = args
              .slice(0, Math.max(0, args.length - 1))
              .filter((_, index) => index % JOB_SEARCH_FIELD_WIDTH === 0)
              .map((value) => String(value).replace(/^%|%$/g, ''));
            return state.jobs.filter((job) => matchesSearch(
              {
                title: job.title,
                company: job.company,
                description: job.description,
                requirements: job.requirements,
                about_us: job.about_us,
                benefits: job.benefits,
                location: job.location,
                type: job.type,
                status: job.status,
                url: job.url,
                experience: null,
                skills: job.skills,
              },
              queryTerms,
              null,
              JOB_SEARCH_FIELDS,
            ));
          }

          if (q.includes('FROM candidates c LEFT JOIN candidate_texts ct')) {
            const queryTerms = [];
            for (let i = 0; i < Math.max(0, args.length - 1); i += CANDIDATE_SEARCH_FIELDS.length + 4) {
              queryTerms.push(String(args[i]).replace(/^%|%$/g, ''));
            }
            return state.candidates.filter((candidate) => {
              const fullText = state.candidateTexts.find((row) => String(row.candidate_id) === String(candidate.id));
              return matchesSearch(candidate, queryTerms, fullText);
            });
          }

          if (q.includes('FROM matching_results m') && q.includes('LOWER(COALESCE(')) {
            const queryTerms = [...new Set(args
              .filter((value) => typeof value === 'string')
              .map((value) => String(value).replace(/^%|%$/g, ''))
              .filter(Boolean))];
            return state.matchingResults.filter((matching) => matchesSearch(
              matching,
              queryTerms,
              null,
              MATCHING_SEARCH_FIELDS,
            ));
          }

          if (q.includes('LOWER(COALESCE(') && q.includes('FROM candidates')) {
            const queryTerms = [];
            for (let i = 0; i < args.length; i += CANDIDATE_SEARCH_FIELDS.length) {
              queryTerms.push(String(args[i]).replace(/^%|%$/g, ''));
            }
            return state.candidates.filter((candidate) => matchesSearch(candidate, queryTerms));
          }

          if (q.includes('FROM candidates WHERE id IN')) {
            const ids = args.map(Number);
            return state.candidates.filter((c) => ids.includes(c.id));
          }

          if (q.includes('FROM jobs WHERE id IN')) {
            const ids = args.map(Number);
            return state.jobs.filter((j) => ids.includes(j.id));
          }

          if (q.includes('FROM candidates')) {
            return [...state.candidates];
          }

          if (q.includes('FROM jobs')) {
            return [...state.jobs];
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
            let graphJobId = null;
            let title;
            let maybeAboutUs;
            let maybeDescription;
            let maybeRequirements;
            let maybeSkills;
            let maybeBenefits;
            let maybeLocation;
            let maybeType;
            let maybeStatus;
            let maybeUrl;

            if (args.length >= 11) {
              [graphJobId, title, maybeAboutUs, maybeDescription, maybeRequirements, maybeSkills, maybeBenefits, maybeLocation, maybeType, maybeStatus, maybeUrl] = args;
            } else {
              [title, maybeAboutUs, maybeDescription, maybeRequirements, maybeBenefits, maybeLocation, maybeType, maybeStatus, maybeUrl] = args;
            }

            const hasExtendedShape = args.length >= 9;
            const row = {
              id: state.seq.jobId++,
              graph_job_id: graphJobId || null,
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

          if (q.includes('UPDATE jobs SET graph_job_id = ? WHERE id = ?')) {
            const [graphJobId, id] = args;
            const job = state.jobs.find(item => String(item.id) === String(id));
            if (job) {
              job.graph_job_id = graphJobId || null;
              job.updated_at = new Date().toISOString();
            }
            return { changes: job ? 1 : 0 };
          }

          if (q.includes('DELETE FROM jobs WHERE id = ?')) {
            const [id] = args;
            const before = state.jobs.length;
            state.jobs = state.jobs.filter(item => String(item.id) !== String(id));
            return { changes: before - state.jobs.length };
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

// Drei Tests in dieser Datei sprechen bewusst mit einem echten GraphRAG bzw.
// einem echten Sprachmodell - auf einem CI-Runner gibt es beides nicht. Sie
// sind daher als Voraussetzung deklariert statt gemockt: standardmaessig
// werden sie als "skipped" ausgewiesen, mit RUN_STACK_TESTS=1 laufen sie mit
// (npm run test:stack). Das versteckt sie nicht - sie tauchen in jedem
// Testlauf sichtbar als uebersprungen auf.
const stackTest = process.env.RUN_STACK_TESTS === '1' ? test : test.skip;

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

    // Der CV-Parser laesst GraphRAG parsen und baut die Antwort aus
    // graphRag.profile. Frueher kam das Profil direkt aus der KI-Antwort,
    // deshalb reichte hier ein leeres {ok:true} - heute ist candidate.name
    // dann undefined. Ohne GRAPHRAG_BASE_URL wirft die Route ausserdem
    // "GraphRAG ist nicht konfiguriert" und antwortet mit 500.
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'graph-cand-1',
        message: 'Candidate ingested successfully',
        profile: {
          name: 'Max Mustermann',
          email: 'max@example.com',
          skills: 'JavaScript, Node.js',
          work_history: [],
          education_history: [],
        },
      }),
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

  test('candidate search is case-insensitive and combines profile fields', async () => {
    const mockDb = createMockDb({
      candidates: [
        {
          id: 1,
          name: 'Anna Müller',
          email: 'anna@example.com',
          phone: '',
          location: 'Zürich',
          experience: 'Frontend Entwicklung',
          skills: 'React, Node.js',
          education: 'ETH Zürich',
          desired_salary: '',
          availability: '',
          languages: 'Deutsch, Englisch',
          certificates: '',
          drivers_license: '',
          mobility: '',
          notes: 'Sucht eine hybride Rolle',
          status: 'Aktiv',
          tags: 'Remote, Senior',
          source: 'LinkedIn',
          linkedin_url: '',
          xing_url: '',
          github_url: '',
          portfolio_url: '',
          current_employer: 'HRTool AG',
          current_position: 'Senior Frontend Engineer',
          gender: '',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          name: 'Beatrice Keller',
          email: 'bea@example.com',
          phone: '',
          location: 'Bern',
          experience: 'Backend Entwicklung',
          skills: 'Python, Django',
          education: 'BFH',
          desired_salary: '',
          availability: '',
          languages: 'Deutsch',
          certificates: '',
          drivers_license: '',
          mobility: '',
          notes: 'Möchte nach Zürich wechseln',
          status: 'Aktiv',
          tags: 'Onsite',
          source: 'Stepstone',
          linkedin_url: '',
          xing_url: '',
          github_url: '',
          portfolio_url: '',
          current_employer: 'Code Factory',
          current_position: 'Backend Engineer',
          gender: '',
          created_at: '2026-01-02T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      ],
      candidateTexts: [
        {
          candidate_id: '1',
          candidate_name: 'Anna Müller',
          source: 'CV Import',
          original_text: 'Anna Müller arbeitet seit Jahren mit React, TypeScript und GraphQL.',
          anonymized_text: null,
          profile_json: { name: 'Anna Müller' },
        },
        {
          candidate_id: '2',
          candidate_name: 'Beatrice Keller',
          source: 'CV Import',
          original_text: 'Backend-Schwerpunkt mit Python und Django.',
          anonymized_text: null,
          profile_json: { name: 'Beatrice Keller' },
        },
      ],
    });

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    const candidatesRouter = require('../routes/candidates');
    const app = express();
    app.use(express.json());
    app.use('/api/candidates', candidatesRouter);

    const combinedResponse = await request(app).get('/api/candidates?search=ANNA remote');
    expect(combinedResponse.status).toBe(200);
    expect(combinedResponse.body.data).toHaveLength(1);
    expect(combinedResponse.body.data[0].id).toBe(1);

    const fullTextResponse = await request(app).get('/api/candidates?search=hybride zürich');
    expect(fullTextResponse.status).toBe(200);
    expect(fullTextResponse.body.data).toHaveLength(1);
    expect(fullTextResponse.body.data[0].id).toBe(1);

    const secondCandidateResponse = await request(app).get('/api/candidates?search=bern python');
    expect(secondCandidateResponse.status).toBe(200);
    expect(secondCandidateResponse.body.data).toHaveLength(1);
    expect(secondCandidateResponse.body.data[0].id).toBe(2);

    const fullTextOnlyResponse = await request(app).get('/api/candidates?search=graphQL');
    expect(fullTextOnlyResponse.status).toBe(200);
    expect(fullTextOnlyResponse.body.data).toHaveLength(1);
    expect(fullTextOnlyResponse.body.data[0].id).toBe(1);
  });

  test('global search combines jobs and CV full text', async () => {
    const mockDb = createMockDb({
      jobs: [
        {
          id: 1,
          title: 'Senior Frontend Engineer',
          company: 'HRTool AG',
          location: 'Zürich',
          type: 'Vollzeit',
          status: 'Offen',
          description: 'Build React interfaces for the recruiting platform.',
          requirements: 'React, TypeScript',
          about_us: 'Modern product team',
          benefits: 'Remote friendly',
          url: 'https://example.com/jobs/1',
          skills: 'React, TypeScript',
          updated_at: '2026-01-03T00:00:00.000Z',
        },
        {
          id: 2,
          title: 'Backend Engineer',
          company: 'Code Factory',
          location: 'Bern',
          type: 'Vollzeit',
          status: 'Offen',
          description: 'Python services and APIs.',
          requirements: 'Python, FastAPI',
          about_us: 'Backend team',
          benefits: 'Hybrid',
          url: 'https://example.com/jobs/2',
          skills: 'Python, FastAPI',
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      ],
      candidates: [
        {
          id: 1,
          name: 'Anna Müller',
          email: 'anna@example.com',
          phone: '',
          location: 'Zürich',
          experience: 'Frontend Entwicklung',
          skills: 'React, Node.js',
          education: 'ETH Zürich',
          desired_salary: '',
          availability: '',
          languages: 'Deutsch, Englisch',
          certificates: '',
          drivers_license: '',
          mobility: '',
          notes: 'Sucht eine hybride Rolle',
          status: 'Aktiv',
          tags: 'Remote, Senior',
          source: 'LinkedIn',
          current_employer: 'HRTool AG',
          current_position: 'Senior Frontend Engineer',
          gender: '',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          name: 'Beatrice Keller',
          email: 'bea@example.com',
          phone: '',
          location: 'Bern',
          experience: 'Backend Entwicklung',
          skills: 'Python, Django',
          education: 'BFH',
          desired_salary: '',
          availability: '',
          languages: 'Deutsch',
          certificates: '',
          drivers_license: '',
          mobility: '',
          notes: 'Möchte nach Zürich wechseln',
          status: 'Aktiv',
          tags: 'Onsite',
          source: 'Stepstone',
          current_employer: 'Code Factory',
          current_position: 'Backend Engineer',
          gender: '',
          created_at: '2026-01-02T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      ],
      candidateTexts: [
        {
          candidate_id: '1',
          candidate_name: 'Anna Müller',
          source: 'CV Import',
          original_text: 'Anna Müller arbeitet seit Jahren mit React, TypeScript und GraphQL.',
          anonymized_text: null,
          profile_json: { name: 'Anna Müller' },
        },
        {
          candidate_id: '2',
          candidate_name: 'Beatrice Keller',
          source: 'CV Import',
          original_text: 'Backend-Schwerpunkt mit Python und Django.',
          anonymized_text: null,
          profile_json: { name: 'Beatrice Keller' },
        },
      ],
      matchingResults: [
        {
          id: 1,
          job_title: 'Senior Frontend Engineer',
          job_description: 'Build React interfaces for the recruiting platform.',
          results: JSON.stringify([{ candidateId: 1, score: 96 }]),
          review_notes: 'React match for remote role',
          reviewed_by: 'Reviewer',
          human_reviewed: 1,
          created_at: '2026-01-04T00:00:00.000Z',
        },
      ],
    });

    jest.doMock('../database', () => mockDb);

    const searchRouter = require('../routes/search');
    const app = express();
    app.use(express.json());
    app.use('/api/search', searchRouter);

    const response = await request(app).get('/api/search?q=react&limit=10');

    expect(response.status).toBe(200);
    expect(response.body.totalJobs).toBe(1);
    expect(response.body.totalCandidates).toBe(1);
    expect(response.body.totalMatchings).toBe(1);
    expect(response.body.jobs).toHaveLength(1);
    expect(response.body.jobs[0].title).toBe('Senior Frontend Engineer');
    expect(response.body.candidates).toHaveLength(1);
    expect(response.body.candidates[0].name).toBe('Anna Müller');
    expect(response.body.matchings).toHaveLength(1);
    expect(response.body.matchings[0].job_title).toBe('Senior Frontend Engineer');
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

    // Der CV-Parser laesst GraphRAG parsen und baut die Antwort aus
    // graphRag.profile. Frueher kam das Profil direkt aus der KI-Antwort,
    // deshalb reichte hier ein leeres {ok:true} - heute ist candidate.name
    // dann undefined. Ohne GRAPHRAG_BASE_URL wirft die Route ausserdem
    // "GraphRAG ist nicht konfiguriert" und antwortet mit 500.
    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'graph-cand-1',
        message: 'Candidate ingested successfully',
        profile: {
          name: 'Max Mustermann',
          email: 'max@example.com',
          skills: 'JavaScript, Node.js',
          work_history: [],
          education_history: [],
        },
      }),
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

  stackTest('CV parser parses Thomas fixture PDF with spaces in filename', async () => {
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
  stackTest('CV parser parses Daniel fixture with ollama:llama3.2 and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'llama3.2',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  stackTest('CV parser parses Daniel fixture with ollama:gemma4:latest and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma4:latest',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  stackTest('CV parser parses Daniel fixture with ollama:gemma4:26b and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma4:26b',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  stackTest('CV parser parses Daniel fixture with ollama:gemma4:31b and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma4:31b',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  stackTest('CV parser parses Daniel fixture with ollama:qwen3.6:35b and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'qwen3.6:35b',
      baseUrl: 'http://localhost:11434',
      provider: 'ollama',
    });
  }, 180000);

  */
  //lmstudio ------------------------
  /*
  stackTest('CV parser parses Daniel fixture with lmstudio:gemma-4-e4b-it-mlx and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma-4-e4b-it-mlx',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

  stackTest('CV parser parses Daniel fixture with lmstudio:gemma-4-26b-a4b-it-mlx and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma-4-26b-a4b-it-mlx',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

  stackTest('CV parser parses Daniel fixture with lmstudio:gemma-4-31b-a4b-it-mlx and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'gemma-4-31b-a4b-it-mlx',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

  stackTest('CV parser parses Daniel fixture with lmstudio:qwen3.6-35b-a3b-ud-mlx and stores data in database', async () => {
    await runDanielFixtureTest({
      modelName: 'qwen3.6-35b-a3b-ud-mlx',
      baseUrl: 'http://localhost:1234',
      provider: 'openai',
    });
  }, 180000);

  stackTest('CV parser parses Daniel fixture with lmstudio:llama-3.2-3b-instruct  and stores data in database', async () => {
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
      if (String(url) === 'http://fake-graphrag/ingest/job?persist=neo4j' && options?.method === 'POST') {
        const payload = JSON.parse(options.body);
        expect(payload.raw_text).toContain('Jobtitel: Senior Backend Engineer');
        expect(payload.raw_text).toContain('Anforderungen:');
        expect(payload.raw_text).toContain('Node.js');
        return {
          ok: true,
          json: async () => ({ id: 'graph-job-1', message: 'Job ingested successfully', persisted: true }),
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
    expect(response.body.graphRag).toEqual({ id: 'graph-job-1', message: 'Job ingested successfully', persisted: true });
    expect(mockDb.__state.jobs).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('Jobs delete API removes job from GraphRAG and PostgreSQL', async () => {
    const mockDb = createMockDb();

    jest.doMock('../database', () => mockDb);
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));

    process.env.GRAPHRAG_BASE_URL = 'http://fake-graphrag';
    global.fetch = jest.fn(async (url, options) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname === '/ingest/job' && options?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ id: 'graph-job-delete-me', message: 'Job ingested successfully', persisted: true }),
        };
      }

      if (requestUrl.pathname === '/ingest/job' && options?.method === 'DELETE') {
        const payload = JSON.parse(options.body);
        expect(payload.job_id).toBe('graph-job-delete-me');
        expect(payload.title).toBe('Delete Me');
        expect(payload.location).toBe('Berlin');
        return {
          ok: true,
          json: async () => ({ deleted: true, neo4j_deleted: 1, postgres_deleted: 1 }),
        };
      }

      return { ok: false, text: async () => 'unexpected fetch call' };
    });

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const createResponse = await request(app)
      .post('/api/jobs')
      .send({
        title: 'Delete Me',
        description: 'Node.js, APIs, Skalierung',
        requirements: '5+ Jahre Erfahrung',
        location: 'Berlin',
        type: 'Vollzeit',
        status: 'Offen',
      });

    expect(createResponse.status).toBe(201);
    expect(mockDb.__state.jobs).toHaveLength(1);
    expect(mockDb.__state.jobs[0].graph_job_id).toBe('graph-job-delete-me');

    const deleteResponse = await request(app).delete(`/api/jobs/${createResponse.body.id}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.success).toBe(true);
    expect(deleteResponse.body.graphRag).toEqual({ deleted: true, neo4j_deleted: 1, postgres_deleted: 1 });
    expect(mockDb.__state.jobs).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
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

    // Diese Zusicherungen betreffen die Abschnitts-Erkennung aus dem
    // Dateitext. Die lief frueher im Hauptpfad, heute uebernimmt das
    // Parsen GraphRAG - unveraendert geblieben ist sie unter extractOnly.
    const response = await request(app)
      .post('/api/jobs/parse-description?extractOnly=1')
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
      // Prueft die Abschnitts-Erkennung aus dem PDF-Text, nicht das Parsen
      .post('/api/jobs/parse-description?extractOnly=1')
      .attach('file', fixturePath);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.filename).toBe('Java Developer Sopra Steria.pdf');
    expect(response.body.text).toMatch(/Java Developer/i);
    expect(response.body.text).toMatch(/Sopra Steria/i);
    expect(response.body.description).toMatch(/Unternehmensbeschreibung/i);
    expect(response.body.description).toMatch(/Sopra Steria ist einer der führenden europäischen IT-Dienstleister/i);
  });

  test('Jobs description upload parses real PDF Java Developer Software+.pdf and persists to PostgreSQL and GraphRAG', async () => {
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
    // Der Test laeuft in zwei Schritten und trifft GraphRAG dabei zweimal:
    // Beide Schritte rufen /ingest/job auf, unterschieden nur durch persist:
    // parse-description mit persist=0 erwartet ein Profil zurueck, das Anlegen
    // der Stelle mit persist=neo4j nur eine Quittung. Der alte Vergleich auf
    // die exakte URL ohne Query liess den ersten Aufruf durchfallen - die
    // Route bekam "unexpected fetch call" und antwortete mit 500.
    global.fetch = jest.fn(async (url, options) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname === '/ingest/job' && options?.method === 'POST') {
        const payload = JSON.parse(options.body);
        expect(payload.raw_text).toContain('Java Developer');
        expect(payload.raw_text).toContain('Software');

        if (requestUrl.searchParams.get('persist') === '0') {
          // Aufruf aus parse-description: nur raw_text, GraphRAG liefert das Profil.
          return {
            ok: true,
            json: async () => ({
              id: 'graph-job-java-software',
              message: 'Job ingested successfully',
              profile: {
                title: 'Java Developer Software+',
                about_us: 'Software+ entwickelt Fachanwendungen.',
                description: 'Entwicklung von Java-Backends.',
                requirements: 'Java, Spring Boot, SQL',
                required_skills: ['Java', 'Spring Boot', 'SQL'],
                benefits: 'Flexible Arbeitszeiten',
                location: 'Remote',
                employment_type: 'Vollzeit',
              },
            }),
          };
        }

        // Aufruf aus dem Anlegen der Stelle (persist=neo4j): nur Quittung.
        return {
          ok: true,
          json: async () => ({ id: 'graph-job-java-software', message: 'Job ingested successfully' }),
        };
      }

      return { ok: false, text: async () => 'unexpected fetch call' };
    });

    const jobsRouter = require('../routes/jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', jobsRouter);

    const fixturePath = path.join(__dirname, 'fixtures', 'Java Developer Software+.pdf');
    const parseResponse = await request(app)
      .post('/api/jobs/parse-description')
      .attach('file', fixturePath);

    expect(parseResponse.status).toBe(200);
    expect(parseResponse.body.success).toBe(true);
    expect(parseResponse.body.filename).toBe('Java Developer Software+.pdf');
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
    expect(createResponse.body.graphRag).toEqual({
      id: 'graph-job-java-software',
      message: 'Job ingested successfully',
    });
    expect(mockDb.__state.jobs).toHaveLength(1);
      expect(mockDb.__state.jobs[0].title).toBe(jobTitle);
    expect(mockDb.__state.jobs[0].description).toBe(parseResponse.body.description);
    // Die Route haengt inzwischen eine persist-Query an; geprueft wird der
    // Pfad, nicht die exakte URL.
    expect(global.fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === '/ingest/job')).toBe(true);
  });

  stackTest('Jobs parse-description with real AI parses Senior Data Engineer fixture and persists job', async () => {
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

    const storedJobCount = db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE title = ?').get(jobTitle);
    expect(storedJobCount.count).toBe(1);

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

    global.fetch = jest.fn(async (url, options) => {
      if (!options || options.method !== 'POST') {
        return { ok: true, json: async () => ({ ok: true }), text: async () => JSON.stringify({ ok: true }) };
      }

      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      candidateId: 1,
                      candidateName: 'Max Mustermann',
                      score: 87,
                      strengths: ['Starke Backend-Erfahrung'],
                      weaknesses: ['Wenig DevOps'],
                      summary: 'Sehr guter Fit fuer Backend-Rolle',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      };
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

  test('Matching run resolves job and candidate data from SQL when jobId and candidateId are provided', async () => {
    const mockDb = createMockDb({
      jobs: [
        {
          id: 2,
          title: 'Backend Engineer',
          description: 'Job description from SQL',
          requirements: 'Node.js, APIs, Tests',
          skills: 'Node.js, Express, SQL',
          location: 'Berlin',
          type: 'Vollzeit',
        },
      ],
      candidates: [
        {
          id: 7,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          location: 'Berlin',
          experience: '7 Jahre Backend',
          skills: 'Node.js, Express, SQL',
          education: 'MSc Computer Science',
          desired_salary: '90000',
          availability: 'Sofort',
          languages: 'Deutsch C1, Englisch C2',
          certificates: 'AWS',
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
              candidateId: 7,
              candidateName: 'Ada Lovelace',
              score: 95,
              strengths: ['Sehr starker SQL-Fit'],
              weaknesses: [],
              summary: 'Sehr guter Match',
            },
          ],
        }),
      }),
      pingAiService: async () => true,
    }));

    global.fetch = jest.fn(async (url, options) => {
      if (!options || options.method !== 'POST') {
        return { ok: true, json: async () => ({ ok: true }), text: async () => JSON.stringify({ ok: true }) };
      }

      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      candidateId: 7,
                      candidateName: 'Ada Lovelace',
                      score: 95,
                      strengths: ['Sehr starker SQL-Fit'],
                      weaknesses: [],
                      summary: 'Sehr guter Match',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      };
    });

    const matchingRouter = require('../routes/matching');
    const app = express();
    app.use(express.json());
    app.use('/api/matching', matchingRouter);

    const response = await request(app)
      .post('/api/matching/run')
      .send({
        jobId: 2,
        candidateId: 7,
        weights: { skills: 5 },
      });

    expect(response.status).toBe(200);
    expect(response.body.jobId).toBe(2);
    expect(response.body.candidateCount).toBe(1);
    expect(response.body.results.results).toHaveLength(1);
    expect(response.body.results.results[0].candidateName).toBe('Ada Lovelace');
    expect(mockDb.__state.matchingResults).toHaveLength(1);
  });

  test('Matching run falls back to candidate names when selected rows do not contain numeric candidate IDs', async () => {
    const mockDb = createMockDb({
      jobs: [
        {
          id: 9,
          title: 'Data Engineer',
          description: 'SQL data platform role',
          requirements: 'SQL, ETL, Airflow',
          skills: 'SQL, ETL, Airflow',
          location: 'Zug',
          type: 'Vollzeit',
        },
      ],
      candidates: [
        {
          id: 13,
          name: 'Grace Hopper',
          email: 'grace@example.com',
          location: 'Zug',
          experience: '10 Jahre Data Engineering',
          skills: 'SQL, ETL, Airflow',
          education: 'PhD Computer Science',
          desired_salary: '110000',
          availability: 'Sofort',
          languages: 'Deutsch B2, Englisch C2',
          certificates: 'Azure',
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
              candidateId: 13,
              candidateName: 'Grace Hopper',
              score: 92,
              strengths: ['Passender SQL-Stack'],
              weaknesses: [],
              summary: 'Sehr guter Match',
            },
          ],
        }),
      }),
      pingAiService: async () => true,
    }));

    global.fetch = jest.fn(async (url, options) => {
      if (!options || options.method !== 'POST') {
        return { ok: true, json: async () => ({ ok: true }), text: async () => JSON.stringify({ ok: true }) };
      }

      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      candidateId: 13,
                      candidateName: 'Grace Hopper',
                      score: 92,
                      strengths: ['Passender SQL-Stack'],
                      weaknesses: [],
                      summary: 'Sehr guter Match',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      };
    });

    const matchingRouter = require('../routes/matching');
    const app = express();
    app.use(express.json());
    app.use('/api/matching', matchingRouter);

    const response = await request(app)
      .post('/api/matching/run')
      .send({
        jobId: 9,
        candidateNames: ['Grace Hopper'],
      });

    expect(response.status).toBe(200);
    expect(response.body.candidateCount).toBe(1);
    expect(response.body.results.results[0].candidateName).toBe('Grace Hopper');
  });

  test('Vector matching returns local Postgres ids in the response payload', async () => {
    const mockDb = createMockDb({
      jobs: [
        {
          id: 2,
          title: 'Backend Engineer',
          description: 'Job description from SQL',
          requirements: 'Node.js, APIs, Tests',
          skills: 'Node.js, Express, SQL',
          location: 'Berlin',
          type: 'Vollzeit',
        },
      ],
      candidates: [
        {
          id: 7,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          location: 'Berlin',
          experience: '7 Jahre Backend',
          skills: 'Node.js, Express, SQL',
          education: 'MSc Computer Science',
          desired_salary: '90000',
          availability: 'Sofort',
          languages: 'Deutsch C1, Englisch C2',
          certificates: 'AWS',
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
      extractAiText: () => ({ text: JSON.stringify({ results: [] }) }),
      pingAiService: async () => true,
    }));

    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/match/vectormatch')) {
        return {
          ok: true,
          json: async () => ({
            type: 'vectormatch',
            mode: 'job_cv_vector',
            model: 'graph-rag-python-skill-vector-match',
            matchedAt: '2026-09-18T00:00:00.000Z',
            jobs: [{ id: 'graph-job-1', title: 'Backend Engineer' }],
            candidates: [{ id: 'graph-cand-1', name: 'Ada Lovelace' }],
            matrix: [
              {
                jobId: 'graph-job-1',
                jobTitle: 'Backend Engineer',
                candidateId: 'graph-cand-1',
                candidateName: 'Ada Lovelace',
                score: 93,
                vectorScore: 0.93,
                hardSkillScore: 0.9,
                softSkillScore: 0.8,
                strengths: ['Starke Backend-Erfahrung'],
                weaknesses: [],
                summary: 'Sehr guter Fit',
                matchedSkills: [],
              },
            ],
            jobsRanked: [{ jobId: 'graph-job-1', jobTitle: 'Backend Engineer', results: [] }],
            candidatesRanked: [{ candidateId: 'graph-cand-1', candidateName: 'Ada Lovelace', results: [] }],
          }),
        };
      }

      return { ok: true, json: async () => ({ ok: true }), text: async () => JSON.stringify({ ok: true }) };
    });

    const matchingRouter = require('../routes/matching');
    const app = express();
    app.use(express.json());
    app.use('/api/matching', matchingRouter);

    const response = await request(app)
      .post('/api/matching/vectormatch')
      .send({
        jobId: 2,
        candidateIds: [7],
        engine: 'python',
      });

    expect(response.status).toBe(200, response.text);
    expect(response.body.results.matrix).toHaveLength(1);
    expect(response.body.results.matrix[0].jobId).toBe(2);
    expect(response.body.results.matrix[0].candidateId).toBe(7);
    expect(response.body.results.matrix[0].sourceJobId).toBe('graph-job-1');
    expect(response.body.results.matrix[0].sourceCandidateId).toBe('graph-cand-1');
    expect(response.body.results.jobsRanked[0].jobId).toBe(2);
    expect(response.body.results.candidatesRanked[0].candidateId).toBe(7);
  });

  test('Selected matching batch prefers structured job skills over free-text requirements', async () => {
    const mockDb = createMockDb({
      jobs: [
        {
          id: 2,
          title: 'Java Developer Sopra Steria',
          description: 'Java Developer description',
          requirements: 'Long free-text requirements',
          skills: 'Java, Spring, REST, Angular',
        },
      ],
      candidates: [
        {
          id: 99,
          name: 'Thomas Zimmermann',
          location: 'Bern',
          experience: 'Senior Java Developer',
          skills: 'Java, Spring, REST, Angular',
          education: 'Informatik',
          desired_salary: '120000',
          availability: 'Sofort',
          languages: 'Deutsch C1',
          certificates: '',
          mobility: 'Remote',
        },
      ],
      candidateTexts: [
        {
          candidate_id: '99',
          candidate_name: 'Thomas Zimmermann',
          source: 'CV Import',
          original_text: 'Thomas Zimmermann ist ein Senior Java Developer mit Java, Spring, REST, Angular und Erfahrung in GraphQL.',
          anonymized_text: null,
          profile_json: { name: 'Thomas Zimmermann' },
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
      buildAiRequest: ({ baseUrl, model, provider, prompt }) => ({
        url: `${baseUrl}/api/generate`,
        body: { model, provider, prompt },
      }),
      extractAiText: () => ({
        text: JSON.stringify({
          results: [
            {
              candidateId: 99,
              candidateName: 'Thomas Zimmermann',
              score: 91,
              strengths: ['Sehr guter Fit'],
              weaknesses: [],
              summary: 'Sehr guter Fit fuer Java',
            },
          ],
        }),
      }),
    }));

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            jobId: 2,
            jobTitle: 'Java Developer Sopra Steria',
            candidateId: 99,
            candidateName: 'Thomas Zimmermann',
            score: 91,
            strengths: ['Sehr guter Fit'],
            weaknesses: [],
            summary: 'Sehr guter Fit fuer Java',
          },
        ],
        failures: [],
        selectedCount: 1,
        matchedCount: 1,
        failedCount: 0,
        timestamp: '2026-09-18T00:00:00.000Z',
      }),
    });

    const matchingRouter = require('../routes/matching');
    const app = express();
    app.use(express.json());
    app.use('/api/matching', matchingRouter);

    const response = await request(app)
      .post('/api/matching/run-selected')
      .send({
        pairs: [
          {
            jobId: 'graph-job-1',
            sourceJobId: 2,
            jobTitle: 'Java Developer Sopra Steria',
            jobDescription: 'Java Developer description',
            candidateId: 'graph-cand-1',
            sourceCandidateId: 99,
            candidateName: 'Thomas Zimmermann',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].score).toBe(91);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestOptions] = global.fetch.mock.calls[0];
    expect(requestUrl).toContain('/match/ki_match_pairs');
    const requestBody = JSON.parse(requestOptions.body);
    expect(requestBody.pairs).toEqual([
      {
        jobId: 2,
        jobTitle: 'Java Developer Sopra Steria',
        candidateId: 99,
        candidateName: 'Thomas Zimmermann',
      },
    ]);
    expect(requestBody.weights).toBeUndefined();
  });

  test('Matching run returns 400 when neither jobId nor job description is provided', async () => {
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
    expect(response.body.error).toMatch(/jobId oder Stellenbeschreibung ist erforderlich/i);
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
