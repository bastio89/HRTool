Für das Matching von n `need-skills` (Job) gegen m `has-skills` (CV) auf Basis von kurzen 1–4-Wort-Begriffen reicht ein einfacher Durchschnitt über alle Vektoren nicht aus, weil dabei spezifische Anforderungen verwässern.

Die effektivste Strategie ist ein **mehrstufiger Ansatz**: gerichtetes Pairwise-Matching (Asymmetrische Aggregation) kombiniert mit einer Taxonomie-Normalisierung (z. B. ESCO) und klaren Schwellenwerten.

### 1. Die Kern-Logik: Asymmetrisches Best-Match (Job \rightarrow CV)

Ein Job definiert die Muss-Kriterien; ein CV darf zusätzliche Skills haben, ohne den Score zu drücken. Daher berechnest du die Ähnlichkeit **gerichtet vom Job zum CV**:

1. **Ähnlichkeitsmatrix bilden (n \times m):** Berechne die Cosine Similarity zwischen jedem `need-skill` i und jedem `has-skill` j.
    
2. **Best-Match pro Anforderung:** Suche für jeden `need-skill` i den einen `has-skill` j im CV mit der höchsten Ähnlichkeit:
    
    $$s_i = \max_{j \in \{1..m\}} \text{sim}(\text{need}_i, \text{has}_j)$$
    
3. **Schwellenwert & Bestrafung (Thresholding):** Kurze Skill-Vektoren haben im Embedding-Raum oft eine Grundähnlichkeit von 0.4 - 0.6, selbst wenn sie fachlich nicht passen (z. B. „Java“ vs. „Python“). Setze einen Cutoff (z. B. \tau = 0.72):
    
    - Liegt s_i < \tau, wird der Skill als **nicht erfüllt** gewertet (s_i = 0 oder stark abgewertet).
        
    - Liegt s_i \ge 0.90, zählt er als exakter/synonymer Treffer (1.0).
        
4. **Gewichtete Aggregation:** Bilde den gewichteten Durchschnitt über alle n `need-skills` (Must-have-Skills z. B. Faktor 2.0, Nice-to-have Faktor 1.0).
    

### 2. Typische Fallstricke bei 1–4-Wort-Embeddings abfangen

Reine Embedding-Vergleiche scheitern bei kurzen Begriffen an drei Stellen, die du vorab entschärfen solltest:

- **Fehlender Kontext bei kurzen Begriffen:** Ein Begriff wie _"Spring"_ oder _"R"_ ist isoliert mehrdeutig. Bette die Skills nicht nackt ein, sondern mit einem minimalen Prefix oder Kontext-Template (z. B. `"IT & Business Skill: Spring Boot"` oder `"Berufliche Kompetenz: Finanzbuchhaltung"`). Das stabilisiert den Vektorraum enorm.
    
- **Taxonomie-Anker (Canonical Mapping):** Statt jedes Mal n \times m frei zu vergleichen, mappe sowohl `need-skills` als auch `has-skills` beim Ingest einmalig auf einen standardisierten Referenz-Katalog (wie **ESCO** oder einen eigenen Master-Skill-Graph).
    
    - _Vorteil:_ Exakte Treffer auf derselben Canonical-ID geben sofort `1.0`. Für unterschiedliche IDs nutzt du entweder die Vektor-Ähnlichkeit der Canonical-Beschreibungen (die länger und präziser sind als 1–4 Worte) oder die Graph-Distanz (z. B. gleicher Elternknoten).
        
- **Antonyme & Versionen/Levels:** _"Java"_ und _"JavaScript"_ oder _"Junior"_ und _"Senior"_ liegen im Vektorraum oft gefährlich nah beieinander. Filtere bekannte False-Friend-Paare über eine kleine Ausnahmeliste oder ein zweistufiges Reranking für grenzwertige Matches (0.70 \le s_i \le 0.85).
    

### 3. Empfohlene Architektur-Pipeline

|Stufe|Methode|Zweck|
|---|---|---|
|**1. Normalisierung**|Exact / Alias Match & Taxonomie-Mapping|Sofortige 1.0-Treffer für Synonyme (z. B. _"K8s"_ = _"Kubernetes"_), Eliminierung von Schreibweisen.|
|**2. Vektor-Scoring**|Asymmetrisches Max-Pooling (n \rightarrow m)|Findet semantisch verwandte Skills (z. B. _"PostgreSQL"_ deckt _"Relationale Datenbanken"_ teilweise ab).|
|**3. Hard-Filter / Penalty**|Cutoff-Threshold (\tau) + Must-Have-Gate|Verhindert, dass viele schwache 0.6-Matches einen fehlenden Kern-Skill kompensieren.|
|**4. Optional: Reranking / Graph**|Cross-Encoder oder Graph-Hop für Grauzone (0.7 - 0.85)|Löst Mehrdeutigkeiten auf und liefert direkt eine Begründung für den Recruiter (_"Match über verwandten Skill X"_).|

### Empfehlung für den Einstieg

Starte mit **Stufe 1 + 2 + 3**: Mappe die Skills beim Speichern auf eine kanonische Liste (inkl. Beschreibungstext für das Embedding, falls vorhanden) und berechne den **gerichteten Best-Match mit einem harten Cutoff bei ~0.75** (abhängig vom verwendeten Embedding-Modell, z. B. `bge-m3` oder `text-embedding-3-large`).