# Feature-Spec: Skill-Abdeckung für 3D- und M×N-Matching

**Branch**: `master`
**Erstellt**: 2026-11-17
**Status**: Entwurf – wartet auf Klärung (siehe Abschnitt „Klärungen“)
**Grundlagen**: Fehlerbericht „gleiche Paarung: M×N 90 %, 3D 69 %, KI 5 %“;
`Dokumente/matching-strategie.md`; Analyse in `research.md`

## Ziel

Der Wert des 3D-Matchings heißt künftig **Skill-Abdeckung**: Wie viel von dem,
was eine Stelle an Skills verlangt, bringt ein Bewerber mit? Er ist
nachvollziehbar, fachfremde Skills zählen nicht, und dieselbe Paarung hat in
jeder Ansicht und jedem Export denselben Wert. Das M×N-Matching ist dieselbe
Bewertung für viele Paarungen auf einmal.

Nicht Teil dieser Spec: das KI-Matching (Gesamteinschätzung durch ein
Sprachmodell). Seine Werte dürfen von der Skill-Abdeckung abweichen.

## User Stories & Tests *(Pflicht)*

### User Story 1 – Fachfremde Skills zählen nicht (Priorität: P1)

Ein Recruiter matcht eine Stelle gegen Bewerber aus einem anderen Fachgebiet.
Heute ergibt das hohe Werte, weil jeder geforderte Skill den „am wenigsten
falschen“ Skill des Bewerbers als Treffer bekommt. Künftig gilt ein Skill nur
als abgedeckt, wenn der Bewerber einen fachlich passenden Skill hat.

**Warum P1**: Ohne das sind die Werte für Recruiter und für die CRM-Rückgabe
irreführend – das ist der gemeldete Fehler.

**Unabhängig testbar**: Stelle und Bewerber mit bekannten Skill-Listen anlegen,
3D-Matching ausführen, Wert und Aufschlüsselung prüfen.

**Akzeptanzszenarien**:

1. **Gegeben** die Stelle „Fahrzeugaufbereiter / Reinigung“ mit den Skills
   Fahrzeugaufbereitung, Fahrzeugpflege, Fahren mit Handschaltung, Parkieren
   auf engem Raum **und** eine Bewerberin mit Skills aus Genomik/Forschung
   (z. B. Beiratsleitung, R, Python, Statistik), **wenn** die Skill-Abdeckung
   berechnet wird, **dann** liegt sie bei höchstens 15 % und jeder der vier
   Stellen-Skills ist als „nicht abgedeckt“ ausgewiesen.
2. **Gegeben** ein Bewerber-Skill aus einem einzelnen Buchstaben oder einer
   kurzen Abkürzung (z. B. „R“, „C“, „Go“), **wenn** er mit längeren
   Stellen-Skills verglichen wird, **dann** zählt er nicht als Treffer, nur weil
   die Buchstaben im anderen Begriff vorkommen.
3. **Gegeben** ein bekanntes Verwechslungspaar (z. B. Java ↔ JavaScript),
   **wenn** es verglichen wird, **dann** gilt es nicht als Treffer.

---

### User Story 2 – Gleicher Wert überall (Priorität: P1)

Ein Recruiter sieht für dieselbe Paarung aus Bewerber und Stelle überall
dieselbe Skill-Abdeckung: im 3D-Matching (Stelle → Bewerber, Bewerber →
Stellen, ausgewählte Paarungen), in der M×N-Matrix, im N:N-Export und in der
CRM-Rückgabe.

**Warum P1**: Heute zeigt M×N einen anderen Wert als 3D, und beide schreiben in
denselben Speicher für Exporte – der zuletzt gelaufene gewinnt. Damit enthält
die CRM-Rückgabe zufällig mal den einen, mal den anderen Wert.

**Unabhängig testbar**: Dieselbe Paarung über 3D und über M×N berechnen und die
Werte samt Aufschlüsselung vergleichen.

**Akzeptanzszenarien**:

1. **Gegeben** eine Paarung, **wenn** sie per 3D und per M×N berechnet wird,
   **dann** sind Gesamtwert, HardSkill-, SoftSkill-Wert und Aufschlüsselung je
   Skill identisch.
2. **Gegeben** M×N lief nach einem 3D-Matching für dieselbe Paarung, **wenn**
   die CRM-Rückgabe erzeugt wird, **dann** enthält sie denselben Wert wie
   vorher.
3. **Gegeben** eine Stelle ohne gespeicherte Skills, **wenn** M×N läuft,
   **dann** werden keine Sätze aus Beschreibung oder Anforderungen als Skills
   verwendet; die Paarung wird als „Stelle ohne Skills“ ausgewiesen.

---

### User Story 3 – Gleiche und gleichbedeutende Skills zählen voll (Priorität: P1)

Ein Bewerber, der genau die geforderten Skills hat – auch in anderer
Schreibweise oder unter einem gängigen Synonym –, erreicht die volle
Abdeckung.

**Warum P1**: Ohne das würden die strengeren Regeln aus Story 1 passende
Bewerber zu Unrecht abwerten.

**Unabhängig testbar**: Bewerber mit identischen, anders geschriebenen und
synonymen Skills anlegen und Abdeckung prüfen.

**Akzeptanzszenarien**:

1. **Gegeben** Stelle und Bewerber mit identischer Skill-Liste, **dann** ist die
   Abdeckung 100 %.
2. **Gegeben** Schreibvarianten (Groß-/Kleinschreibung, Leerzeichen,
   Bindestrich: „Stakeholder-Management“ / „stakeholder management“), **dann**
   zählt der Skill als exakter Treffer.
3. **Gegeben** ein Eintrag der Synonymliste (z. B. „K8s“ = „Kubernetes“,
   „MS Excel“ = „Excel“), **dann** zählt der Skill als exakter Treffer.
4. **Gegeben** fachlich eng verwandte Skills oberhalb der oberen Schwelle
   (z. B. „Projektleitung“ ↔ „Projektmanagement“), **dann** zählen sie voll;
   zwischen den Schwellen teilweise.

---

### User Story 4 – Erklärung für Recruiter (Priorität: P2)

Ein Recruiter sieht zu jedem Wert, welcher Bewerber-Skill welchen
Stellen-Skill abdeckt, wie (exakt / Synonym / verwandt / teilweise / fehlt),
ob es ein Muss-Skill ist und wie viele Muss-Skills abgedeckt sind.

**Warum P2**: Erklärbarkeit ist Pflicht (Grundsatz V), baut aber auf Story 1–3
auf.

**Akzeptanzszenarien**:

1. **Gegeben** ein Ergebnis, **dann** steht je Stellen-Skill: abdeckender
   Bewerber-Skill, Art des Treffers, Abdeckung in %, Muss/Kann.
2. **Gegeben** ein Ergebnis, **dann** steht daneben „x von y Muss-Skills
   abgedeckt“.
3. **Gegeben** ein Skill wurde ohne Embedding bewertet (Dienst nicht
   erreichbar), **dann** ist das am Skill sichtbar.

---

### User Story 5 – Schwellen aus eigenen Daten bestimmen (Priorität: P2)

Ein Admin lässt auf den echten Skills des Tools messen, ab welcher Ähnlichkeit
Skills verwandt bzw. gleichbedeutend sind, prüft den Vorschlag und legt die
Schwellen fest.

**Warum P2**: Die Schwellen hängen vom Embedding-Modell ab; Startwerte aus der
Strategie (0,72 / 0,90) sind nur Annahmen.

**Akzeptanzszenarien**:

1. **Gegeben** die Skill-Daten und eine Liste beurteilter Skill-Paare, **wenn**
   die Kalibrierung läuft, **dann** liefert sie die Verteilung der
   Ähnlichkeiten für „gleich“, „verwandt“ und „unverwandt“, einen Vorschlag für
   beide Schwellen und die auffälligsten Fehlzuordnungen.
2. **Gegeben** neue Schwellen werden gespeichert, **dann** gelten sie für alle
   folgenden Berechnungen und die gespeicherten Werte werden neu berechnet
   (Story 6).

---

### User Story 6 – Alte Werte werden ersetzt (Priorität: P2)

Nach der Umstellung (oder nach einer Änderung von Schwellen, Modell oder
Gewichten) gibt es keine Mischung aus alten und neuen Werten.

**Akzeptanzszenarien**:

1. **Gegeben** gespeicherte Ergebnisse einer älteren Berechnung, **wenn** die
   Berechnung umgestellt wird, **dann** werden alle gespeicherten 3D-/M×N-Werte
   automatisch neu berechnet, ohne Credits zu verbrauchen.
2. **Gegeben** die Neuberechnung ist noch nicht fertig, **dann** enthalten
   CRM-Rückgabe und N:N-Export nur Werte der aktuellen Berechnung und weisen
   den Rest als „wird neu berechnet“ aus.
3. **Gegeben** alte Läufe in der Historie, **dann** bleiben sie lesbar und sind
   als „alte Berechnung“ gekennzeichnet.
4. **Gegeben** das Embedding-Modell oder die Einbettungsvorlage ändert sich,
   **dann** werden nie Skills mit altem und neuem Embedding miteinander
   verglichen.

### Randfälle

- Stelle ohne Skills oder Bewerber ohne Skills → Wert 0 mit Hinweis, kein
  Raten aus Freitext.
- Embedding-Dienst nicht erreichbar → Vergleich nur über Normalisierung,
  Synonymliste und ganze Wörter (ab 3 Zeichen); betroffene Skills markiert.
- Gleicher Skill-Name mit unterschiedlicher Kategorie bei Stelle und Bewerber →
  zählt als Treffer; die Kategorie der Stelle bestimmt, wohin er zählt.
- Bewerber hat viel mehr Skills als gefordert → zusätzliche Skills senken den
  Wert nicht.
- Sehr große Matrix (alle Stellen × alle Bewerber) → muss in vertretbarer Zeit
  fertig werden (SC-005).
- Stelle hat nur SoftSkills oder nur HardSkills → Gewichtung nur über die
  vorhandene Kategorie.

## Anforderungen *(Pflicht)*

### Funktionale Anforderungen

- **FR-001**: Die Skill-Abdeckung MUSS an genau einer Stelle berechnet und von
  3D-Matching (alle Varianten) und M×N verwendet werden.
- **FR-002**: Grundlage MÜSSEN die gespeicherten strukturierten Skills von
  Stelle (Name, Kategorie, Priorität) und Bewerber (Name, Kategorie) sein –
  keine aus Freitext abgeleiteten Listen.
- **FR-003**: Die Bewertung MUSS gerichtet von der Stelle zum Bewerber erfolgen:
  je Stellen-Skill zählt der am besten passende Bewerber-Skill; zusätzliche
  Bewerber-Skills dürfen den Wert nicht senken.
- **FR-004**: Vor dem Vektorvergleich MÜSSEN Skill-Namen normalisiert werden
  (Groß-/Kleinschreibung, Leerzeichen, Bindestriche/Unterstriche); gleiche
  normalisierte Namen ergeben 100 %.
- **FR-005**: Das System MUSS eine pflegbare Synonymliste (Skill → kanonischer
  Skill) unterstützen; gleiche kanonische Skills ergeben 100 %.
  [KLÄRUNG NÖTIG: eigene Liste oder ESCO, siehe K4]
- **FR-006**: Skills MÜSSEN als kurzer Text mit Kontext-Präfix eingebettet
  werden (Vorlage einstellbar, Vorschlag „Berufliche Kompetenz: {Skill}“), nicht
  als JSON.
- **FR-007**: Die Abdeckung eines Stellen-Skills MUSS aus der Ähnlichkeit s so
  bestimmt werden: s < τ_unten → 0 %; s ≥ τ_oben → 100 %; dazwischen linear.
  Startwerte τ_unten = 0,72 und τ_oben = 0,90; beide einstellbar.
- **FR-008**: Muss-Skills MÜSSEN doppelt, Kann-Skills einfach gewichtet werden.
- **FR-009**: Der Gesamtwert MUSS aus HardSkill- und SoftSkill-Abdeckung
  gebildet werden. [KLÄRUNG NÖTIG: Gewichtung, siehe K3]
- **FR-010**: [KLÄRUNG NÖTIG: Umgang mit nicht abgedeckten Muss-Skills, siehe K2]
- **FR-011**: Das System MUSS eine Liste bekannter Verwechslungspaare
  unterstützen, die nie als Treffer gelten.
- **FR-012**: Fehlt für einen Skill ein Embedding, MUSS ein Vergleich über ganze
  Wörter (ab 3 Zeichen) erfolgen, nie über Teilzeichenketten; der Skill wird
  markiert.
- **FR-013**: Jedes Skill-Embedding MUSS die Version tragen, mit der es entstand
  (Modell + Vorlage). Verglichen werden nur Embeddings derselben Version;
  veraltete werden vor der Berechnung automatisch neu erzeugt.
- **FR-014**: Jedes gespeicherte Ergebnis MUSS die Version der Berechnung tragen
  (Regeln, Schwellen, Gewichte, Embedding-Version). Ändert sich die Version,
  MÜSSEN gespeicherte 3D-/M×N-Ergebnisse automatisch und ohne Credits neu
  berechnet werden.
- **FR-015**: CRM-Rückgabe und N:N-Export DÜRFEN nur Ergebnisse der aktuellen
  Version enthalten; der Rest wird mit Grund ausgewiesen.
- **FR-016**: Jedes Ergebnis MUSS die Aufschlüsselung je Stellen-Skill
  enthalten (Bewerber-Skill, Art des Treffers, Ähnlichkeit, Abdeckung,
  Muss/Kann) sowie „x von y Muss-Skills abgedeckt“.
- **FR-017**: Ein Kalibrierwerkzeug MUSS aus den echten Skills und einer Liste
  beurteilter Skill-Paare Verteilungen, Schwellenvorschläge und
  Fehlzuordnungen ausgeben, ohne Personendaten zu verwenden.
- **FR-018**: Die Auswahl „Engine Python / Neo4j“ entfällt in der Oberfläche,
  da beide dasselbe Ergebnis liefern müssen. [KLÄRUNG NÖTIG: siehe K6]
- **FR-019**: Das KI-Matching bleibt unverändert.

### Zentrale Begriffe

- **Skill**: Name, normalisierter Name, Kategorie (HardSkill/SoftSkill),
  Embedding mit Version, optional kanonischer Skill.
- **Skill-Anforderung**: Stelle verlangt Skill, mit Priorität (Muss/Kann).
- **Skill-Angabe**: Bewerber hat Skill.
- **Synonym**: Zuordnung Skill → kanonischer Skill.
- **Verwechslungspaar**: zwei Skills, die nie als Treffer gelten.
- **Skill-Abdeckung**: Ergebnis einer Paarung – Gesamt-, HardSkill-,
  SoftSkill-Wert, Muss-Abdeckung, Aufschlüsselung, Berechnungsversion.
- **Bewertungseinstellungen**: Schwellen, Gewichte, Einbettungsvorlage,
  Embedding-Modell.

## Erfolgskriterien *(Pflicht)*

- **SC-001**: Für 100 % der geprüften Paarungen zeigen 3D, M×N, N:N-Export und
  CRM-Rückgabe denselben Wert.
- **SC-002**: Im von HR beurteilten Prüfset landen mindestens 90 % der Paarungen
  im erwarteten Band (passt ≥ 70 %, teilweise 30–69 %, passt nicht < 30 %).
- **SC-003**: Das Beispiel Fahrzeugaufbereiter × Genomik-Forscherin ergibt
  höchstens 15 %.
- **SC-004**: Identische Skill-Listen ergeben 100 %.
- **SC-005**: M×N mit 50 Stellen × 500 Bewerbern ist in unter 30 Sekunden
  berechnet.
- **SC-006**: Nach der Umstellung enthält keine CRM-Rückgabe einen Wert der
  alten Berechnung.

## Annahmen

- Stellen und Bewerber, die gematcht werden, sind in Neo4j vorhanden (der
  Abgleich vor dem Matching existiert bereits).
- Kategorie und Priorität der Skills stammen aus der Auswertung durch das
  Sprachmodell und werden so übernommen; der Parser kennt nur „Mandatory“ und
  „NiceToHave“.
- Ein mehrsprachiges Embedding-Modell ist verfügbar (lokal per Ollama oder über
  OpenRouter).
- Erweiterungen der Strategie – Reranking der Grauzone, Graph-Distanz,
  vollständiges ESCO-Mapping – sind nicht Teil dieser Version (Grundsatz VI).

## Klärungen

Offen (Empfehlung jeweils in `research.md`):

- **K1 – Embedding-Modell**: Welches Modell ist eingestellt? Wechsel auf
  `bge-m3`?
- **K2 – Muss-Skills** (FR-010): (a) keine Sonderregel, nur „x von y
  Muss-Skills“ anzeigen; (b) Deckelung des Gesamtwerts, wenn ein Muss-Skill
  fehlt; (c) Abzug je fehlendem Muss-Skill.
- **K3 – Hard/Soft** (FR-009): 80/20, und wenn eine Seite keine SoftSkills hat,
  zählt nur Hard?
- **K4 – Synonymliste** (FR-005): eigene Liste (aus vorhandenen Skills
  aufgebaut, im Tool pflegbar) oder ESCO-Katalog?
- **K5 – Prüfset**: Wer beurteilt das Prüfset (Paarungen und Skill-Paare), siehe
  `datenbedarf.md`?
- **K6 – Engine-Auswahl** (FR-018): Auswahl entfernen?
