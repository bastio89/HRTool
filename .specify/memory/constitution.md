# HRTool – Grundsätze (Constitution)

Diese Grundsätze gelten für jede Spec, jeden Plan und jede Umsetzung im
Spec-driven-Development (Ablauf: Spec → Klärung → Plan → Tasks → Umsetzung).
Sie fassen zusammen, was im Projekt bereits gilt.

## Kernprinzipien

### I. Eine Person, eine Stelle, eine ID
Eine Person und eine Stelle gibt es im Tool genau einmal. Identität läuft über
die UUID, die in PostgreSQL, Neo4j und – bei CRM-Kandidaten – im CRM gleich
ist. Abgleiche zwischen Systemen erfolgen nie über Namen.

### II. Ein Wert, eine Berechnung
Eine abgeleitete Kennzahl (z. B. ein Matchingwert) wird an genau einer Stelle
im Code berechnet. Alle Ansichten, Exporte und Schnittstellen zeigen für
denselben Gegenstand dieselbe Zahl. Zwei Implementierungen derselben Formel
sind nicht zulässig.

### III. Nichts stillschweigend
Fehlende Daten, ausgeschlossene Einträge und Fehler werden mit Grund angezeigt
(Oberfläche, API-Antwort, Export-Vorschau). Ein leeres Ergebnis ohne Erklärung
gilt als Fehler.

### IV. Test-First gegen echte Daten (nicht verhandelbar)
Jedes Akzeptanzszenario der Spec wird zu einem automatisierten Test
(Jest/Supertest im Backend, pytest in GraphRAG, Vitest im Frontend).
Datenbanklogik wird gegen PostgreSQL getestet wie in CI. Der Test entsteht vor
oder mit der Umsetzung und schlägt ohne sie fehl.

### V. Nachvollziehbar für HR (EU AI Act)
Jede automatische Bewertung von Personen ist für Recruiter erklärbar: welche
Angabe zu welchem Ergebnis geführt hat (siehe `AI_ACT_COMPLIANCE.md`).
Bewertungen sind Entscheidungshilfen, keine Entscheidungen.

### VI. Einfach zuerst
Die kleinste Lösung, die die Spec erfüllt. Erweiterungen (zusätzliche
Kataloge, Reranking, weitere Modelle) erst, wenn Messwerte sie begründen.

## Technische Rahmenbedingungen

- Backend: Node.js/Express (`backend/`), GraphRAG: Python/FastAPI (`graphrag/`),
  Frontend: React/Vite (`frontend/`).
- Daten: PostgreSQL (führend für Stammdaten), Neo4j (Skills, Embeddings, Graph).
- Oberfläche auf Deutsch, Texte zusätzlich auf Englisch (`frontend/src/i18n`).
- Personenbezogene Daten verlassen das System nur, wo die Spec es ausdrücklich
  vorsieht (z. B. CRM-Rückgabe). Analysen und Kalibrierungen arbeiten mit
  Skill-Namen, nicht mit Personendaten.

## Ablauf und Qualität

- Specs liegen unter `specs/<NNN-name>/` (`spec.md`, `research.md`, `plan.md`,
  `tasks.md`). Offene Punkte sind mit `[KLÄRUNG NÖTIG]` markiert; ein Plan
  entsteht erst, wenn keine Markierung mehr offen ist.
- Ändert sich das Verhalten, wird zuerst die Spec angepasst, dann der Code.
- Vor jedem Push laufen die Test-Suites der betroffenen Teile.

## Governance

Diese Grundsätze gehen anderen Gewohnheiten vor. Änderungen werden in dieser
Datei mit Datum und Begründung festgehalten.

**Version**: 1.0.0 | **Beschlossen**: 2026-11-17 | **Zuletzt geändert**: 2026-11-17
