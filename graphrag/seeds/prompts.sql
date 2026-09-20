INSERT INTO prompts (key, template, description, model_parameters)
VALUES
  (
    'candidate_name_extraction',
    'Extract only the candidate''s full personal name from this CV text. Return JSON exactly with key: name. Do not return role titles, department names, labels, or placeholders.',
    'Candidate name extraction prompt',
    '{}'::jsonb
  ),
  (
    'candidate_profile_extraction',
    'Extract a candidate profile from CV/resume text (any language, e.g. English, German, French, Italian). The field name must be the candidate''s full personal name from the CV header/title, never a section heading (e.g. ''Expérience Professionnelle'', ''Berufserfahrung''), role title, company name, or generic label. Return JSON with keys: name (string), location (string|null), experience_years (number|null), salary_expectation (number|null), current_employer (string|null), current_position (string|null), skills (array of objects with name, category=HardSkill|SoftSkill|null, level|null, experience_years|null), languages (array of objects with name, level|null), educations (array of objects with level, field_of_study), industries (array of objects with name), preferred_roles (array of strings), work_history (array of objects with employer, position, from_date (YYYY-MM or null), to_date (YYYY-MM or null, empty if current), is_current (boolean), description|null, location|null). Create a SEPARATE work_history entry for EVERY employer/period mentioned in the CV, sorted with the most recent role first. education_history (array of objects with institution, degree, field_of_study, from_date (YYYY-MM or null), to_date (YYYY-MM or null, description|null). Create a SEPARATE education_history entry for EVERY degree/institution mentioned, sorted with the most recent first. Keep every description to at most 150 characters, a short summary of the role or studies, not a verbatim copy of bullet points. Normalize names to concise terms and use null for unknown values.',
    'Candidate CV extraction prompt',
    '{}'::jsonb
  ),
  (
    'job_profile_extraction',
    'Extrahiere ein strukturiertes Jobprofil aus einer Stellenbeschreibung. Es geht nur um die inhaltliche Extraktion, nicht um Anonymisierung oder Umformulierung. Die Ausgabe wird direkt in die PostgreSQL-Spalten jobs.title, jobs.company, jobs.recruiter_company, jobs.employer_company, jobs.location, jobs.type, jobs.about_us, jobs.description, jobs.requirements und jobs.benefits geschrieben. Das Feld required_skills ist die primäre Quelle für die Neo4j-Beziehungen REQUIRES_SKILL und NEED_SKILL; jedes Element muss daher ein einzelnes, klar benanntes Skill-Objekt sein. Lasse keine explizit genannten Skills weg, fasse unterschiedliche Skills nicht zu Sammelbegriffen zusammen und setze priority exakt auf Mandatory oder NiceToHave. Gib ausschließlich JSON mit diesen Schlüsseln zurück: title (string), company (string|null), recruiter_company (string|null), employer_company (string|null), location (string|null), employment_type (string|null), department (string|null), about_us (string|null), description (string|null), requirements (string|null), benefits (string|null), required_skills (array of objects with name, category=HardSkill|SoftSkill|null, priority where priority is exactly Mandatory or NiceToHave), required_languages (array of objects with name, level), required_degrees (array of objects with level, field_of_study), industries (array of objects with name).',
    'Job extraction prompt',
    '{}'::jsonb
  ),
  (
    'job_profile_extraction_lightweight',
    'Extrahiere die Kerndaten einer Stelle aus einer Stellenbeschreibung. Auch hier gilt: nur extrahieren, nicht anonymisieren. Gib JSON mit den Schlüsseln title, company, recruiter_company, employer_company, location, about_us, description, requirements, benefits, required_skills, required_languages, required_degrees und industries zurück. required_skills ist weiterhin die Quelle für REQUIRES_SKILL und NEED_SKILL; priorisiere vollständige und präzise Skill-Namen. For required_skills include priority exactly as Mandatory or NiceToHave.',
    'Lightweight job extraction prompt',
    '{}'::jsonb
  ),
  (
    'matching_rerank',
    'You are an HR matching assistant. Score candidates from 1-100 based on fit. Return JSON with key ranked_candidates containing objects with candidate_id, score, and explanation. Keep explanations concise and factual.',
    'Matching rerank prompt',
    '{}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;