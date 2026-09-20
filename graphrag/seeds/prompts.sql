INSERT INTO prompts (key, template, description, model_parameters)
VALUES
  (
    'candidate_name_extraction',
    'Extrahiere aus diesem CV nur den vollständigen persönlichen Namen der Kandidatin oder des Kandidaten. Gib ausschließlich JSON mit genau dem Schlüssel name zurück. Gib keine Rollentitel, Abteilungsnamen, Labels oder Platzhalter zurück.',
    'Prompt zur Extraktion des Kandidatennamens',
    '{}'::jsonb
  ),
  (
    'candidate_profile_extraction',
    'Extrahiere aus einem CV oder Lebenslauf ein Kandidatenprofil, unabhängig von der Sprache, zum Beispiel Deutsch, Englisch, Französisch oder Italienisch. Das Namensfeld muss der vollständige persönliche Name aus Kopfzeile oder Titel des CVs sein, niemals eine Abschnittsüberschrift wie "Expérience Professionnelle" oder "Berufserfahrung", kein Rollentitel, Firmenname und kein generisches Label. Lies den beruflichen Werdegang besonders sorgfältig aus Abschnitten wie "Beruflicher Werdegang", "Berufserfahrung", "Professional Experience", "Employment History" oder aus Tabellen, Timelines und Stichpunkten; wenn mehrere Stationen genannt sind, müssen sie alle als separate work_history-Einträge erscheinen. Gib JSON mit folgenden Schlüsseln zurück: name (string), location (string|null), experience_years (number|null), salary_expectation (number|null), current_employer (string|null), current_position (string|null), skills (array of objects with name, category=HardSkill|SoftSkill|null, level|null, experience_years|null), languages (array of objects with name, level|null), educations (array of objects with level, field_of_study), industries (array of objects with name), preferred_roles (array of strings), work_history (array of objects with employer, position, from_date (YYYY-MM oder null), to_date (YYYY-MM oder null, leer wenn aktuell), is_current (boolean), description|null, location|null). Erzeuge für JEDE genannte Firma, Position oder jeden Zeitraum einen eigenen work_history-Eintrag und sortiere die Einträge mit der aktuellsten Position zuerst. education_history (array of objects with institution, degree, field_of_study, from_date (YYYY-MM oder null), to_date (YYYY-MM oder null, description|null). Erzeuge für JEDE genannte Ausbildung bzw. Hochschule einen eigenen education_history-Eintrag und sortiere die Einträge mit der aktuellsten Angabe zuerst. Halte jede Beschreibung auf maximal 150 Zeichen, als kurze Zusammenfassung der Rolle oder Ausbildung, nicht als wörtliche Übernahme von Aufzählungspunkten. Normalisiere Namen auf knappe Begriffe und verwende null für unbekannte Werte.',
    'Prompt zur CV-Extraktion',
    '{}'::jsonb
  ),
  (
    'job_profile_extraction',
    'Extrahiere aus einer Stellenbeschreibung ein strukturiertes Jobprofil. Es geht nur um die inhaltliche Extraktion, nicht um Anonymisierung oder Umformulierung. Die Ausgabe wird direkt in die PostgreSQL-Spalten jobs.title, jobs.company, jobs.recruiter_company, jobs.employer_company, jobs.location, jobs.type, jobs.about_us, jobs.description, jobs.requirements und jobs.benefits geschrieben. Das Feld required_skills ist die primäre Quelle für die Neo4j-Beziehungen REQUIRES_SKILL und NEED_SKILL; jedes Element muss daher ein einzelnes, klar benanntes Skill-Objekt sein. Lasse keine explizit genannten Skills weg, fasse unterschiedliche Skills nicht zu Sammelbegriffen zusammen und setze priority exakt auf Mandatory oder NiceToHave. Gib ausschließlich JSON mit diesen Schlüsseln zurück: title (string), company (string|null), recruiter_company (string|null), employer_company (string|null), location (string|null), employment_type (string|null), department (string|null), about_us (string|null), description (string|null), requirements (string|null), benefits (string|null), required_skills (array of objects with name, category=HardSkill|SoftSkill|null, priority where priority is exactly Mandatory oder NiceToHave), required_languages (array of objects with name, level), required_degrees (array of objects with level, field_of_study), industries (array of objects with name).',
    'Prompt zur Job-Extraktion',
    '{}'::jsonb
  ),
  (
    'job_profile_extraction_lightweight',
    'Extrahiere die Kerndaten einer Stelle aus einer Stellenbeschreibung. Auch hier gilt: nur extrahieren, nicht anonymisieren. Gib JSON mit den Schlüsseln title, company, recruiter_company, employer_company, location, about_us, description, requirements, benefits, required_skills, required_languages, required_degrees und industries zurück. required_skills ist weiterhin die Quelle für REQUIRES_SKILL und NEED_SKILL; priorisiere vollständige und präzise Skill-Namen. Für required_skills setze priority exakt auf Mandatory oder NiceToHave.',
    'Prompt für die leichte Job-Extraktion',
    '{}'::jsonb
  ),
  (
    'matching_rerank',
    'Du bist ein HR-Matching-Assistent. Bewerte Kandidatinnen und Kandidaten von 1 bis 100 nach Passung. Gib JSON mit dem Schlüssel ranked_candidates zurück, das Objekte mit candidate_id, score und explanation enthält. Halte die Erklärungen knapp und sachlich.',
    'Prompt für das Matching-Reranking',
    '{}'::jsonb
  ),
  (
    'json_only_response_instruction',
    'Antworte ausschließlich mit gültigem JSON und ohne Markdown oder zusätzlichen Text. Wandle die Eingabe in eine strukturierte JSON-Antwort um.',
    'Instruktion für reine JSON-Antworten',
    '{}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;