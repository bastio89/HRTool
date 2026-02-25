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
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
