# HRTool – Feature-Roadmap & Wettbewerbsanalyse

> Erstellt nach Recherche der führenden ATS-Plattformen (Greenhouse, Pinpoint, Workable, Ashby, Lever, Manatal, Personio, Recruitee, Teamtailor, JazzHR, BambooHR, Zoho Recruit, Gem, Spark Hire, u.a.)

---

## 1. Marktüberblick: Was Recruiter an ATS-Tools schätzen oder ablehnen

### ✅ Warum Recruiter ein ATS nutzen (Adoptionsfaktoren)
| Faktor | Erklärung |
|--------|-----------|
| **Intuitive Bedienung** | Einfache UI/UX ist der #1 Adoptionsfaktor. Tools wie Teamtailor, Pinpoint und JazzHR werden geliebt, weil sie "out of the box" funktionieren. |
| **Zeitersparnis durch Automation** | Automatische E-Mails, Pipeline-Trigger, Interview-Scheduling – alles was manuelle Arbeit reduziert. |
| **Zentralisierte Kandidatendaten** | Ein Ort für alle Bewerberdaten statt verteilte Excel-Sheets, E-Mails und verschiedene Tools. |
| **Bessere Zusammenarbeit** | Hiring Manager können direkt Feedback geben, Scorecards ausfüllen und Notizen hinterlassen. |
| **Job-Board-Integration** | Ein Klick → Job auf LinkedIn, Indeed, StepStone etc. veröffentlicht. Massive Zeitersparnis. |
| **Karriereseiten-Builder** | Branded Career Pages ohne IT-Aufwand erstellen. Employer Branding direkt im Tool. |
| **Reporting & Analytics** | Time-to-hire, Source-Effectiveness, Conversion-Rates – datengetriebenes Recruiting. |
| **Compliance & DSGVO** | Automatische Datenlöschung, Einwilligungsmanagement, Audit-Trail. |

### ❌ Warum Recruiter ein ATS verlassen oder ablehnen (Schmerzpunkte)
| Schmerzpunkt | Erklärung |
|-------------|-----------|
| **Zu komplexe Einrichtung** | Steile Lernkurve, aufwändiges Setup → Tool wird nicht voll genutzt. |
| **Fehlende Integrationen** | Kein Anschluss an bestehende HRIS, Kalendersysteme, Slack, oder Jobbörsen. |
| **Schlechte Candidate Experience** | Komplizierte Bewerbungsformulare, keine Status-Updates, unpersönliche Kommunikation. |
| **Eingeschränkte Reporting-Optionen** | Vorgefertigte Reports die nicht anpassbar sind; fehlende Custom Reports. |
| **Hohe Kosten bei wenig Nutzen** | Besonders bei kleinen Teams: Wenn man für Features bezahlt, die man nicht braucht. |
| **Keine Mobile App** | Recruiting passiert oft unterwegs; fehlende Mobile-Unterstützung ist ein K.O.-Kriterium. |
| **Mangelhafte Suche** | Kandidatensuche die keine Boolean-Filter oder Skill-basierte Suche unterstützt. |
| **Fehlende AI-Features** | 2025/2026 ist AI-gestützte Vorauswahl, Matching und Textgenerierung zum Standard geworden. |

---

## 2. Feature-Vergleich: HRTool vs. Markt

### Legende
- ✅ = Vorhanden im HRTool
- 🟡 = Teilweise / Basis vorhanden
- ❌ = Fehlt komplett

### Kern-Features
| Feature | HRTool | Marktstandard | Priorität |
|---------|--------|---------------|-----------|
| Kanban-Pipeline | ✅ | ✅ | - |
| Kandidatenverwaltung | ✅ | ✅ | - |
| Stellenanzeigen-Verwaltung | ✅ | ✅ | - |
| AI-Matching (Kandidaten ↔ Jobs) | ✅ | ✅ | - |
| AI-Stellenbeschreibungen | ✅ | ✅ | - |
| AI-CV-Parsing (OCR) | ✅ | ✅ | - |
| Scorecard-Evaluation | ✅ | ✅ | - |
| Kandidaten-Ratings | ✅ | ✅ | - |
| Interview-Scheduling | 🟡 (manuell) | ✅ (Self-Scheduling) | **HOCH** |
| DSGVO-Compliance | ✅ | ✅ | - |
| Audit-Log | ✅ | ✅ | - |
| CSV Import/Export | ✅ | ✅ | - |
| Datei-Vorschau | ✅ | ✅ | - |
| Duplikat-Erkennung | ✅ | ✅ | - |
| Dashboard mit Widgets | ✅ | ✅ | - |
| Dark Mode | ✅ | 🟡 | - |
| i18n (DE/EN) | ✅ | ✅ | - |

### Fehlende Features (nach Priorität)

#### 🔴 HOHE PRIORITÄT – Features die den größten Impact haben

| # | Feature | Beschreibung | Vorbilder |
|---|---------|-------------|-----------|
| 1 | **E-Mail-Integration & Templates** | E-Mails direkt aus dem Tool versenden (Absage, Einladung, Status-Update). Personalisierte Templates mit Variablen ({{vorname}}, {{stelle}}). Automatische E-Mails bei Pipeline-Bewegung. | Greenhouse, Workable, Pinpoint, Recruitee |
| 2 | **Karriereseite / Stellenportal** | Öffentlich zugängliche Karriereseite die automatisch offene Stellen aus dem System anzeigt. Branded, konfigurierbar, mit Online-Bewerbungsformular. | Teamtailor, Pinpoint, Workable, AvaHR |
| 3 | **Automatisierte Workflows / Pipeline-Trigger** | Wenn Kandidat in Stage X verschoben → automatisch E-Mail senden, Scorecard anfordern, Interviewer benachrichtigen. Regelbasierte Automationen. | Pinpoint, Workable, Recruitee, Lever |
| 4 | **Kandidaten-Self-Scheduling** | Kandidaten können über einen Link einen Interviewtermin aus verfügbaren Zeiten selbst wählen. Kalender-Sync (Google/Outlook). | Greenhouse, Spark Hire, Gem, Ashby |
| 5 | **Job-Board-Posting (Multi-Posting)** | Stellenanzeige mit einem Klick an mehrere Jobbörsen senden (Indeed, LinkedIn, StepStone, Arbeitsagentur). | Workable, JazzHR, Zoho Recruit, Manatal |
| 6 | **Angebotsmanagement / Offer Letters** | Angebotsvorlagen erstellen, personalisieren und versenden. Optional mit E-Signatur-Integration. | Greenhouse, Trakstar Hire, ClearCompany |

#### 🟡 MITTLERE PRIORITÄT – Starke Differenzierungsmerkmale

| # | Feature | Beschreibung | Vorbilder |
|---|---------|-------------|-----------|
| 7 | **Kandidaten-CRM / Talent Pool** | Abgelehnte oder "Silver Medalist"-Kandidaten in einem Talent Pool speichern. Nurture-Kampagnen für zukünftige Stellen. Tags und Filter für Wiederansprache. | Lever, Ashby, Gem, Avature |
| 8 | **Erweiterte Analytics & Reporting** | Anpassbare Dashboards: Time-to-Hire, Cost-per-Hire, Source-Effektivität, Conversion-Rates pro Pipeline-Stage, Diversity-Metriken. Export als PDF/CSV. | Ashby, Greenhouse, ClearCompany |
| 9 | **Team-Kollaboration / Hiring Team** | Mehrere Stakeholder pro Stelle zuweisen (Hiring Manager, Interviewer). @mentions in Notizen. Strukturiertes Interview-Feedback mit Scorecards pro Interviewer. | Greenhouse, Recruitee, Teamtailor |
| 10 | **Onboarding-Modul** | Nach Einstellung: Checklisten, Dokumentenupload, Willkommens-E-Mails, Aufgabenverwaltung für den ersten Tag/Woche. Nahtloser Übergang von Kandidat → Mitarbeiter. | Greenhouse, Teamtailor, BambooHR, Pinpoint |
| 11 | **Kandidaten-Kommunikationshistorie** | Vollständige Kommunikationshistorie pro Kandidat (E-Mails, SMS, Notizen, Statusänderungen) in einer Timeline. | Recruit CRM, Workable, Lever |
| 12 | **AI-gestützte Kandidaten-Bewertung** | AI analysiert Lebenslauf vs. Stellenanforderungen und gibt einen Match-Score mit Erklärung (Transparenz). Keine Blackbox. | Pinpoint, Greenhouse (Real Talent), Manatal, Zoho Recruit |

#### 🟢 NIEDRIGERE PRIORITÄT – Nice-to-have / Langfristig

| # | Feature | Beschreibung | Vorbilder |
|---|---------|-------------|-----------|
| 13 | **Mitarbeiter-Empfehlungen (Referrals)** | Mitarbeiter können Kandidaten empfehlen. Tracking des Empfehlungsstatus. Optional: Prämien-System. | Pinpoint, Teamtailor, Lever |
| 14 | **Video-Interview-Integration** | Eingebettete oder verlinkte Video-Interviews (One-way oder Live). Asynchrone Interviews mit vordefinierten Fragen. | Spark Hire, VidCruiter, Workable, Zoho Recruit |
| 15 | **Blind/Anonymes Hiring** | Namen, Fotos und demografische Daten ausblenden für unvoreingenommene Bewertung. DEI-Unterstützung. | Workable, Teamtailor, Greenhouse |
| 16 | **Mobile App / Responsive Optimierung** | Progressive Web App oder native App für Recruiting unterwegs. Mindestens: responsive Design für Tablet/Phone. | BambooHR, Rippling, Avature |
| 17 | **API & Webhooks** | Offene REST-API und Webhooks für externe Integrationen. Swagger/OpenAPI-Dokumentation. | Ashby, Pinpoint, Greenhouse |
| 18 | **Slack/Teams-Benachrichtigungen** | Echtzeit-Benachrichtigungen in Slack oder Microsoft Teams bei neuen Bewerbungen, Statusänderungen etc. | Spark Hire, Recruit CRM, Ashby |
| 19 | **Kandidatenportal** | Self-Service-Portal für Bewerber: Bewerbungsstatus einsehen, Dokumente hochladen, Termine bestätigen. | Keka (HIRO), VidCruiter, AvaHR |
| 20 | **Multi-Sprach-Karriereseite** | Karriereseite in mehreren Sprachen anbieten (nicht nur DE/EN im Backend, sondern auch für externe Bewerber). | Pinpoint Enterprise, Workable |

---

## 3. Zentrale Erkenntnisse aus der Recherche

### Was Recruiter am meisten frustriert (Häufigste Beschwerden)
1. **Zu viele Klicks** für einfache Aktionen (Kandidaten verschieben, E-Mail senden)
2. **Keine automatisierten Absagen** – Kandidaten hören wochenlang nichts
3. **Reportes die nichts aussagen** – Standard-Reports ohne Anpassungsmöglichkeit
4. **Datensilos** – ATS kommuniziert nicht mit HRIS, Kalender, E-Mail
5. **Fehlende Candidate Experience** – Bewerber fühlen sich wie Nummern

### Was Top-Tools richtig machen
1. **Pinpoint**: Organization-weite Workflow-Automationen, AI Candidate Match Score
2. **Greenhouse**: 300+ Integrationen, strukturierte Interviews, Anti-Bias-Features
3. **Workable**: AI-Stellenanzeigen mit Ton-Anpassung, Multilingual Candidate UI
4. **Ashby**: All-in-One (ATS+CRM+Scheduling+Analytics), AI-Report-Erklärungen
5. **Gem**: 800M+ Profil-Datenbank, Free Built-in Scheduling, AI-Sourcing
6. **Recruitee**: WhatsApp-Recruiting, AgencyHub, Pre-Onboarding Journeys
7. **Teamtailor**: Elegantes Employer Branding, Anonymes Hiring, Onboarding-Module

### Markttrends 2025/2026
- **Agentic AI**: Nicht nur Empfehlungen, sondern AI die eigenständig Aufgaben ausführt
- **Explainable AI**: Transparente Match-Scores statt Blackbox-Algorithmen (bereits in HRTool vorhanden!)
- **Self-Scheduling**: Kandidaten wählen selbst Interview-Slots
- **CRM-Funktionen im ATS**: Talent Pools und Nurture-Kampagnen werden Standard
- **Connected Ecosystems**: Tiefe Integrationen mit HRIS, Slack, Kalender, Jobbörsen

---

## 4. Empfohlene Implementierungsreihenfolge

### Phase 1: Quick Wins (1-2 Wochen pro Feature)
1. ✉️ **E-Mail-Templates & Automatische Benachrichtigungen** → Größter sofortiger Nutzen
2. 🔄 **Pipeline-Trigger / Workflow-Automationen** → Reduziert manuelle Arbeit massiv
3. 📊 **Erweiterte Analytics** (Time-to-Hire, Source-Tracking) → Datengetriebenes Recruiting

### Phase 2: Differenzierungsmerkmale (2-4 Wochen)
4. 🌐 **Karriereseite mit Bewerbungsformular** → Öffnet dem Tool den externen Kanal
5. 📅 **Kandidaten-Self-Scheduling** → Modernes Candidate Experience Feature
6. 👥 **Team-Kollaboration** (Hiring Teams, @mentions) → Wichtig für größere Organisationen

### Phase 3: Erweiterte Features (4-8 Wochen)
7. 📋 **Angebotsmanagement / Offer Letters** → End-to-End Hiring Flow
8. 🗂️ **Talent Pool / CRM** → Langfristiger Kandidatenbeziehungsaufbau
9. 🚀 **Onboarding-Modul** → Nahtloser Übergang Kandidat → Mitarbeiter

### Phase 4: Nice-to-have
10. 🎥 Video-Interview-Integration
11. 🔒 Blind Hiring / Anonymisierung
12. 🔗 API & Webhooks für externe Integrationen
13. 💬 Slack/Teams-Integration
14. 📱 Progressive Web App

---

## 5. Zusammenfassung

Das HRTool hat bereits eine **starke Basis**: Kanban-Pipeline, AI-Matching, CV-Parsing, Scorecards, DSGVO-Compliance, i18n und Dashboard. Das positioniert es auf Augenhöhe mit vielen SMB-Tools wie JazzHR oder Manatal bei den Kern-Features.

Die **größten Lücken** im Vergleich zum Markt sind:
1. **Kommunikation** (E-Mail-Templates, automatische Benachrichtigungen)
2. **Externer Kanal** (Karriereseite, Job-Board-Posting)
3. **Workflow-Automation** (Trigger-basierte Aktionen)
4. **Self-Scheduling** (Kalender-Integration)

Diese vier Features würden das HRTool von einem internen Management-Tool zu einer **vollwertigen Recruiting-Plattform** machen, die mit kommerziellen Lösungen wie Recruitee, Workable oder Manatal konkurrieren kann.

> **Vorteil HRTool**: Self-hosted, DSGVO-konform by design, AI-transparent (Ollama/lokal), keine Vendor-Lock-in, kostenlos. Das sind Alleinstellungsmerkmale gegenüber allen SaaS-Konkurrenten!
