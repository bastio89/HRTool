# Aufgaben: Skill-Abdeckung für 3D- und M×N-Matching

**Grundlage**: [spec.md](spec.md) · [plan.md](plan.md) · [data-model.md](data-model.md) ·
[contracts/api.md](contracts/api.md)

**Tests**: Pflicht (Grundsatz IV). Jede Phase beginnt mit den Tests ihrer
Akzeptanzszenarien. Sie müssen ohne die Umsetzung fehlschlagen.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel möglich (andere Dateien, keine offene Abhängigkeit)
- **[US1]…[US6]**: User Story aus `spec.md`
- Pfade relativ zum Repository

---

## Phase 1: Vorbereitung

**Zweck**: Abhängigkeiten und Datenbankstruktur

- [ ] T001 [P] `numpy` als direkte Abhängigkeit in `graphrag/requirements.txt` aufnehmen
- [ ] T002 [P] Tabellen `skill_synonyms`, `skill_false_friends`, Spalten `scoring_version` (`matching_pair_results`, `matching_results`) und Standard-Einstellungen `skill_match_*` / `skill_embedding_template` anlegen in `backend/src/database.js`; Jest-Test, dass die Struktur auf leerer und bestehender Datenbank entsteht (`backend/src/__tests__/skill-coverage.test.js`)
- [ ] T003 [P] Gerüst für Testdaten `graphrag/tests/fixtures/` und Hilfsfunktion „feste Embeddings je Skill-Name“ für Unit-Tests in `graphrag/tests/conftest.py`

---

## Phase 2: Grundlagen (blockiert alle Stories)

**Zweck**: Bewertungskern, Embeddings mit Version, Konfiguration

**⚠️ Keine Story beginnt vor Abschluss dieser Phase.**

- [ ] T004 [P] Tests für Normalisierung und Abdeckungsfunktion (Schwellen, linearer Bereich, Gewichte, Hard/Soft-Regeln aus `data-model.md`, Muss-Abdeckung ≥ 50 %) in `graphrag/tests/test_skill_coverage.py`
- [ ] T005 Bewertungskern `normalize`, `coverage`, `score_skill_coverage`, `score_matrix` (numpy) in `graphrag/services/skill_coverage.py` – rein, ohne Datenbank und Netzwerk
- [ ] T006 [P] Tests für Embedding-Text (Vorlage), `embedding_version`, Schreiben von Version/Text in Neo4j (Fake-Treiber), **kein** zufälliges Ersatz-Embedding bei Fehlern in `graphrag/tests/test_skill_embeddings.py`
- [ ] T007 `create_embeddings(texts)` (mehrere Texte je Anfrage, `dimensions=1536` für `text-embedding-3-*`, Fehler statt Ersatz-Embedding) in `graphrag/services/llm.py`
- [ ] T008 `ensure_current(names)` und Lesen/Schreiben von `embedding_version`/`embedding_text` in `graphrag/services/skill_embeddings.py` und `graphrag/services/db.py`
- [ ] T009 [P] Einstellungen, Synonyme, Verwechslungspaare lesen in `graphrag/services/postgres_store.py`; Tests gegen PostgreSQL in `graphrag/tests/test_skill_coverage_api.py`
- [ ] T010 `skill_matching_config.py` mit Cache und `scoring_version` (ändert sich bei jeder relevanten Einstellung) in `graphrag/services/skill_matching_config.py`

**Checkpoint**: Kern rechnet nach `data-model.md`; Embeddings tragen Versionen.

---

## Phase 3: User Story 1 – Fachfremde Skills zählen nicht (P1) 🎯 MVP

**Ziel**: Fachfremde Paarungen landen nahe 0 %.
**Unabhängiger Test**: Beispiel Fahrzeugaufbereiter × Genomik-Forscherin über `/match/vectormatch`.

### Tests zuerst

- [ ] T011 [P] [US1] Akzeptanzszenarien 1–3 (Beispiel ≤ 15 %, „R“/„C“/„Go“ ohne Teilstring-Treffer, Java ↔ JavaScript kein Treffer) mit festen Embeddings in `graphrag/tests/test_skill_coverage.py`
- [ ] T012 [P] [US1] Endpunkt-Test: `/match/vectormatch` liefert neues Format mit `scoringVersion`, `engine=neo4j` liefert dasselbe Ergebnis, `503` mit Skill-Liste wenn OpenRouter ausfällt, in `graphrag/tests/test_skill_coverage_api.py`

### Umsetzung

- [ ] T013 [US1] `/match/vectormatch` auf `ensure_current` + `score_skill_coverage` umstellen, `engine` ignorieren in `graphrag/matching_api.py`
- [ ] T014 [US1] Cypher-Bewertung `get_vectormatch_neo4j_rows` und alte Funktionen `score_vector_pair*`, `score_skill_pair`, `lexical_similarity` entfernen (`graphrag/services/db.py`, `graphrag/matching_api.py`); bestehende Tests anpassen
- [ ] T015 [US1] Verwechslungspaare anwenden (Kern) und Vorbelegung Java/JavaScript, C/C#, C++/C# nach HR-Bestätigung in `backend/src/database.js`

**Checkpoint**: 3D liefert für das Beispiel ≤ 15 %.

---

## Phase 4: User Story 3 – Gleiche und gleichbedeutende Skills zählen voll (P1)

**Ziel**: Passende Bewerber erreichen 100 %.
**Unabhängiger Test**: identische, anders geschriebene und synonyme Skill-Listen.

### Tests zuerst

- [ ] T016 [P] [US3] Akzeptanzszenarien 1–4 (identisch 100 %, Schreibvarianten, Synonym, verwandt ≥ τ_oben voll / dazwischen teilweise) in `graphrag/tests/test_skill_coverage.py`
- [ ] T017 [P] [US3] Jest-Tests für Synonym-/Verwechslungs-API (Anlegen, Doppelter Alias `409`, Ketten auflösen, nur Admin, Audit-Log) in `backend/src/__tests__/skill-coverage.test.js`

### Umsetzung

- [ ] T018 [US3] Synonymauflösung (`canon`) inkl. Ketten im Kern und in `skill_matching_config.py`
- [ ] T019 [US3] Routen `/api/skill-matching/synonyms` und `/false-friends` in `backend/src/routes/skill-matching.js`, eingebunden in `backend/server.js`

**Checkpoint**: Gleiche/synonyme Skills = 100 %; Synonymliste pflegbar per API.

---

## Phase 5: User Story 2 – Gleicher Wert überall (P1)

**Ziel**: 3D und M×N liefern für dieselbe Paarung identische Werte; keine Mischung im Speicher.
**Unabhängiger Test**: Paarung per 3D und per M×N rechnen und vergleichen.

### Tests zuerst

- [ ] T020 [P] [US2] Jest: `/api/matching/run-matrix` gleicht Neo4j ab, ruft `/match/vectormatch` mit allen UUIDs und `detail=summary` auf, speichert `scoring_version`; gleiche Paarung = gleicher Wert wie `/vectormatch`; Stelle ohne Skills → Hinweis statt Sätze aus dem Freitext (`backend/src/__tests__/skill-coverage.test.js`)
- [ ] T021 [P] [US2] pytest: `detail=summary` ohne `matchedSkills`; `score_matrix` = Einzelbewertung; Laufzeit 50 × 500 synthetisch < 30 s (SC-005) in `graphrag/tests/test_skill_coverage.py`
- [ ] T022 [P] [US2] pytest: `/match/external/*` rechnen über denselben Kern in `graphrag/tests/test_skill_coverage_api.py`

### Umsetzung

- [ ] T023 [US2] `/run-matrix` neu (Abgleich + `/match/vectormatch`), `engine` ignorieren in `backend/src/routes/matching.js`
- [ ] T024 [US2] `scoring_version` beim Speichern übernehmen in `backend/src/matchingPairs.js`
- [ ] T025 [US2] `detail=summary` und `score_matrix` in `graphrag/matching_api.py`; externe Endpunkte auf den Kern umstellen
- [ ] T026 [P] [US2] Engine-Auswahl entfernen in `frontend/src/pages/JobToCandidates.jsx`, `CandidateToJobs.jsx`, `MatrixMatching.jsx`, `SelectedMatchingResults.jsx`, `MatchingResults.jsx` und `frontend/src/api.js`; Vitest-Tests anpassen

**Checkpoint**: P1 komplett – Werte korrekt und überall gleich (mit Start-Schwellen). Auslieferbar.

---

## Phase 6: User Story 4 – Erklärung für Recruiter (P2)

**Ziel**: Je Skill sichtbar, wie er abgedeckt ist; „x von y Muss-Skills“.

### Tests zuerst

- [ ] T027 [P] [US4] pytest + Jest: `/match/skill-coverage/explain` und `/api/matching/skill-coverage/explain` liefern dieselben Werte wie die Matrix, mit `matchedSkills`, ohne Credits
- [ ] T028 [P] [US4] Vitest: `SkillCoverageBreakdown` zeigt Treffer-Art, Bewerber-Skill, Abdeckung, Muss/Kann, „ohne Embedding“, Kopfzeile „x von y Muss-Skills“ in `frontend/src/components/SkillCoverageBreakdown.test.jsx`

### Umsetzung

- [ ] T029 [US4] Erklär-Endpunkte in `graphrag/matching_api.py` und `backend/src/routes/matching.js`
- [ ] T030 [US4] Komponente `frontend/src/components/SkillCoverageBreakdown.jsx`; einbinden in Ergebnisansichten, in der M×N-Matrix per Klick nachladen; Texte in `frontend/src/i18n/de.js`, `en.js`

**Checkpoint**: Jede Zahl ist für HR erklärbar.

---

## Phase 7: User Story 5 – Schwellen aus eigenen Daten bestimmen (P2)

**Ziel**: Modell und Schwellen anhand von `skills.csv` und HR-Prüfset festlegen.
**Externe Voraussetzung**: `skills.csv` und beurteiltes Prüfset von euch (`datenbedarf.md`).

### Tests zuerst

- [ ] T031 [P] [US5] pytest: Kalibrierung mit Fake-Embedding-Anbieter – Verteilungen, Schwellenvorschlag, Fehlzuordnungen, Synonym-Vorschläge, Ausgabe der Fixture-Datei in `graphrag/tests/test_calibration.py`
- [ ] T032 [P] [US5] pytest: Prüfset-Test (SC-002–SC-004) mit `graphrag/tests/fixtures/pruefset_embeddings.json`; ohne Datei mit klarer Meldung übersprungen, in `graphrag/tests/test_pruefset.py`
- [ ] T033 [P] [US5] Jest + Vitest: Einstellungen lesen/speichern mit Prüfregeln, nur Admin; Admin-Seite speichert und zeigt Status

### Umsetzung

- [ ] T034 [US5] Werkzeug `graphrag/batch_tools/calibrate_skill_similarity.py` (OpenRouter-Modelle im Vergleich, Bericht als Markdown, Fixture-Datei)
- [ ] T035 [US5] Routen `/api/skill-matching/settings` in `backend/src/routes/skill-matching.js`
- [ ] T036 [US5] Admin-Seite `frontend/src/pages/SkillMatchingSettings.jsx` (Schwellen, Gewichte, Vorlage, Synonyme, Verwechslungspaare, Status), Route und Navigation in `frontend/src/App.jsx`, `frontend/src/components/Layout.jsx`
- [ ] T037 [US5] Schwelle von `get_top_*_matches` aus den Einstellungen statt fest 0,80 in `graphrag/services/db.py`

**Checkpoint**: Kalibrierbericht liegt vor; Schwellen sind im Tool einstellbar.

---

## Phase 8: User Story 6 – Alte Werte werden ersetzt (P2)

**Ziel**: Keine Mischung alter und neuer Werte in Ansichten und Exporten.

### Tests zuerst

- [ ] T038 [P] [US6] pytest: `/internal/skill-coverage/recompute` nur mit Dienstschlüssel, ohne Credits; `/match/skill-coverage/version` ändert sich mit jeder relevanten Einstellung
- [ ] T039 [P] [US6] Jest: Neuberechnung findet veraltete Paarungen, rechnet paketweise neu, ist wiederaufnehmbar, startet nach Einstellungsänderung; CRM-Rückgabe und N:N-Export enthalten nur aktuelle Version, Vorschau zählt `outdatedPairs`
- [ ] T040 [P] [US6] Vitest: Kennzeichen „alte Berechnung“ in der Historie; Hinweis „wird neu berechnet“ im CRM-Austausch

### Umsetzung

- [ ] T041 [US6] Endpunkte `/internal/skill-coverage/recompute` und `/match/skill-coverage/version` in `graphrag/matching_api.py`
- [ ] T042 [US6] Hintergrund-Neuberechnung `backend/src/skillCoverageRecompute.js` (Start nach Hochfahren und nach Änderungen), Status-Route `/api/skill-matching/recompute`
- [ ] T043 [US6] Versionsfilter und `outdatedPairs` in `backend/src/crm/returnExport.js` und `backend/src/exports/entities/matchings.js`
- [ ] T044 [US6] Veraltete Skill-Embeddings im Hintergrund erneuern (GraphRAG-Start) und `graphrag/batch_tools/reembed_skill_embeddings.py` auf Vorlage + Version umstellen
- [ ] T045 [US6] Kennzeichen und Hinweise im Frontend (`frontend/src/pages/History.jsx`, `MatchingResults.jsx`, `CrmExchange.jsx`)

**Checkpoint**: Nach jeder Änderung gibt es nur noch Werte einer Version.

---

## Phase 9: Abschluss

- [ ] T046 [P] README: Abschnitt „Skill-Abdeckung“ (Regeln, Einstellungen, Kalibrierung, Hinweis zur geänderten Integrations-API)
- [ ] T047 Alle Test-Suites (Backend, GraphRAG, Frontend) und Browser-Prüfung von 3D, M×N, Erklärung, Admin-Seite
- [ ] T048 Einführung gemeinsam mit euch: Kalibrierung auf echten Daten, Modell und Schwellen festlegen, Neuberechnung abwarten, Abnahme SC-001–SC-006 in `specs/001-skill-abdeckung/abnahme.md` festhalten

---

## Abhängigkeiten und Reihenfolge

- **Phase 1 → Phase 2** → alle Stories.
- **US1** (Phase 3) vor **US2** (Phase 5): M×N nutzt den neuen 3D-Weg.
- **US3** (Phase 4) unabhängig von US1, nur nach Phase 2.
- **US4** nach US1; **US5** nach Phase 2 und US3 (Synonym-Vorschläge);
  **US6** nach US2 (Versionen werden gespeichert).
- Innerhalb einer Phase: Tests → Kern/Schnittstelle → Oberfläche.

### Parallel möglich

- T001–T003; T004/T006/T009 in Phase 2.
- US1 und US3 nach Phase 2 parallel.
- Alle mit [P] markierten Tests einer Phase.

## Umsetzungsstrategie

1. **MVP = P1 (Phase 1–5)**: Werte fachlich richtig und überall gleich, mit
   Start-Schwellen 0,72/0,90. Auslieferbar; alte Werte sind gekennzeichnet.
2. **Danach P2**: Erklärung (US4), Kalibrierung mit euren Daten (US5),
   automatische Neuberechnung (US6).
3. **Externe Zulieferungen**: `skills.csv` und Prüfset (für T032/T034/T048),
   Bestätigung der Verwechslungspaare (T015).

## Grobe Größenordnung (zur Besprechung)

| Phase | Umfang |
|---|---|
| 1–2 Grundlagen | mittel |
| 3 US1 | klein |
| 4 US3 | klein |
| 5 US2 | mittel |
| 6 US4 | mittel |
| 7 US5 | mittel |
| 8 US6 | mittel |
| 9 Abschluss | klein |
