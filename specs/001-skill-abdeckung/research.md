# Recherche: Skill-Abdeckung (001)

Stand des Codes: `master` 0c501c0 (2026-11-16). Alle Angaben unten sind am Code
geprüft; Messungen mit eurem Embedding-Modell stehen noch aus (siehe
`datenbedarf.md`).

## 1. Ist-Zustand

### Datenhaltung der Skills

| Ort | Stelle | Bewerber |
|---|---|---|
| PostgreSQL | `jobs.skills`: kommagetrennte Namen, ohne Kategorie und Priorität (`graphrag/services/postgres_store.py` `_job_skills_text`) | `candidates.skills`: kommagetrennte Namen |
| Neo4j | `(Job)-[:REQUIRES_SKILL {priority}]->(Skill)` | `(Candidate)-[:HAS_SKILL]->(Skill)` |

- Ein `Skill`-Knoten existiert **einmal pro Name** (kleingeschrieben) und trägt
  **ein** Embedding für alle Stellen und Bewerber. Beim Upsert wird es
  überschrieben (`graphrag/services/db.py`, `SET s.embedding = coalesce(...)`).
- Prioritäten kennt der Parser nur als `Mandatory` und `NiceToHave`
  (`graphrag/services/llm.py`, Normalisierung der `required_skills`).
- Kategorie: `HardSkill`, `SoftSkill` oder leer (in Neo4j als HardSkill
  behandelt).

### Wie Skills eingebettet werden

Alle Wege rufen `llm_service.create_embedding({"entity": "skill", "name": name})`
auf (`graphrag/main.py` `_build_skill_embeddings`,
`graphrag/plugins/jobs_ch/service.py`, `graphrag/batch_tools/*`).
`create_embedding` bettet `json.dumps(payload, sort_keys=True)` ein, also den
Text `{"entity": "skill", "name": "fahrzeugaufbereitung"}`. Der gleiche
JSON-Rahmen in jedem Text hebt die Ähnlichkeit auch fachfremder Skills an.

Weitere Auffälligkeit: Bei Provider Ollama fällt `create_embedding` auch mit
`allow_fallback=False` auf ein **zufälliges Hash-Embedding** zurück, wenn der
Dienst nicht antwortet. Solche Vektoren landen unbemerkt in Neo4j.

### 3D-Matching (`/match/vectormatch`, Python und Neo4j)

- Python: `score_vector_pair` in `graphrag/matching_api.py`; Neo4j: Cypher in
  `get_vectormatch_neo4j_rows` (`graphrag/services/db.py`). Zwei getrennte
  Umsetzungen derselben Formel.
- Je Stellen-Skill: höchste Kosinus-Ähnlichkeit zu irgendeinem Bewerber-Skill.
- Wert = gewichteter Durchschnitt dieser Ähnlichkeiten (Mandatory ×2), **ohne
  Schwelle**. Ein fachfremder „bester“ Skill mit 0,7 zählt also zu 70 %.
- HardSkill-/SoftSkill-Wert: dasselbe nur innerhalb der Kategorie.
- Die Schwellen 0,65 („fehlt“) und 0,75 („Stärke“) gibt es nur für Texte, nicht
  für den Wert.

### M×N-Matching (`/match/external/matrix`, beide „Engines“)

- Das Backend (`backend/src/routes/matching.js`, `/run-matrix`) schickt die
  **PostgreSQL-Textlisten**. Ist `jobs.skills` leer, nimmt es
  `requirements` oder `description` und zerlegt sie an Kommas und
  Zeilenumbrüchen. So werden ganze Sätze zu „Skills“.
- Alle Stellen-Skills gelten als `Mandatory`, keine Kategorien.
- GraphRAG bekommt keine Embeddings, also bleibt `build_skill_embedding_cache`
  leer, und `score_skill_pair` vergleicht nur Text (`lexical_similarity`):
  - gleich → 1,0;
  - **ein Text ist im anderen enthalten → 0,9**: „r“ steckt in
    „fahrzeugaufbereitung“, „Fahrzeugpflege“, „fahren mit handschaltung“,
    „parkieren auf engem raum“ → 4 × 0,9 = 90 %;
  - sonst Wortüberlappung (Jaccard).
- Die Option „Neo4j“ ruft dieselbe Textlogik auf (`build_vector_matrix`).

### Speicherung der Ergebnisse

M×N **und** 3D schreiben in `matching_pair_results` mit `method = 'vector'`
(`backend/src/routes/matching.js`, `recordMatchingPairsSafely`). Pro Paarung
gilt der zuletzt geschriebene Wert. N:N-Export und CRM-Rückgabe („3D-Matching“)
enthalten also je nach Reihenfolge Text- oder Vektorwerte.

### Weitere Nutzer der Skill-Embeddings

`get_top_job_matches_for_candidate` / `get_top_candidate_matches_for_job`
(`graphrag/services/db.py`) suchen ähnliche Skills über den Vektorindex mit
fester Schwelle 0,80. Sie werden nur von Batch-Werkzeugen genutzt
(`graphrag/batch_tools/match.py`, `import_cvs_jobs_from_pdfs.py`). Nach dem
Neu-Einbetten muss diese Schwelle mit der Kalibrierung übereinstimmen.

### Technische Rahmen

- Vektorindizes in Neo4j: 1536 Dimensionen, Kosinus
  (`graphrag/scripts/init_neo4j.py`); kürzere Vektoren werden mit Nullen
  aufgefüllt (ändert die Kosinus-Ähnlichkeit nicht), längere abgeschnitten
  (`LLMService._normalize_embedding`).
- Vorhandenes Werkzeug zum Neu-Einbetten aller Skills:
  `graphrag/batch_tools/reembed_skill_embeddings.py` (nutzt noch das
  JSON-Format).

## 2. Ursachen des gemeldeten Fehlers

Paarung „Fahrzeugaufbereiter / Reinigung 100%“ × Bewerberin aus der Genomik:

| Ansicht | Wert | Ursache |
|---|---|---|
| M×N | 90 % | Teilstring-Regel 0,9 (z. B. „r“ in jedem Stellen-Skill) |
| 3D | 69 % | Durchschnitt roher Ähnlichkeiten ohne Schwelle; JSON-Rahmen hebt „Beiratsleitung“ auf 0,63–0,75 |
| KI | 5 % | Gesamteinschätzung durch Sprachmodell – fachlich plausibel |

## 3. Prüfung ESCO (2026-11-17, `ec.europa.eu/esco/api`, Sprache de, Typ skill)

| Suchbegriff | Treffer | Bester Treffer |
|---|---|---|
| Python | 2 | Python (Computerprogrammierung) ✔ |
| SQL | 6 | SQL ✔ |
| Java | 18 | Java (Computerprogrammierung) ✔ |
| JavaScript | 5 | JavaScript ✔ |
| Kommunikation | 302 | Kommunikation ✔ |
| Englisch | 12 | Englisch ✔ |
| Statistik | 18 | Statistik ✔ |
| Projektleitung | 1 | Projektleitung ✔ |
| Finanzbuchhaltung | 2 | Finanzbuchhaltung führen ✔ |
| Microsoft Excel | 20 | Microsoft Office nutzen (ungenau) |
| Fahrzeuge reinigen | 378 | äußere Teile des Fahrzeugs reinigen (ungenau) |
| Fahrzeugaufbereitung | 0 | – |
| Kubernetes | 0 | – |
| Teamfähigkeit | 0 | – |
| Bioinformatik | 0 | – |
| Führerschein | 5 | amtliche Dokumente überprüfen ✘ |
| Stakeholder-Management | 261 | IKT-Markt ✘ |
| Spring Boot | 31 | Reiten ✘ |

Ergebnis: Für gängige Begriffe gut, für Praxis- und Tech-Skills lückenhaft oder
falsch. Ein automatisches Mapping beim Einlesen würde falsche Anker erzeugen.

## 4. Embedding-Modelle (Verfügbarkeit geprüft 2026-11-17)

| Modell | Lokal (Ollama) | OpenRouter | Dimensionen | Bemerkung |
|---|---|---|---|---|
| nomic-embed-text (v1.5) | ja | – | 768 | Standard im Docker-Setup; überwiegend englisch trainiert |
| bge-m3 | ja (567M, 1,2 GB) | `baai/bge-m3` | 1024 | mehrsprachig, lokal und als API gleich |
| multilingual-e5-large | – | `intfloat/multilingual-e5-large` | 1024 | mehrsprachig |
| text-embedding-3-small | – | `openai/text-embedding-3-small` | 1536 | mehrsprachig, passt genau zum Index |
| text-embedding-3-large | – | `openai/text-embedding-3-large` | 3072 | würde auf 1536 gekürzt; besser per API-Parameter `dimensions` |

## 5. Empfehlungen zu den Klärungen

- **K1 Modell**: `bge-m3`. Es ist mehrsprachig, läuft lokal ohne Kosten und ist
  bei Bedarf identisch über OpenRouter verfügbar. Bestätigung über die
  Kalibrierung: Gewählt wird das Modell, das „verwandt“ und „unverwandt“ in
  euren Daten am klarsten trennt. Kandidaten: bge-m3,
  text-embedding-3-small, nomic-embed-text (heutiger Stand als Vergleich).
- **K2 Muss-Skills**: (a) keine Sonderregel, aber „x von y Muss-Skills“ immer
  sichtbar. Begründung: Die Schwelle verhindert bereits, dass schwache Treffer
  einen fehlenden Kern-Skill ausgleichen (das Anliegen des „Must-Have-Gate“ in
  der Strategie). Das Sprachmodell markiert in Ausschreibungen sehr vieles als
  Muss; eine harte Deckelung würde gute Bewerber mit 9 von 10 Muss-Skills
  gleich behandeln wie schwache. Nach der Kalibrierung mit dem Prüfset
  nachschärfbar.
- **K3 Hard/Soft**: 80 % HardSkill + 20 % SoftSkill. Hat die Stelle keine
  SoftSkills oder der Bewerber gar keine SoftSkill-Angaben, zählt nur
  HardSkill, damit Lebensläufe ohne Soft-Skill-Liste nicht abgewertet werden.
- **K4 Synonymliste**: eigene Liste. Start: Normalisierung plus eine kleine,
  im Tool pflegbare Synonymliste, vorbefüllt aus Vorschlägen der Kalibrierung
  (Paare mit sehr hoher Ähnlichkeit, die HR bestätigt). ESCO bleibt als
  spätere Erweiterung möglich (z. B. nur als Vorschlagsquelle).
- **K5 Prüfset**: HR beurteilt etwa 20 Paarungen Stelle × Bewerber und etwa
  50 Skill-Paare (Vorlagen in diesem Ordner). Das Prüfset wird Teil der Tests.
- **K6 Engine-Auswahl**: entfernen. Neo4j bleibt Datenquelle; gerechnet wird
  einmal in GraphRAG (Grundsatz II).

## 6. Bewusst nicht in dieser Version (Strategie Stufe 4)

Reranking der Grauzone (z. B. Cross-Encoder), Graph-Distanz,
vollautomatisches ESCO-Mapping. Wieder aufnehmen, wenn das Prüfset nach der
Kalibrierung Fehler genau in der Grauzone zeigt.
