# Datenmodell: Skill-Abdeckung (001)

## PostgreSQL

### Einstellungen (Tabelle `settings`, Schlüssel/Wert)

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `skill_match_threshold_low` | `0.72` | τ_unten: darunter 0 % Abdeckung |
| `skill_match_threshold_high` | `0.90` | τ_oben: ab hier 100 % Abdeckung |
| `skill_match_weight_mandatory` | `2` | Gewicht Muss-Skill |
| `skill_match_weight_nice` | `1` | Gewicht Kann-Skill |
| `skill_match_weight_hard` | `0.8` | Anteil HardSkill am Gesamtwert |
| `skill_match_weight_soft` | `0.2` | Anteil SoftSkill am Gesamtwert |
| `skill_embedding_template` | `Berufliche Kompetenz: {skill}` | Text, der für einen Skill eingebettet wird |

Bestehend und weiter genutzt: `ai_provider` (`openrouter`), `ai_base_url`,
`ai_embedding_model`, `ai_api_key`.

Prüfregeln: 0 ≤ τ_unten < τ_oben ≤ 1; Gewichte ≥ 0; Hard + Soft = 1;
Vorlage enthält `{skill}`.

### Neue Tabelle `skill_synonyms`

| Spalte | Typ | |
|---|---|---|
| `id` | serial | |
| `alias` | text | wie eingegeben, z. B. „K8s“ |
| `alias_key` | text, eindeutig | normalisiert |
| `canonical` | text | z. B. „Kubernetes“ |
| `canonical_key` | text | normalisiert |
| `created_by`, `created_at` | | |

Ein Skill ist kanonisch zu sich selbst, wenn er nicht als Alias vorkommt.
Ketten (A → B → C) werden beim Speichern auf das Ende aufgelöst.

### Neue Tabelle `skill_false_friends`

| Spalte | Typ | |
|---|---|---|
| `id` | serial | |
| `skill_a`, `skill_b` | text | wie eingegeben |
| `pair_key` | text, eindeutig | normalisiert, alphabetisch sortiert („java\|javascript“) |
| `created_by`, `created_at` | | |

Vorbelegung: Java ↔ JavaScript, C ↔ C#, C++ ↔ C# (aus dem Prüfset, nach
Bestätigung durch HR).

### Geänderte Tabellen

- `matching_pair_results.scoring_version TEXT` – Version der Berechnung, mit
  der der Wert entstand. `NULL` = alte Berechnung (vor dieser Spec).
- `matching_results.scoring_version TEXT` – dasselbe für einen Lauf in der
  Historie.

## Neo4j

Knoten `Skill` (einer pro normalisiertem Namen, wie heute) erhält:

| Eigenschaft | Bedeutung |
|---|---|
| `embedding` | Vektor (wie heute) |
| `embedding_version` | Hash aus Anbieter, Modell und Vorlage |
| `embedding_text` | der tatsächlich eingebettete Text (zur Nachvollziehbarkeit) |

Ein Embedding gilt als aktuell, wenn `embedding_version` der aktuellen Version
entspricht. Alle anderen werden vor dem nächsten Vergleich neu erzeugt.

Beziehungen bleiben: `(Job)-[:REQUIRES_SKILL {priority}]->(Skill)`,
`(Candidate)-[:HAS_SKILL]->(Skill)`; Kategorie am `Skill`.

## Versionen

```
embedding_version = sha256(provider | model | template)[:12]
scoring_version   = "sa1-" + sha256(ALGORITHM_VERSION | embedding_version |
                    τ_unten | τ_oben | Gewichte | Hash(Synonyme) |
                    Hash(Verwechslungspaare))[:12]
```

`ALGORITHM_VERSION` wird im Code erhöht, wenn sich die Rechenregeln ändern.
Jede Änderung an Modell, Vorlage, Schwellen, Gewichten, Synonymen oder
Verwechslungspaaren ergibt eine neue `scoring_version` und löst die
Neuberechnung aus.

## Ergebnis einer Paarung (`SkillCoverage`)

```json
{
  "jobId": "uuid", "candidateId": "uuid",
  "score": 12.5,
  "hardSkillScore": 0.156, "softSkillScore": null,
  "mustSkills": { "covered": 0, "total": 4 },
  "scoringVersion": "sa1-3f9c0a1b2c4d",
  "matchedSkills": [
    {
      "jobSkill": "Fahrzeugaufbereitung",
      "jobSkillCategory": "HardSkill",
      "priority": "Mandatory",
      "candidateSkill": "Beiratsleitung",
      "similarity": 0.61,
      "coverage": 0.0,
      "matchType": "missing",
      "withoutEmbedding": false
    }
  ],
  "summary": "Deckt 0 von 4 Muss-Skills ab.",
  "strengths": [], "weaknesses": ["Fahrzeugaufbereitung fehlt", "..."]
}
```

- `score`: 0–100, eine Nachkommastelle. `hardSkillScore`/`softSkillScore`:
  0–1 oder `null`, wenn die Kategorie bei der Stelle nicht vorkommt.
- `matchType`: `exact` | `synonym` | `semantic` (≥ τ_oben) | `partial`
  (zwischen den Schwellen) | `missing` (< τ_unten oder kein Bewerber-Skill).
  Zusätzlich `falseFriendSkipped: true`, wenn der beste Kandidat ein
  Verwechslungspaar war.
- Muss-Skill gilt als abgedeckt bei `coverage ≥ 0.5`.
- In Antworten mit `detail=summary` fehlt `matchedSkills`.

## Rechenregeln (verbindlich für Tests)

Für jeden Stellen-Skill j und alle Bewerber-Skills c:

1. `norm(j) == norm(c)` → coverage 1, `exact`.
2. `canon(j) == canon(c)` → coverage 1, `synonym`.
3. `{norm(j), norm(c)}` ist ein Verwechslungspaar → c wird für j übersprungen.
4. Sonst s = Kosinus(emb(j), emb(c)); bester Wert s* über alle c.
   coverage = 0 für s* < τ_u; 1 für s* ≥ τ_o; (s* − τ_u)/(τ_o − τ_u) dazwischen.
5. Ohne Embedding auf einer Seite: alle Wörter (≥ 3 Zeichen) von j in c → 1,
   sonst 0; `withoutEmbedding: true`.

Zusammenfassung:

```
H = Σ_hard w·coverage / Σ_hard w        (w: Muss 2, Kann 1)
S = Σ_soft w·coverage / Σ_soft w
score = 100 · (0,8·H + 0,2·S)   wenn Stelle Soft-Skills hat UND Bewerber ≥ 1 SoftSkill
      = 100 · H                  sonst, wenn Stelle Hard-Skills hat
      = 100 · S                  wenn Stelle nur Soft-Skills hat
      = 0                        wenn Stelle oder Bewerber keine Skills hat (mit Hinweis)
```

Die Kategorie kommt immer von der Stelle. Ein Bewerber-Skill darf jeden
Stellen-Skill abdecken, egal welche Kategorie er selbst hat.
