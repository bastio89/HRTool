# Umsetzungsplan: Skill-Abdeckung für 3D- und M×N-Matching

**Branch**: `master` | **Datum**: 2026-11-17 | **Spec**: [spec.md](spec.md)
**Weitere Dokumente**: [research.md](research.md) · [data-model.md](data-model.md) ·
[contracts/api.md](contracts/api.md) · [tasks.md](tasks.md)

## Zusammenfassung

Eine einzige Bewertungsfunktion „Skill-Abdeckung“ in GraphRAG ersetzt die drei
heutigen Rechenwege:
- die Python-3D-Variante,
- die Neo4j-Cypher-Variante,
- den Textvergleich des M×N.

Sie arbeitet in drei Stufen, wie in `Dokumente/matching-strategie.md`
beschrieben:

1. **Normalisierung und Synonyme.** Gleiche Schreibweise oder gleicher
   kanonischer Skill ergeben 100 %.
2. **Vektorvergleich.** Je Stellen-Skill zählt der beste Bewerber-Skill. Die
   Embeddings kommen von OpenRouter und werden mit dem Kontext-Präfix
   „Berufliche Kompetenz: {Skill}“ erzeugt.
3. **Schwellen.** Unter τ_unten zählt ein Skill 0 %, ab τ_oben 100 %,
   dazwischen linear. Gewichtung: Muss ×2, Kann ×1. Gesamtwert: 80 % Hard und
   20 % Soft.

Weitere Bausteine:
- **Versionen.** Skill-Embeddings und Ergebnisse tragen eine Version. Ältere
  werden automatisch erneuert bzw. neu berechnet.
- **M×N.** Es läuft künftig über denselben Weg wie 3D, also mit den Daten aus
  Neo4j, angesprochen über die UUID.
- **Kalibrierung.** Ein Werkzeug misst auf euren Skills und dem HR-Prüfset das
  beste Modell und die passenden Schwellen.

## Technischer Kontext

| | |
|---|---|
| **Sprachen** | Python 3.12 (GraphRAG), Node.js 22 (Backend), React 19 (Frontend) |
| **Abhängigkeiten** | FastAPI, neo4j-Treiber, httpx, **numpy** (neu als direkte Abhängigkeit; ist über GLiNER/torch bereits installiert), Express, Vite |
| **Speicher** | PostgreSQL (Einstellungen, Synonyme, Ergebnisse), Neo4j (Skills mit Embeddings) |
| **Embeddings** | OpenRouter `/embeddings`; Favorit `baai/bge-m3` (1024 Dim.), Alternative `openai/text-embedding-3-small` (1536 Dim.); Neo4j-Index 1536 Dim., kürzere Vektoren werden mit Nullen aufgefüllt |
| **Tests** | pytest (GraphRAG, gegen PostgreSQL), Jest + Supertest (Backend, gegen PostgreSQL), Vitest (Frontend) |
| **Ziel** | Docker Compose (Linux), wie heute |
| **Leistung** | M×N 50 Stellen × 500 Bewerber < 30 s (SC-005); Einzel-3D < 2 s |
| **Randbedingungen** | Keine Personendaten an OpenRouter, nur Skill-Namen; Neuberechnung ohne Credits; Tests ohne OpenRouter lauffähig |
| **Umfang** | einige tausend Skills; bis ca. 10 000 Bewerber (CRM-Grenze) |

## Grundsatz-Check (Constitution)

| Grundsatz | Erfüllt durch |
|---|---|
| I. Eine ID | Paarungen werden über die UUID aus Neo4j geladen; kein Namensabgleich |
| II. Ein Wert, eine Berechnung | eine Funktion `score_skill_coverage` für 3D, M×N, Erklärung und Neuberechnung; Cypher-Variante und Textvergleich entfallen |
| III. Nichts stillschweigend | Aufschlüsselung je Skill; „ohne Embedding“, „Stelle ohne Skills“ und „wird neu berechnet“ sind sichtbar; kein zufälliges Ersatz-Embedding mehr |
| IV. Test-First | jedes Akzeptanzszenario wird zuerst als Test geschrieben (siehe `tasks.md`); Prüfset mit festgehaltenen Embeddings läuft offline in CI |
| V. Nachvollziehbar | Art des Treffers, Ähnlichkeit, Abdeckung, Muss/Kann je Skill; „x von y Muss-Skills“ |
| VI. Einfach zuerst | keine ESCO-Anbindung, kein Reranking; Kalibrierung als Kommandozeilen-Werkzeug |

Keine Abweichungen; die Abschnitte zu Komplexität unten sind Begründungen,
keine Ausnahmen.

## Architektur

```
Backend (Node)                            GraphRAG (Python)
──────────────                            ─────────────────
/matching/vectormatch          ┐
/matching/vectormatch-selected ├──► POST /match/vectormatch ─┐
/matching/run-matrix (M×N)     ┘    (Benutzer, mit Credits)  │
                                                            ▼
/matching/skill-coverage/explain ──► POST /match/skill-coverage/explain
                                                            │
Neuberechnung (Hintergrund) ──────► POST /internal/skill-coverage/recompute
                                    (Dienstschlüssel, ohne Credits)
                                                            │
                                    ┌───────────────────────┘
                                    ▼
                   skill_embeddings.ensure_current(skills)  ── OpenRouter
                   (fehlende/veraltete Embeddings erzeugen,
                    in Neo4j mit Version speichern)
                                    ▼
                   skill_coverage.score(job, candidate, cfg)  (reine Funktion)
                                    ▼
                   Ergebnis + scoringVersion ──► Backend speichert in
                                                 matching_pair_results
```

### Bausteine in GraphRAG

1. **`services/skill_coverage.py`** (neu, ohne Datenbank- oder Netzwerkzugriff):
   - **Normalisierung:** Kleinschreibung, Unicode-NFKC; ä/ö/ü/ß → ae/oe/ue/ss;
     `-_/` → Leerzeichen; Leerraum zusammenfassen.
   - **Ähnlichkeit:** Für eine Paarung wird die Kosinus-Matrix mit numpy
     berechnet (Stellen-Skills × Bewerber-Skills).
   - **Abdeckung je Stellen-Skill** in dieser Reihenfolge:
     1. exakt (normalisierter Name gleich) → 1;
     2. Synonym (gleicher kanonischer Skill) → 1;
     3. Verwechslungspaar → Bewerber-Skill wird übersprungen;
     4. Vektor: Ähnlichkeit s nach Schwellen (unter τ_unten 0, ab τ_oben 1,
        dazwischen linear);
     5. ohne Embedding: alle Wörter (ab 3 Zeichen) des Stellen-Skills kommen im
        Bewerber-Skill vor → 1, sonst 0; der Skill wird markiert.
   - **Zusammenfassung:** Hard- und Soft-Wert sind gewichtete Mittel (Muss/Kann).
     Gesamt = 0,8 · Hard + 0,2 · Soft nach FR-009. Dazu kommen die
     Muss-Abdeckung (abgedeckt heisst Abdeckung ≥ 50 %) und die Aufschlüsselung.
   - **Für grosse Matrizen** wird die Ähnlichkeit je eindeutigem Skill-Paar nur
     einmal berechnet (`score_matrix`).
2. **`services/skill_embeddings.py`** (neu):
   - **Text:** `skill_embedding_text(name, template)` (Standard:
     „Berufliche Kompetenz: {Skill}“).
   - **Version:** `embedding_version` ist ein Hash aus Anbieter, Modell und
     Vorlage.
   - **`ensure_current(names)`:** liest die Skill-Knoten. Fehlende oder
     veraltete Embeddings werden gesammelt (mehrere Texte je Anfrage) über
     OpenRouter erzeugt und mit Version und Textform in Neo4j geschrieben.
   - **Kein zufälliges Ersatz-Embedding:** Ein Fehler wird gemeldet (FR-012,
     Grundsatz III).
3. **`services/llm.py`:** `create_embeddings(texts)` für mehrere Texte je
   Anfrage. Bei `text-embedding-3-*` wird `dimensions=1536` mitgegeben. Das
   bestehende `create_embedding` (Profile) bleibt unverändert.
4. **`services/skill_matching_config.py`** (neu):
   - **Inhalt:** Schwellen, Gewichte und Vorlage aus der Tabelle `settings`,
     Synonyme und Verwechslungspaare aus eigenen Tabellen.
   - **Cache:** 60 s, nach Änderungen wird er geleert.
   - **`scoring_version`:** ein Hash aus Algorithmus-Version, Einstellungen,
     Synonymen, Verwechslungspaaren und `embedding_version`.
5. **`matching_api.py`:**
   - **`/match/vectormatch`:** rechnet nur noch über `skill_coverage`;
     `engine` wird angenommen und ignoriert.
   - **`detail=summary|full`:** Für grosse Matrizen kommt die Antwort ohne
     Aufschlüsselung je Skill.
   - **Neu:** `/match/skill-coverage/explain`, `/match/skill-coverage/version`
     und `/internal/skill-coverage/recompute`.
   - **`/match/external/*`** (Integrations-API) rechnet ebenfalls über
     `skill_coverage`. Embeddings werden dort ohne Speicherung in Neo4j erzeugt.
6. **`services/db.py`:**
   - Die Skill-Abfragen liefern zusätzlich `embedding_version` und `category`.
   - `get_vectormatch_neo4j_rows` (Cypher-Bewertung) entfällt.
   - Die Schwelle von 0,80 in `get_top_*_matches` kommt künftig aus den
     Einstellungen (τ_oben).
7. **`batch_tools/calibrate_skill_similarity.py`** (neu):
   - **Eingaben:** Skill-Paare (CSV), optional `skills.csv` und
     `pruefset-paarungen.csv`, eine Liste von OpenRouter-Modellen.
   - **Ausgaben:**
     - Bericht (Markdown) je Modell: Verteilungen, Trennschärfe,
       Schwellenvorschlag, Fehlzuordnungen, Synonym-Vorschläge,
       Prüfset-Trefferquote (SC-002);
     - eine JSON-Datei mit den Embeddings der Prüfset-Skills für Offline-Tests.
8. **`batch_tools/reembed_skill_embeddings.py`:** auf das neue Text- und
   Versionsformat umgestellt; für die manuelle Neuberechnung aller Skills.

### Bausteine im Backend

1. **`routes/matching.js`:**
   - `/run-matrix` ruft nach dem Neo4j-Abgleich (`ensureGraphNodes`)
     `/match/vectormatch` mit allen UUIDs auf, mit `detail=summary`.
   - Alle 3D-Routen speichern `scoringVersion` mit.
   - Neu: `/skill-coverage/explain` (Proxy für eine Paarung).
2. **`matchingPairs.js`:** Spalte `scoring_version`; `recordMatchingPairs`
   übernimmt die Version aus der Zeile.
3. **`skillCoverageRecompute.js`** (neu): Hintergrund-Aufgabe.
   - **Start:** nach dem Hochfahren und nach jeder Änderung der Einstellungen.
   - **Ablauf:** holt die aktuelle Version von GraphRAG und sucht alle
     `vector`-Paarungen mit anderer Version. Sie werden je Stelle in Paketen von
     200 Bewerbern über `/internal/skill-coverage/recompute` neu berechnet.
   - **Betrieb:** nur ein Lauf gleichzeitig; Fortschritt abrufbar; Fehler
     werden protokolliert und später erneut versucht.
4. **`routes/skill-matching.js`** (neu, nur Admin): Einstellungen lesen und
   speichern, Synonyme und Verwechslungspaare verwalten (CRUD), Status der
   Neuberechnung.
5. **`database.js`:** Tabellen `skill_synonyms`, `skill_false_friends`; Spalte
   `scoring_version` in `matching_pair_results` und `matching_results`;
   Standardwerte der Einstellungen.
6. **`crm/returnExport.js`, `exports/entities/matchings.js`:** Für 3D nur
   Ergebnisse der aktuellen Version. Die Vorschau zählt den Rest als „wird neu
   berechnet“.

### Bausteine im Frontend

1. **Engine-Auswahl entfernen:** `JobToCandidates.jsx`, `CandidateToJobs.jsx`,
   `MatrixMatching.jsx`, `SelectedMatchingResults.jsx`, `MatchingResults.jsx`.
2. **`components/SkillCoverageBreakdown.jsx`** (neu):
   - eine Zeile je Stellen-Skill mit Treffer-Art, Bewerber-Skill und Abdeckung,
     Muss/Kann sowie dem Hinweis „ohne Embedding“;
   - Kopfzeile „x von y Muss-Skills“;
   - in der M×N-Matrix wird die Aufschlüsselung per Klick nachgeladen.
3. **Historie:** Kennzeichen „alte Berechnung“ bei 3D- und M×N-Läufen mit
   anderer Version.
4. **`pages/SkillMatchingSettings.jsx`** (neu, `/admin/skill-matching`):
   - Schwellen, Gewichte und Vorlage;
   - Synonyme und Verwechslungspaare;
   - Status der Neuberechnung.
5. **CRM-Austausch:** Hinweis „x Paarungen werden gerade neu berechnet“.

## Projektstruktur

### Dokumentation

```text
specs/001-skill-abdeckung/
├── spec.md            # Was und warum (geklärt)
├── research.md        # Ist-Analyse, ESCO, Modelle, Entscheidungen
├── plan.md            # dieses Dokument
├── data-model.md      # Tabellen, Neo4j-Eigenschaften, Ergebnisformat, Versionen
├── contracts/api.md   # geänderte und neue Schnittstellen
├── tasks.md           # Aufgaben je User Story, Test-First
├── datenbedarf.md     # was von der Installation und von HR kommt
├── pruefset-skillpaare.csv
└── pruefset-paarungen.csv
```

### Quellcode

```text
graphrag/
├── services/skill_coverage.py            (neu)
├── services/skill_embeddings.py          (neu)
├── services/skill_matching_config.py     (neu)
├── services/llm.py                       (create_embeddings)
├── services/db.py                        (Skill-Abfragen, Cypher-Bewertung entfernt)
├── services/postgres_store.py            (Einstellungen, Synonyme, Verwechslungspaare lesen)
├── matching_api.py                       (vectormatch, explain, version, recompute, external)
├── batch_tools/calibrate_skill_similarity.py (neu)
├── batch_tools/reembed_skill_embeddings.py
├── requirements.txt                      (numpy)
└── tests/
    ├── test_skill_coverage.py            (Akzeptanzszenarien US1–US4, rein)
    ├── test_skill_embeddings.py          (Version, Vorlage, kein Ersatz-Embedding)
    ├── test_skill_coverage_api.py        (Endpunkte, gegen PostgreSQL)
    ├── test_calibration.py
    ├── test_pruefset.py                  (SC-002, mit festgehaltenen Embeddings)
    └── fixtures/pruefset_embeddings.json (aus der Kalibrierung)
backend/src/
├── routes/matching.js
├── routes/skill-matching.js              (neu)
├── skillCoverageRecompute.js             (neu)
├── matchingPairs.js
├── database.js
├── crm/returnExport.js
├── exports/entities/matchings.js
└── __tests__/skill-coverage.test.js      (neu)
frontend/src/
├── components/SkillCoverageBreakdown.jsx (neu)
├── pages/SkillMatchingSettings.jsx       (neu)
├── pages/JobToCandidates.jsx, CandidateToJobs.jsx, MatrixMatching.jsx,
│   SelectedMatchingResults.jsx, MatchingResults.jsx, CrmExchange.jsx
├── api.js, App.jsx, components/Layout.jsx, i18n/de.js, i18n/en.js
└── *.test.jsx
```

## Einführung (Rollout)

1. **Code ausliefern.** Ab dann rechnet jede neue 3D- und M×N-Berechnung mit
   den Startwerten (τ 0,72 / 0,90, Modell wie eingestellt). Alte Werte sind
   als „alte Berechnung“ gekennzeichnet; die Neuberechnung startet
   automatisch.
2. **Kalibrieren** im GraphRAG-Container mit `skills.csv` und dem HR-Prüfset,
   drei Modelle im Vergleich. Den Bericht prüfen wir gemeinsam.
3. **Festlegen:** Modell unter Administration → KI-Modell, Schwellen unter
   Administration → Skill-Matching, Synonym-Vorschläge übernehmen. Danach
   werden alle Skills automatisch neu eingebettet und alle Paarungen neu
   berechnet.
4. **Abnahme:**
   - Prüfset-Tests grün (SC-002 bis SC-004).
   - Stichprobe 3D = M×N (SC-001).
   - Laufzeit messen (SC-005).
   - CRM-Rückgabe ohne alte Version (SC-006).

**Kosten über OpenRouter:**
- Neu-Einbetten: ein Aufruf je Skill mit wenigen Wörtern, bei einigen tausend
  Skills geschätzt im Cent-Bereich.
- Kalibrierung: die drei Modelle auf Prüfset und Skill-Bestand, ebenfalls
  geschätzt im Cent-Bereich.
- An OpenRouter gehen nur Skill-Namen.

## Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Das Prüfset ist klein, die Schwellen sind unsicher | Schwellen einstellbar; Prüfset wächst mit jedem gemeldeten Fehlfall; Regressionstest |
| OpenRouter langsam oder Rate-Limit beim Neu-Einbetten | mehrere Texte je Anfrage, Wiederholung mit Wartezeit, Neuberechnung im Hintergrund wiederaufnehmbar |
| `baai/bge-m3` bei OpenRouter zeitweise nicht verfügbar | Ersatz `openai/text-embedding-3-small` (in der Kalibrierung mitgemessen); Modellwechsel bettet automatisch neu ein |
| Mischung alter und neuer Embeddings | Versionsprüfung vor jedem Vergleich (FR-013) |
| Große M×N-Antworten | `detail=summary`, Aufschlüsselung auf Klick |
| Externe Integrations-API ändert Werte | gewollt (gleiche Bewertung); in der README vermerkt |

## Begründung für zusätzliche Bausteine

| Baustein | Warum nötig | Einfachere Alternative verworfen, weil |
|---|---|---|
| Hintergrund-Neuberechnung | FR-014/SC-006: keine Mischung alter und neuer Werte | „Beim nächsten Matching neu“ ließe alte Werte in der CRM-Rückgabe |
| Admin-Seite Skill-Matching | FR-005/007/011: Schwellen, Synonyme und Verwechslungspaare pflegbar | Pflege per SQL ist für HR nicht zumutbar |
| Festgehaltene Prüfset-Embeddings | Grundsatz IV: Tests ohne OpenRouter, in CI | Live-Aufrufe wären teuer, langsam und nicht reproduzierbar |
