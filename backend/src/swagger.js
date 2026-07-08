const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'HR-Tool API',
      version: '1.0.0',
      description: 'REST API für das HR-Tool – Bewerberverwaltung, Matching, Pipeline & mehr',
      contact: { name: 'Sebastian Oczachowski' },
    },
    servers: [{ url: '/api', description: 'API Server' }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
      schemas: {
        Candidate: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            name: { type: 'string', example: 'Max Mustermann' },
            email: { type: 'string', example: 'max@example.com' },
            phone: { type: 'string', example: '+49 123 456789' },
            location: { type: 'string', example: 'Berlin' },
            experience: { type: 'string', example: '5 Jahre Softwareentwicklung...' },
            skills: { type: 'string', example: 'JavaScript, React, Node.js' },
            education: { type: 'string', example: 'B.Sc. Informatik, TU Berlin' },
            desired_salary: { type: 'string', example: '60.000€' },
            availability: { type: 'string', example: 'sofort' },
            languages: { type: 'string', example: 'Deutsch (Muttersprache), Englisch (C1)' },
            certificates: { type: 'string', example: 'AWS Certified, Scrum Master' },
            drivers_license: { type: 'string', example: 'B' },
            mobility: { type: 'string', example: 'flexibel' },
            notes: { type: 'string' },
            status: { type: 'string', enum: ['Aktiv', 'Passiv', 'In Prozess', 'Blacklist'], default: 'Aktiv' },
            tags: { type: 'string', example: 'Senior, Remote' },
            source: { type: 'string', example: 'LinkedIn' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Job: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string', example: 'Frontend Developer' },
            description: { type: 'string' },
            requirements: { type: 'string' },
            location: { type: 'string' },
            type: { type: 'string', enum: ['Vollzeit', 'Teilzeit', 'Freelance', 'Praktikum', 'Werkstudent'] },
            status: { type: 'string', enum: ['Offen', 'Besetzt', 'Pausiert', 'Archiviert'] },
            url: { type: 'string' },
            candidate_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        PipelineEntry: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            job_id: { type: 'integer' },
            candidate_id: { type: 'integer' },
            stage: { type: 'string', enum: ['Beworben', 'Vorauswahl', 'Interview', 'Angebot', 'Hired', 'Abgesagt'] },
            notes: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        MatchingResult: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            job_title: { type: 'string' },
            job_description: { type: 'string' },
            results: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        ExternalMatchingRequest: {
          type: 'object',
          required: ['job', 'candidates'],
          properties: {
            job: {
              type: 'object',
              required: ['title'],
              properties: {
                id: { type: 'string', example: 'job-frontend-01' },
                title: { type: 'string', example: 'Frontend Developer' },
                description: { type: 'string', example: 'React-Anwendung fuer ein SaaS-Produkt weiterentwickeln.' },
                requirements: { type: 'string', example: 'React, TypeScript, REST APIs, 3+ Jahre Erfahrung' },
                location: { type: 'string', example: 'Berlin / Remote' },
                type: { type: 'string', example: 'Vollzeit' },
              },
            },
            candidates: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: {
                type: 'object',
                required: ['id'],
                properties: {
                  id: { type: 'string', example: 'cand-4711' },
                  name: { type: 'string', example: 'Kandidat 4711' },
                  skills: { type: 'string', example: 'React, Node.js, SQL' },
                  experience: { type: 'string', example: '5 Jahre Frontend-Entwicklung' },
                  education: { type: 'string', example: 'B.Sc. Informatik' },
                  languages: { type: 'string', example: 'Deutsch C2, Englisch C1' },
                  location: { type: 'string', example: 'Berlin' },
                  desired_salary: { type: 'string', example: '65000 EUR' },
                  availability: { type: 'string', example: 'ab 01.09.' },
                  certificates: { type: 'string', example: 'Scrum Master' },
                  mobility: { type: 'string', example: 'Remote, Reisebereitschaft 20%' },
                },
              },
            },
            weights: { type: 'object', description: 'Optionale Gewichtung -10 bis +10 je Kriterium' },
            options: {
              type: 'object',
              properties: {
                timeoutMs: { type: 'integer', example: 180000 },
              },
            },
          },
        },
        ExternalMatchingResponse: {
          type: 'object',
          properties: {
            job: { type: 'object' },
            results: { type: 'array', items: { type: 'object' } },
            candidateCount: { type: 'integer' },
            model: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Activity: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            candidate_id: { type: 'integer' },
            type: { type: 'string', enum: ['Notiz', 'Anruf', 'E-Mail', 'Interview', 'Angebot', 'Absage', 'Pipeline'] },
            content: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            username: { type: 'string' },
            display_name: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'recruiter'] },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: {} },
            total: { type: 'integer', description: 'Gesamtzahl der Einträge' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Fehler beim Laden' },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: [path.join(__dirname, 'routes', '*.js')],
};

module.exports = swaggerJsdoc(options);
