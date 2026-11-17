# Datenbedarf: Skill-Abdeckung (001)

Was ich aus der Cloud-Umgebung nicht selbst holen kann, weil es nur bei euch
liegt. Alle Abfragen lesen nur; sie liefern Einstellungen und Skill-Namen,
keine Personendaten.

## 1. Eingestelltes Embedding-Modell (für K1)

Im Ordner der Installation:

```bash
docker compose exec postgres psql -U hrtool -d hrtool -c "SELECT key, value FROM settings WHERE key IN ('ai_provider', 'ai_base_url', 'ai_embedding_model');"
```

Den API-Schlüssel fragt die Abfrage bewusst nicht ab.

## 2. Skill-Bestand aus Neo4j (für Kalibrierung und Synonymliste)

Liefert jeden Skill mit Kategorie und Anzahl der Stellen/Bewerber, die ihn
nutzen, als `skills.csv`:

```bash
docker compose exec -T neo4j sh -c 'cypher-shell -u neo4j -p "${NEO4J_AUTH#*/}" --format plain "MATCH (s:Skill) OPTIONAL MATCH (j:Job)-[:REQUIRES_SKILL|NEED_SKILL]->(s) WITH s, count(DISTINCT j) AS stellen OPTIONAL MATCH (c:Candidate)-[:HAS_SKILL]->(s) RETURN s.name AS skill, coalesce(s.category, \"\") AS kategorie, stellen, count(DISTINCT c) AS bewerber ORDER BY stellen + bewerber DESC"' > skills.csv
```

Die Datei bitte hier im Chat hochladen. Sie enthält nur Skill-Namen und Zahlen.

## 3. Prüfset von HR (für K5, wird zu Tests)

Zwei Vorlagen in diesem Ordner, beide mit Semikolon, in Excel bearbeitbar:

- **`pruefset-skillpaare.csv`** – etwa 50 Skill-Paare mit Erwartung
  `gleich`, `verwandt`, `unverwandt` oder `verwechslung`. Ich habe 39
  Vorschläge eingetragen; bitte prüfen, korrigieren und um eigene Fälle aus
  eurem Alltag ergänzen (gerade Branchen, die ich nicht kenne).
- **`pruefset-paarungen.csv`** – etwa 20 Fälle Stelle × Bewerber, nur als
  Skill-Listen (ohne Namen), mit Erwartung `passt`, `teilweise` oder
  `passt nicht`. Fall 1 ist der gemeldete Fehler, Fall 2 und 3 zeigen das
  Format. Am besten echte Fälle nehmen, bei denen HR das Ergebnis kennt –
  Skill-Listen abschreiben, keine Namen.

Bedeutung der Erwartungen:

| Erwartung | Skill-Paare | Paarungen |
|---|---|---|
| gleich | dasselbe, nur anders geschrieben oder gängiges Synonym → 100 % | – |
| verwandt | deckt den Skill fachlich ganz oder teilweise ab | – |
| unverwandt | hat fachlich nichts miteinander zu tun → 0 % | – |
| verwechslung | klingt ähnlich, ist aber etwas anderes → 0 % | – |
| passt | – | Skill-Abdeckung soll ≥ 70 % sein |
| teilweise | – | 30–69 % |
| passt nicht | – | < 30 % |

## 4. Entscheidungen

Die Klärungen K1–K6 in `spec.md`; meine Empfehlungen stehen in
`research.md`, Abschnitt 5.

## Danach

1. Spec ohne offene `[KLÄRUNG NÖTIG]`-Markierung → `plan.md` (technischer
   Entwurf) und `tasks.md` (Aufgaben mit Tests je Akzeptanzszenario).
2. Umsetzung Test-First; Kalibrierung mit `skills.csv` und dem Prüfset;
   Schwellen festlegen; Neuberechnung.
