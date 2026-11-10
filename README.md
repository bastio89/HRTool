<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/Node.js-Express_5-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/KI-Ollama_LLM-8B5CF6?style=for-the-badge&logo=meta&logoColor=white" alt="Ollama AI" />
  <img src="https://img.shields.io/badge/Design-Apple_HIG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Apple Design" />
  <img src="https://img.shields.io/badge/DSGVO-konform-34C759?style=for-the-badge&logo=shield&logoColor=white" alt="DSGVO" />
</p>

<h1 align="center">🚀 HRTool — Intelligentes Bewerbermanagement</h1>

<p align="center">
  <strong>Das KI-gestützte Applicant Tracking System für modernes Recruiting.</strong><br/>
  Bewerber verwalten. Stellen besetzen. Zeit sparen. — Alles in einer Anwendung.
</p>

<p align="center">
  <a href="#-features-im-überblick">Features</a> •
  <a href="#-ki-features">KI-Features</a> •
  <a href="#-screenshots">Screenshots</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-api-dokumentation">API</a>
</p>

---

## 💼 Warum HRTool?

| Problem | Lösung mit HRTool |
|---------|-------------------|
| Bewerbungen in Excel-Tabellen verwalten | **Zentrale Bewerber-Datenbank** mit Suchfunktion, Filtern und Tags |
| Stundenlange Lebensläufe manuell auswerten | **KI-CV-Parser** liest PDFs/Word-Dateien und füllt Felder automatisch |
| Kandidaten mühsam mit Stellen abgleichen | **KI-Matching** bewertet und rankt Bewerber automatisch |
| Stellenbeschreibungen von Null schreiben | **KI-Stellengenerator** erstellt professionelle Ausschreibungen in Sekunden |
| Kein Überblick über den Bewerbungsprozess | **Kanban-Pipeline** zeigt jeden Kandidaten auf einen Blick |
| DSGVO-Verstöße riskieren | **Automatische Löschfristen** mit konfigurierbarer Aufbewahrungsdauer |
| Keine Zusammenarbeit im Team | **Multi-User-System** mit Audit-Trail und Rollenmanagement |

---

## ✨ Features im Überblick

### 📊 Dashboard — Alles auf einen Blick
- **Echtzeit-Statistiken** — Gesamtzahl Bewerber, Neue diese Woche, Trend-Indikatoren
- **Aktive Pipelines** — Direktzugriff auf laufende Bewerbungsprozesse mit Stufenzähler
- **Letzte KI-Matchings** — Schnellzugriff auf die letzten Matching-Ergebnisse
- **Top-Standorte** — Geografische Verteilung der Bewerber
- **Quellen-Analyse** — Welcher Kanal liefert die besten Kandidaten? (Hire-Rate pro Quelle)
- **DSGVO-Status** — Sofortige Übersicht über Konformität
- **Anstehende Interviews** — Nächste Termine direkt sichtbar
- **Frei konfigurierbar** — Widgets per Drag & Drop anordnen und ein-/ausblenden

### 👥 Bewerbermanagement
- **Umfangreiche Profile** — Name, Kontakt, Standort, Skills, Erfahrung, Ausbildung, Gehaltswunsch, Verfügbarkeit, Sprachen, Zertifikate, Führerschein, Mobilität
- **Status-Tracking** — Aktiv, Passiv, In Prozess, Blacklist
- **Tags & Quellen** — Flexible Verschlagwortung und Herkunfts-Tracking (LinkedIn, Xing, Indeed, Stepstone, Empfehlung, Karriereseite, Messe, Initiativ)
- **Eine Person gibt es nur einmal** — Name + Geburtsdatum machen einen Bewerber eindeutig (das Geburtsdatum ist optional, weil das führende CRM Dubletten verhindert; ohne Geburtsdatum wird nicht auf Dubletten geprüft); eine vorhandene Person wird beim Anlegen, im CSV- und im CV-Import blockiert bzw. übersprungen. Gleiche E-Mail oder gleicher Name allein sind nur ein Hinweis
- **Eine Stelle gibt es nur einmal** — gleiche URL oder gleicher Titel bei gleicher Firma und gleichem Ort
- **Dubletten bereinigen** — Administration → Dubletten zeigt Dubletten aus dem Bestand und führt sie zusammen (inkl. Pipelines, Interviews, Dateien, Matching-Ergebnissen)
- **Aktivitätsprotokoll** — Notizen, Anrufe, E-Mails, Interviews — lückenlose Dokumentation
- **Datei-Upload** — Drag & Drop für PDFs, Word-Dokumente und Bilder
- **Datei-Vorschau** — PDFs und Bilder direkt im Browser anzeigen
- **Sterne-Bewertung** — 1–5 Sterne in 4 Kategorien: Gesamt, Fachlich, Persönlich, Kulturfit
- **Pipeline-Historie** — Vollständige Stufenwechsel-Chronik pro Bewerber
- **Druckansicht** — Mit optionaler Anonymisierung für neutrale Bewertung

### 🔍 Erweiterte Suche & Filter
- **Volltextsuche** — Über Name, E-Mail und Skills
- **Skill-Filter mit UND-Logik** — Alle angegebenen Skills müssen vorhanden sein
- **Status- & Standort-Filter** — Serverseitig für optimale Performance
- **Sortierung** — Nach Name, Datum oder Status (auf-/absteigend)
- **Pagination** — Serverseitig mit konfigurierbarer Seitengröße

### 📋 Kanban-Pipeline
- **6 Stufen** — Beworben → Vorauswahl → Interview → Angebot → Hired → Abgesagt
- **Drag & Drop** — Kandidaten einfach zwischen Stufen verschieben
- **Pflichtnotizen** — Bei jedem Stufenwechsel wird der Grund dokumentiert
- **Interview-Planung** — Termine direkt in der Pipeline erstellen (Datum, Typ, Ort, Meeting-Link, Teilnehmer)
- **Bewertungen sichtbar** — Sterne-Ratings direkt auf den Kanban-Karten
- **Matching aus Pipeline** — KI-Matching direkt mit den aktuellen Pipeline-Kandidaten starten
- **Mobil optimiert** — Touch-Swipe-Navigation zwischen Stufen auf Smartphones

### 📁 Stellenverwaltung
- **Vollständige Stellen** — Titel, Beschreibung, Anforderungen, Standort, Typ (Vollzeit/Teilzeit), URL
- **Status-Management** — Offen, Besetzt, Entwurf
- **KI-Stellenbeschreibung** — Professionelle Ausschreibungen per Knopfdruck generieren
- **Pipeline-Verknüpfung** — Jede Stelle hat eine eigene Kanban-Pipeline

### 📅 Interview-Management
- **Termin-Planung** — Datum, Uhrzeit, Dauer, Typ (Vor Ort, Video, Telefon)
- **Meeting-Links** — Direkter Zugang zu Video-Calls
- **Status-Tracking** — Geplant, Bestätigt, Durchgeführt, Abgesagt
- **Dashboard-Widget** — Anstehende Interviews immer im Blick

### 📥 Import & Export
- **CSV-Export** — Bewerberlisten und Matching-Ergebnisse als CSV herunterladen
- **CSV-Import** — Massenhafter Bewerber-Upload mit automatischer Duplikat-Erkennung
- **Datenbank-Backup** — JSON-Backup der PostgreSQL-Daten als Download (Admin)
- **Generische Export-Schnittstelle** — Bewerberdaten mit frei wählbaren Feldern, Zielfeld-Mapping und Filtern als CSV, JSON, NDJSON oder XML exportieren; als Profil speichern und optional per API-Key für Fremdsysteme freigeben (Administration → Datenexport, nur Admins)
- **CRM-Austausch (Axessence)** — Kandidaten-ZIP aus dem CRM importieren (CRM-UUID bleibt die UUID des Bewerbers) und die Matching-Ergebnisse als Rückgabe-CSV im CRM-Format liefern (Administration → CRM-Austausch, siehe „CRM-Schnittstelle“)
- **N:N-Matching-Export** — Ergebnisse von KI-Matching und 3D-Matching als Liste Bewerber × Stelle (eine Zeile je Paarung, letztes Ergebnis) exportieren, optional nur Paarungen mit einem Matchingwert größer X % (Administration → Datenexport → Datenquelle „KI-Matching“ bzw. „3D-Matching“)

### 🔐 Sicherheit & Compliance
- **JWT-Authentifizierung** — Sichere Token-basierte Anmeldung
- **Multi-User** — Mehrere Recruiter können gleichzeitig arbeiten
- **Rollensystem** — Admin- und Recruiter-Rollen mit unterschiedlichen Berechtigungen
- **Audit-Trail** — Jede Aktion wird nachvollziehbar protokolliert (Wer, Was, Wann)
- **Passwort-Management** — Eigenes Passwort ändern, Admin kann zurücksetzen

### 🛡️ DSGVO-Konformität
- **Konfigurierbare Löschfristen** — 1 bis 24 Monate Aufbewahrungsdauer
- **Automatische Erkennung** — Abgelaufene Bewerber werden erkannt und angezeigt
- **Massen-Löschung** — Alle abgelaufenen Datensätze inkl. Dateien auf Knopfdruck entfernen
- **Anonymisierung** — Bewerberdaten vor KI-Analyse anonymisiert, Druckansicht anonymisierbar
- **Dashboard-Status** — DSGVO-Konformität jederzeit sichtbar

### 🎨 Apple-inspiriertes Design
- **Modernes UI** — Inspiriert von Apples Human Interface Guidelines
- **Dark Mode** — Automatische Erkennung der Systemeinstellung oder manueller Toggle
- **Responsive Design** — Optimiert für Desktop, Tablet und Smartphone
- **Sanfte Animationen** — Flüssige Übergänge und Micro-Interactions
- **Konsistentes Farbschema** — Apple Blue, Mint Green, Signal Red durchgängig

---

## 🤖 KI-Features

### 1. KI-Bewerbungsanalyse (CV-Parser)
> Laden Sie einen Lebenslauf hoch — die KI erledigt den Rest.

- **Unterstützte Formate:** PDF, Word (.docx), gescannte PDFs (via OCR)
- **Automatische Extraktion:** Name, E-Mail, Telefon, Standort, Skills, Erfahrung, Ausbildung, Sprachen
- **OCR-Fallback:** Gescannte PDFs werden automatisch per Texterkennung verarbeitet (Deutsch + Englisch)
- **Ein-Klick-Übernahme:** Extrahierte Daten werden direkt in das Bewerberformular übernommen

### 2. KI-Kandidaten-Matching
> Finden Sie automatisch die besten Kandidaten für jede Stelle.

- **Intelligente Bewertung:** Jeder Bewerber erhält einen Score von 0–100
- **Detailanalyse:** Stärken und Schwächen pro Kandidat aufgeschlüsselt
- **Visuelle Score-Ringe:** Sofort erkennbar, wer am besten passt
- **Anonymisierte Bewertung:** Kandidatennamen werden vor der KI-Analyse anonymisiert
- **CSV-Export:** Matching-Ergebnisse als Tabelle exportieren
- **Historie:** Alle vergangenen Matchings abrufbar

### 3. KI-Stellenbeschreibung
> Professionelle Stellenausschreibungen in Sekunden generieren.

- **Stichpunkte eingeben** — z.B. "React, 3 Jahre Erfahrung, Remote möglich"
- **KI generiert** — Vollständige Beschreibung und Anforderungsprofil
- **Sofort übernehmen** — Generierte Texte direkt in die Stelle einfügen
- **Lokal & privat** — Alle KI-Operationen laufen über Ihr lokales Ollama-Modell

> 💡 **Datenschutz:** Alle KI-Verarbeitungen finden **lokal** auf Ihrem Server statt. Keine Daten verlassen Ihr Netzwerk.

---

## 📸 Screenshots

<details>
<summary><strong>Dashboard</strong></summary>
<p>Konfigurierbares Dashboard mit Echtzeit-Statistiken, aktiven Pipelines, KI-Matchings und DSGVO-Status.</p>
</details>

<details>
<summary><strong>Bewerberliste</strong></summary>
<p>Filterbarer Überblick aller Bewerber mit Skill-Tags, Status-Badges und Sterne-Bewertungen.</p>
</details>

<details>
<summary><strong>Kanban-Pipeline</strong></summary>
<p>Drag & Drop Kanban-Board mit 6 Stufen, Notizen, Interviews und Bewertungen auf den Karten.</p>
</details>

<details>
<summary><strong>KI-Matching</strong></summary>
<p>Automatische Kandidaten-Bewertung mit Score-Ringen, Stärken/Schwächen und CSV-Export.</p>
</details>

<details>
<summary><strong>Bewerberprofil</strong></summary>
<p>Detailansicht mit Dateien, Aktivitätsprotokoll, Bewertungen, Pipeline-Historie und Druckansicht.</p>
</details>

---

## 🚀 Installation

### Voraussetzungen

| Software | Version | Zweck |
|----------|---------|-------|
| **Node.js** | ≥ 18 | Backend & Frontend |
| **Ollama** | latest | Lokale KI (LLM) |
| **Tesseract** | optional | OCR für gescannte PDFs |
| **Poppler** | optional | PDF-zu-Bild-Konvertierung für OCR |

### Schritt 1: Repository klonen

```bash
git clone https://github.com/bastio89/HRTool.git
cd HRTool
```

### Schritt 2: Ollama installieren & Modell laden

```bash
# Ollama installieren (macOS)
brew install ollama

# Ollama starten
ollama serve

# Modell herunterladen
ollama pull llama3.2
```

### Schnellstart mit Docker Compose

Der empfohlene Start auf einer neuen Maschine läuft vollständig über Docker Compose. Der Start prüft Docker und Compose, legt bei Bedarf eine `.env` an, prüft die Secret-Platzhalter, validiert die Konfiguration, baut die Images und startet standardmäßig die App-Dienste ohne Caddy. Daten bleiben in Docker-Volumes erhalten. Ältere `.env`-Dateien ohne die zusätzlichen PostgreSQL- und pgAdmin-Variablen bleiben kompatibel und verwenden dafür die dokumentierten Compose-Defaults.

```bash
cp .env.docker.example .env
# Alle Platzhalter für Secrets in .env ersetzen
./start.sh
```

Wenn du Caddy direkt mitstarten willst, setze `START_CADDY=1`:

```bash
START_CADDY=1 ./start.sh
```

Alternativ kann Compose direkt gestartet werden:

```bash
docker compose up -d --build
docker compose ps
```

Für einen Neustart ohne Neubau genügt `docker compose up -d`. Zum Stoppen werden die Container angehalten, die persistenten Volumes bleiben erhalten:

```bash
docker compose down
```

## 🚚 CI/CD

Die automatisierte Pipeline besteht aus drei Teilen:

1. **CI** läuft bei jedem Push und Pull Request über GitHub Actions und prüft Backend, Frontend und GraphRAG.
2. **Image-Publishing** läuft bei Push auf `main` und bei Versionstags wie `v1.2.3`; dabei werden GHCR-Images mit `latest`, SHA und Versionstag gebaut.
3. **Deployment** ist manuell per GitHub Actions `workflow_dispatch` und verbindet sich per SSH mit dem Zielserver, zieht die GHCR-Images für einen frei wählbaren Tag und startet den Compose-Stack neu.

Für das Deploy-Workflow werden folgende Secrets benötigt:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PATH`
- optional `DEPLOY_SSH_PORT`
- optional `image_tag` beim Deploy-Workflow, wenn nicht `latest` verwendet werden soll

Die Compose-Datei kann sowohl lokal als auch mit Registry-Images arbeiten. Lokal greifen die Defaults aus [.env.docker.example](.env.docker.example), für Server-Deployments können `BACKEND_IMAGE`, `FRONTEND_IMAGE` und `GRAPHRAG_IMAGE` auf GHCR-Referenzen gesetzt werden.

Im Compose-Netzwerk verwendet GraphRAG `bolt://neo4j:7687`; die mitgelieferte `.env.docker.example` ist dafür bereits vorbereitet. Ollama läuft standardmäßig auf dem Host und wird aus den Containern über `host.docker.internal` erreicht. Auf Linux muss Docker den Hostnamen unterstützen; alternativ setzen Sie `OLLAMA_BASE_URL` auf einen von den Containern erreichbaren Ollama-Host.

Danach ist HRTool erreichbar unter:

| Service | URL |
|---------|-----|
| **HRTool (Caddy)** | `https://localhost` |
| **Frontend** | `http://localhost:5173` |
| **Backend API** | `http://localhost:3001/api` |
| **Swagger UI** | `http://localhost:3001/api/docs` |
| **GraphRAG API** | `http://localhost:8002` |

### HTTPS mit Caddy

Caddy ist im Docker-Compose-Stack enthalten und übernimmt TLS sowie das Reverse-Proxying zum Frontend. Er wird aber nicht mehr automatisch von `./start.sh` gestartet. Das Frontend leitet `/api` und `/graphrag-api` intern an die jeweiligen Dienste weiter.

Für eine öffentliche Installation:

1. Lassen Sie einen DNS-A- bzw. AAAA-Record für Ihre Domain auf den Docker-Host zeigen.
2. Setzen Sie in `.env` `APP_DOMAIN=hrtool.example.com` und `ACME_EMAIL=admin@example.com`.
3. Geben Sie die Ports `80` und `443` am Host bzw. in der Firewall frei.
4. Starten Sie den Stack mit `./start.sh` neu.

Caddy beantragt und erneuert das öffentliche Let's-Encrypt-Zertifikat automatisch. Die Zertifikatsdaten liegen im persistenten Docker-Volume `caddy-data`. Für `APP_DOMAIN=localhost` verwendet Caddy ein lokales Zertifikat, das Browser zunächst als nicht öffentlich vertrauenswürdig melden können.

Persistente Daten liegen in den Docker-Volumes `hrtool-data`, `postgres-data`, `neo4j-data`, `neo4j-logs` und `pgadmin-data`. Für lokale KI muss Ollama auf dem Host laufen:

```bash
ollama serve
ollama pull llama3.2
```

> Hinweis: Wenn Ollama ebenfalls containerisiert oder auf einem anderen Server läuft, setzen Sie `OLLAMA_BASE_URL` in `.env` entsprechend, z.B. `http://ollama:11434` oder `http://ki-server:11434`.

### Schritt 3: Backend starten

```bash
cd backend
npm install
node server.js
```

Der Backend-Server startet auf **http://localhost:3001**.

### Schritt 4: Frontend starten

```bash
cd frontend
npm install
npm run dev
```

Das Frontend ist erreichbar unter **http://localhost:5173**.

### Schritt 5: Einloggen

| Feld | Wert |
|------|------|
| **Benutzername** | `admin` |
| **Passwort** | `admin123` |

> ⚠️ Bitte ändern Sie das Standard-Passwort nach dem ersten Login.

### Optional: OCR für gescannte PDFs (macOS)

```bash
brew install tesseract tesseract-lang poppler
```

### Umgebungsvariablen (`.env`)

```env
PORT=3001
JWT_SECRET=ihr-sicherer-schlüssel
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
EXTERNAL_API_KEY=ihr-externer-api-key
```

---

## 🛠 Tech Stack

### Backend

| Technologie | Zweck |
|-------------|-------|
| **Node.js + Express 5** | REST-API-Server |
| **PostgreSQL** | Zentrale relationale Datenbank für Bewerber, Jobs und Systemdaten |
| **jsonwebtoken** | JWT-basierte Authentifizierung |
| **bcryptjs** | Sichere Passwort-Verschlüsselung |
| **multer** | Datei-Upload-Handling |
| **pdf-parse** | PDF-Textextraktion |
| **mammoth** | Word-Dokument-Textextraktion |
| **swagger-ui-express** | Interaktive API-Dokumentation |

### Frontend

| Technologie | Zweck |
|-------------|-------|
| **React 19** | Modernes UI-Framework |
| **React Router 7** | Client-seitiges Routing |
| **Tailwind CSS 4** | Utility-First CSS Framework |
| **Vite 7** | Blitzschneller Dev-Server & Build Tool |
| **Lucide Icons** | Konsistente Icon-Bibliothek |

### KI & Automation

| Technologie | Zweck |
|-------------|-------|
| **Ollama** | Lokales LLM (llama3.2) für alle KI-Features |
| **Tesseract OCR** | Texterkennung in gescannten PDFs |
| **Poppler** | PDF-zu-Bild-Konvertierung |

### Datenbank

**PostgreSQL** als zentrale relationale Datenbank. Neo4j ergänzt die Anwendung für Graphdaten und Vektorsuche.

Die wichtigsten relationalen Bereiche sind:

```
candidates          — Bewerberprofile (17+ Felder)
jobs                — Stellenausschreibungen
pipeline_entries    — Kanban-Board-Einträge
pipeline_notes      — Stufenwechsel-Notizen
activities          — Aktivitätsprotokoll
candidate_files     — Hochgeladene Dateien
matching_results    — KI-Matching-Historie
users               — Benutzerkonten
audit_log           — Systemweites Audit-Trail
settings            — Systemeinstellungen (DSGVO etc.)
candidate_ratings   — Sterne-Bewertungen (4 Kategorien)
interviews          — Interview-Termine
```

---

## 📖 API-Dokumentation

Die vollständige API-Dokumentation ist über **Swagger UI** verfügbar:

```
http://localhost:3001/api/docs
```

### Matching-only REST API für Integrationen

Kunden können die Matching-Funktion auch ohne HRTool-Frontend und ohne lokale Bewerber-/Stellenverwaltung verwenden. Die bisherige Schnittstelle ist veraltet; verwenden Sie nach Möglichkeit direkt den GraphRAG-Endpoint. Die API-Key-geschützte Schnittstelle bleibt noch als Legacy-Pfad verfügbar:

```http
POST /api/matching/external/run
X-API-Key: ihr-externer-api-key
Content-Type: application/json
```

Beispiel-Request:

```json
{
  "job": {
    "id": "job-frontend-01",
    "title": "Frontend Developer",
    "description": "React-Anwendung fuer ein SaaS-Produkt weiterentwickeln.",
    "requirements": "React, TypeScript, REST APIs, 3+ Jahre Erfahrung",
    "location": "Berlin / Remote",
    "type": "Vollzeit"
  },
  "candidates": [
    {
      "id": "cand-4711",
      "name": "Kandidat 4711",
      "skills": "React, Node.js, SQL",
      "experience": "5 Jahre Frontend-Entwicklung",
      "education": "B.Sc. Informatik",
      "languages": "Deutsch C2, Englisch C1",
      "location": "Berlin",
      "availability": "ab 01.09."
    }
  ],
  "weights": {
    "skills": 5,
    "experience": 3,
    "location": 1
  }
}
```

Die Antwort enthält Score, Stärken, Schwächen und Kurzbegründung je Kandidat. Die Daten werden nicht als Bewerber oder Stelle im HRTool gespeichert; die Schnittstelle nutzt nur das konfigurierte lokale KI-Modell.

### Eindeutige Identität von Bewerbern und Stellen

Eine Person und eine Stelle gibt es im HRTool genau einmal – in PostgreSQL und in Neo4j mit derselben ID.

| | Bewerber | Stelle |
|---|---|---|
| Gleich, wenn … | Name + Geburtsdatum gleich (Groß-/Kleinschreibung und Leerzeichen egal); ohne Geburtsdatum keine Prüfung | URL gleich (ohne `http(s)://`, `www.`, abschließendes `/`) **oder** Titel + Firma + Ort gleich |
| Pflichtangaben | Name (Geburtsdatum optional) | Titel |
| Bei Treffer | Anlegen wird mit HTTP 409 und Verweis auf den vorhandenen Bewerber blockiert; Importe überspringen die Zeile | Anlegen wird mit HTTP 409 blockiert; ein erneuter Import ergänzt bei der vorhandenen Stelle nur leere Skills |

- **UUID:** Jeder Datensatz hat die Spalte `uuid` (eindeutig, von PostgreSQL vergeben). GraphRAG legt Neo4j-Knoten unter genau dieser UUID an; bestehende Neo4j-IDs wurden bei der Migration übernommen, wo sie eindeutig waren.
- **Durchgesetzt** wird die Regel in allen Anlegewegen (Formular, CSV-Import, KI- und Schnell-CV-Import, Batch-Import, jobs.ch, API) und zusätzlich durch Eindeutigkeitsindizes in PostgreSQL (`backend/src/identity.js`, `graphrag/services/candidate_identity.py`).
- **Geburtsdatum:** wird beim CV-Import aus beschrifteten Angaben gelesen („Geburtsdatum: 12.03.1985“, „Date of birth …“). Es ist optional: Fehlt es oder ist das gelesene Datum unbrauchbar, wird der Bewerber ohne Geburtsdatum angelegt (dann ohne Dublettenprüfung – die stellt das CRM sicher). Ein von Hand eingegebenes ungültiges Datum wird abgelehnt. Es dient nur der Identifikation und geht nicht in Embeddings, Neo4j oder an ein Sprachmodell.
- **3D-Matching per UUID:** Bewerber und Stellen werden in Neo4j über ihre UUID gesucht, nicht mehr über Namen oder Titel (Namensvettern werden nicht verwechselt). Fehlt ein Eintrag in Neo4j – z. B. bei manuell angelegten Bewerbern oder Altbestand –, holt das Backend den Abgleich vor dem Matching automatisch nach (GraphRAG `POST /sync/candidates` bzw. `POST /sync/jobs`, ohne Sprachmodell und ohne Credits). Was dann noch fehlt, wird mit Grund gemeldet statt stillschweigend ausgelassen. Beim Abgleich erhalten manuell angelegte Bewerber zusätzlich einen CV-Text aus ihrem Profil, damit auch das KI-Matching ausgewählter Paarungen sie findet.
- **Bestand bereinigen:** Administration → Dubletten listet Dubletten (Bewerber auch mögliche über gleiche E-Mail, Telefonnummer oder gleichen Namen) und führt sie zusammen. Eindeutigkeitsregeln, die wegen alter Dubletten noch nicht aktiv sind, werden nach dem Zusammenführen automatisch aktiv. Dort lässt sich auch der Neo4j-Abgleich nachholen (`POST /sync/candidates` in GraphRAG).

### Datenexport für Fremdsysteme

Bewerberdaten lassen sich über eine generische Schnittstelle in andere Tools übertragen (Lohnbuchhaltung, HRIS, CRM …). Ein Export wird durch eine Spezifikation beschrieben:

```json
{
  "entity": "candidates",
  "format": "json",
  "fields": [
    { "key": "id", "as": "personalId" },
    { "key": "first_name", "as": "person.vorname" },
    { "key": "email", "as": "kontakt.email" },
    { "key": "work_history", "as": "werdegang" }
  ],
  "filters": { "status": ["Aktiv"], "updated_since": "2026-01-01T00:00:00Z" }
}
```

- `key` ist ein internes Feld (Liste: `GET /api/exports/schema`, inkl. benutzerdefinierter Felder als `custom.<id>`), `as` der Feldname im Zielsystem. Punkte erzeugen in JSON/XML verschachtelte Objekte.
- Formate: `csv` (Trennzeichen komma/semikolon/tab), `json`, `ndjson`, `xml`.
- Der Datenexport liegt unter **Administration → Datenexport** und ist Admins vorbehalten. Gespeicherte **Export-Profile** lassen sich dort ausführen – auch für eine Auswahl aus der Bewerberliste.
- Für **Pull durch Fremdsysteme** ein Profil freigeben und `EXTERNAL_API_KEY` setzen:

```http
GET /api/exports/external/profiles/{id}?limit=500&offset=0&updated_since=2026-01-01T00:00:00Z
X-API-Key: ihr-externer-api-key
```

Die Antwort trägt `X-Total-Count` für das seitenweise Abholen. Jeder Export – über die Oberfläche wie per API – wird mit Feldern, Filtern und Anzahl im Audit-Log protokolliert. Neue Entitäten (z. B. Stellen) werden in `backend/src/exports/index.js` registriert und nutzen dieselben Formate, Profile und Endpunkte.

#### Matching-Ergebnisse (N:N)

Neben `candidates` gibt es die Entitäten `matching_ai` (KI-Matching) und `matching_vector` (3D-Matching). Sie liefern eine Zeile je Paarung Bewerber × Stelle mit dem jeweils **letzten** Ergebnis – über alle Läufe hinweg (Matrix „Alle Kandidaten : Alle Stellen“, Stelle → Kandidaten, Kandidat → Stellen, KI-Matching selektierter Paarungen).

```json
{
  "entity": "matching_vector",
  "format": "csv",
  "fields": ["candidate_id", "candidate_uuid", "candidate_name", "job_id", "job_uuid", "job_title", "score", "hard_skill_score", "soft_skill_score", "matched_at"],
  "filters": { "score_above": 70, "job_status": ["Offen"] }
}
```

- `score_above`: nur Paarungen mit Matchingwert **größer als** dem Wert (0–100, in %). Weitere Filter: `job_ids`, `candidate_ids`, `job_status`, `candidate_status`, `updated_since` (gematcht seit).
- IDs: `candidate_id` und `job_id` sind die PostgreSQL-Primärschlüssel. `candidate_uuid` bzw. `job_uuid` sind die UUIDs der Datensätze (eindeutig, siehe „Eindeutige Identität“); dieselbe UUID trägt der Knoten in Neo4j.
- Grundlage ist die Tabelle `matching_pair_results` (je Methode und Paarung genau ein Eintrag). Läufe aus der Matching-Historie, die vor dieser Tabelle entstanden sind, werden beim ersten Matching-Export automatisch übernommen – bei 3D-Läufen aus dieser Zeit allerdings nur die dort gespeicherten (besten 100) Paarungen. Wird ein Lauf aus der Historie, ein Bewerber oder eine Stelle gelöscht, verschwinden die zugehörigen Paarungen mit.

### CRM-Schnittstelle

Datei-Austausch mit dem CRM (Axessence) nach der Schnittstellenbeschreibung „Technische Schnittstelle HR Matching“. Bedienung unter **Administration → CRM-Austausch** (nur Admins).

**1. Import (CRM → HR Tool).** Im CRM unter *Datensicherung & Admin → HR Matching Tool Daten* das ZIP `hr-matching-kandidaten.zip` herunterladen und hochladen.

- Inhalt: `kandidaten.csv` (UTF-8 mit BOM, Komma, Spalten `UUID, Vorname, Nachname, Labels, CV_Dokument`, Labels als JSON-Array in der Zelle) und die CVs unter `cvs/<UUID>.pdf|.docx|.doc`. Der Tabellenkalkulationsschutz des CRM (führender Apostroph vor `= + - @`) wird beim Lesen entfernt.
- Zuerst wird nur **geprüft** (`POST /api/crm/import`): UUID gültig und nur einmal, Labels lesbar, CV vorhanden und im Format PDF/DOCX/DOC. Pfade außerhalb des Archivs (`..`, absolute Pfade) lassen das ganze ZIP scheitern. Die Prüfliste zeigt je Kandidat „wird angelegt“, „wird aktualisiert“ oder den Fehler.
- Dann wird **Kandidat für Kandidat** importiert (`POST /api/crm/import/{token}/candidates/{uuid}`, mit Fortschritt; Fehlgeschlagene lassen sich erneut versuchen):
  - Das CV wird gelesen (alte `.doc`-Dateien über `word-extractor`) und wie beim CV-Import von GraphRAG ausgewertet.
  - Die **CRM-UUID wird unverändert die UUID des Bewerbers** – dieselbe ID in CRM, PostgreSQL und Neo4j. Vor- und Nachname aus dem CRM gehen vor dem Namen aus dem CV; Labels kommen zu den Tags hinzu. Das CV liegt danach beim Bewerber unter „Dateien“.
  - Gibt es die UUID schon, wird **aktualisiert** statt doppelt angelegt. Ist das CV unverändert, wird es nicht neu ausgewertet (spart Credits).
  - Gibt es dieselbe Person (Name + Geburtsdatum) bereits ohne CRM-Bezug im Tool, wird sie mit der CRM-UUID **verknüpft**. Führt das CRM sie unter einer anderen UUID, gelten sie als zwei Personen (das CRM verhindert Dubletten); das Geburtsdatum wird dann nicht übernommen.
- Hochgeladene Archive liegen unter `backend/data/crm-imports/` und werden nach 24 Stunden oder mit „Verwerfen“ entfernt. Grenzen: 10 000 Kandidaten, 256 MiB je CV, 300 MB je ZIP (nginx erlaubt für `/api/crm/` entsprechend große Uploads).

**2. Rückgabe (HR Tool → CRM).** Methode (KI- oder 3D-Matching) und optional „Matchingwert größer als X %“ wählen, Vorschau ansehen, CSV herunterladen und im CRM hochladen (Vorschau prüfen, Übernahme auslösen).

- Format: UTF-8 mit BOM, Semikolon, CRLF, Kopfzeile `UUID;Vorname;Nachname;Firma;Stelle;URL;Matching;Bewerbungsdatum;Startdatum;Ort;Lohnvorstellung;Anforderungen;Status` – keine weiteren Spalten. Bewerbungsdatum, Startdatum und Status bleiben leer (überschreiben im CRM nichts; neue Bewerbungen erhalten dort den Status „Aktiv“).
- Je CRM-Kandidat und Stelle eine Zeile mit dem letzten Ergebnis aus `matching_pair_results`; KI und 3D kommen nie in dieselbe Datei.
- Das CRM übernimmt eine Datei **ganz oder gar nicht**. Deshalb enthält sie nur Zeilen, die die CRM-Prüfung bestehen: nur Kandidaten aus dem CRM (`source = 'CRM'`), nur Stellen mit Firma, Titel und absoluter http(s)-URL ohne Zugangsdaten. Alles andere zeigt die Vorschau mit Grund (z. B. „Stelle ohne URL“) und Link zur Stelle.
- Texte: HTML wird zu Text, `<` und `>` werden durch `‹` `›` ersetzt, höchstens 20 000 Zeichen je Feld. „Anforderungen“ sind die Anforderungen der Stelle (sonst die Beschreibung).
- **Lohnvorstellung** ist der Lohn der Stelle, sofern die Stellenbeschreibung einen nennt: das Feld „Lohn laut Stellenbeschreibung“ der Stelle oder – wenn leer – ein Betrag mit Währung bei einem Lohn-Begriff im Stellentext („Lohn: CHF 110'000“, „Jahreslohn von CHF 95'000.– bis …“). Ohne Angabe bleibt die Spalte leer.
- Mehr als 5000 Zeilen oder 5 MiB werden auf mehrere Dateien verteilt (`…-teil-1-von-2.csv`), die einzeln hochgeladen werden.
- Endpunkte: `GET /api/crm/return/preview?method=ai|vector&score_above=70` und `GET /api/crm/return/download?method=…&score_above=…&part=1`. Import und Rückgabe stehen im Audit-Log.

### Übersicht: 63+ Endpunkte

| Bereich | Endpunkte | Beschreibung |
|---------|-----------|--------------|
| **Auth** | 8 | Login, User-Management, Passwort, Backup |
| **Candidates** | 11 | CRUD, Suche, Filter, Batch-Operationen, Import |
| **Jobs** | 6 | CRUD, KI-Stellenbeschreibung |
| **Pipeline** | 7 | Kanban-Board, Stufenwechsel, Notizen |
| **Matching** | 5 | KI-Matching starten, externe Matching-API, Historie |
| **Activities** | 3 | Aktivitätsprotokoll pro Bewerber |
| **Uploads** | 5 | Datei-Upload, Download, Vorschau |
| **CV-Parser** | 1 | KI-Lebenslauf-Analyse |
| **Ratings** | 5 | Sterne-Bewertungen (CRUD, Durchschnitte) |
| **Interviews** | 6 | Terminplanung, Status-Tracking |
| **Settings** | 4 | DSGVO-Konfiguration, Löschfristen |
| **Audit** | 2 | Audit-Trail, Statistiken |

---

## 📱 Mobile & Responsive

HRTool ist für alle Geräte optimiert:

- **Desktop** — Vollständiges Kanban-Board mit Drag & Drop
- **Tablet** — Angepasstes Layout mit Touch-Unterstützung
- **Smartphone** — Swipe-Navigation zwischen Pipeline-Stufen, kompakte Karten mit Touch-optimierten Aktions-Buttons

---

## 🏗 Projektstruktur

```
HRTool/
├── docker-compose.yml         # Docker-Start für Backend, Frontend & Volumes
├── .env.docker.example        # Beispiel-Konfiguration für Docker Compose
├── backend/
│   ├── Dockerfile             # Backend-Container
│   ├── server.js              # Express-Server & DB-Initialisierung
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js        # Authentifizierung & User-Management
│   │   │   ├── candidates.js  # Bewerberverwaltung
│   │   │   ├── jobs.js        # Stellenverwaltung
│   │   │   ├── pipeline.js    # Kanban-Pipeline
│   │   │   ├── matching.js    # KI-Matching
│   │   │   ├── activities.js  # Aktivitätsprotokoll
│   │   │   ├── uploads.js     # Datei-Management
│   │   │   ├── cvParser.js    # KI-CV-Analyse
│   │   │   ├── ratings.js     # Bewertungssystem
│   │   │   ├── interviews.js  # Interview-Planung
│   │   │   ├── settings.js    # Systemeinstellungen
│   │   │   └── audit.js       # Audit-Trail
│   │   ├── middleware/
│   │   │   └── auth.js        # JWT-Middleware
│   │   └── swagger.js         # API-Dokumentation
│   ├── uploads/               # Hochgeladene Dateien
│   └── backups/               # JSON-Datenbank-Backups
├── frontend/
│   ├── Dockerfile             # Frontend-Build & Nginx-Auslieferung
│   ├── nginx.conf             # SPA-Routing & API-Proxy
│   ├── src/
│   │   ├── pages/             # 14 Seiten (Dashboard, Candidates, etc.)
│   │   ├── components/        # Wiederverwendbare UI-Komponenten
│   │   ├── api.js             # API-Client
│   │   ├── AuthContext.jsx    # Authentifizierungs-State
│   │   └── ThemeContext.jsx   # Dark Mode
│   ├── vite.config.js
│   └── index.html
└── README.md
```

---

## 📈 Auf einen Blick

| Metrik | Wert |
|--------|------|
| **Frontend-Seiten** | 14 |
| **API-Endpunkte** | 63+ |
| **Datenbank-Tabellen** | 12 |
| **Datenbank-Indizes** | 24 |
| **KI-Features** | 3 (CV-Parser, Matching, Stellengenerator) |
| **Pipeline-Stufen** | 6 |
| **Bewertungs-Kategorien** | 4 |
| **Bewerber-Quellen** | 9 |
| **Unterstützte Dateiformate** | PDF, Word, JPG, PNG |
| **Sprachen (OCR)** | Deutsch, Englisch |

---

## 🎯 Zielgruppe

HRTool ist ideal für:

- **Personaldienstleister** — die viele Kandidaten effizient verwalten müssen
- **Inhouse-Recruiter** — die einen strukturierten Überblick über alle Bewerbungen brauchen
- **HR-Teams** — die kollaborativ an Besetzungen arbeiten
- **Startups & KMU** — die eine professionelle aber bezahlbare ATS-Lösung suchen
- **Datenschutzbewusste Unternehmen** — die KI nutzen wollen, ohne Daten an Dritte zu senden

---

## 🔒 Datenschutz & Sicherheit

- ✅ **Lokale KI** — Alle KI-Verarbeitungen laufen auf Ihrem eigenen Server
- ✅ **Keine Cloud-Abhängigkeit** — Vollständig selbst gehostet
- ✅ **DSGVO-konform** — Konfigurierbare Löschfristen, Anonymisierung
- ✅ **Audit-Trail** — Jede Aktion nachvollziehbar
- ✅ **Verschlüsselte Passwörter** — bcrypt-Hashing
- ✅ **JWT-Token** — Sichere Session-Verwaltung

---

## 📝 Lizenz

Proprietär — © 2025 HRTool. Alle Rechte vorbehalten.

---

<p align="center">
  <strong>HRTool — Recruiting. Einfach. Intelligent.</strong><br/>
  <sub>Entwickelt mit ❤️ und KI</sub>
</p>
