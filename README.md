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
- **Duplikat-Erkennung** — Automatische Prüfung von Name und E-Mail beim Anlegen
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
- **Datenbank-Backup** — Komplettes SQLite-Backup als Download (Admin)

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
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=ihr-n8n-api-key
```

---

## 🛠 Tech Stack

### Backend

| Technologie | Zweck |
|-------------|-------|
| **Node.js + Express 5** | REST-API-Server |
| **better-sqlite3** | Embedded Datenbank (WAL-Modus für Performance) |
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
| **n8n** | Workflow-Automation (optional, für CV-Parser & Matching) |
| **Tesseract OCR** | Texterkennung in gescannten PDFs |
| **Poppler** | PDF-zu-Bild-Konvertierung |

### Datenbank

**SQLite** mit **12 Tabellen** und **24 Indizes**:

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

Kunden können die Matching-Funktion auch ohne HRTool-Frontend und ohne lokale Bewerber-/Stellenverwaltung verwenden. Dafür steht eine API-Key-geschützte OpenAPI-Schnittstelle bereit:

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
├── backend/
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
│   └── hrtool.db              # SQLite-Datenbank
├── frontend/
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

Proprietär — © 2025 Sebastian Oczachowski. Alle Rechte vorbehalten.

---

<p align="center">
  <strong>HRTool — Recruiting. Einfach. Intelligent.</strong><br/>
  <sub>Entwickelt mit ❤️ und KI</sub>
</p>
