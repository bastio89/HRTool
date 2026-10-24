# Fast CV- und Job-Parser

Dieses Paket extrahiert strukturierte Informationen und den lesbaren Volltext aus textbasierten PDF-Lebensläufen und Stellenanzeigen. Es stellt dafür einen wiederverwendbaren FastAPI-Router und eine eigenständig startbare FastAPI-Anwendung bereit.

Der Parser übernimmt keine Speicherung, kein Matching und keine OCR. Diese Aufgaben liegen beim aufrufenden Dienst. Im HRTool wird der Router von GraphRAG verwendet; Frontend-Importe können das zurückgegebene Profil und den Volltext anschließend an die bestehende Persistenz weitergeben.

## Ablauf

1. Der Aufrufer sendet eine PDF als Multipart-Datei im Feld `file` an einen Parser-Endpunkt.
2. Der Router prüft den Dateityp und die maximale Uploadgröße, liest die Bytes und schließt den Upload. Leere Dateien werden zurückgewiesen.
3. PyMuPDF (`fitz`) extrahiert Textblöcke aus den PDF-Seiten. Die Blöcke werden nach Seite und Position sortiert. Verschlüsselte PDFs und PDFs ohne extrahierbaren Text werden abgelehnt.
4. GLiNER klassifiziert die Textblöcke mit CV- oder Job-spezifischen Labels. Das Modell läuft auf CPU; die Inferenz wird in einen Worker-Thread ausgelagert und durch einen Lock geschützt.
5. Die Parserlogik fasst Treffer zusammen, normalisiert Werte und validiert die Antwort mit Pydantic-Schemas.
6. Der Router liefert strukturierte Felder zurück. Beim Job-Endpunkt ist zusätzlich der komplette extrahierte Text enthalten.

### Skill-Erkennung

Skills stammen aus zwei Quellen:

- GLiNER erkennt Skills anhand der Kategorien Soft Skills, technische IT-Skills, Methoden, Softwarewerkzeuge und Sprachen.
- `skill_sections.py` ergänzt Bullet-Listen unter Überschriften wie „Fähigkeiten“, „Kenntnisse“, „Skills“ oder „Qualifikationen“. Der Fallback verbindet umgebrochene Zeilen, entfernt PDF-Zero-Width-Zeichen und beendet die Erfassung an bekannten Folgeüberschriften wie „Unser Angebot“.

Die Listenerkennung ordnet eine Anforderung als Ganzes einer Kategorie zu. Ein Eintrag kann deshalb beispielsweise „Mehrjährige Erfahrung in der Microsoft Office Palette als Power-User sowie XML, HTML und JavaScript“ lauten und wird nicht zwingend in einzelne Technologien zerlegt. Sprachangaben werden, soweit erkennbar, als Sprachen wie `German (C2)` und `English` ausgegeben.

## API

Beide Endpunkte erwarten eine Multipart-PDF im Feld `file`:

| Methode und Pfad | Ergebnis |
| --- | --- |
| `POST /api/v1/parse/cv` | Personendaten, Berufserfahrung, Ausbildung und kategorisierte Skills |
| `POST /api/v1/parse/job` | Jobprofil mit Firma, Ort, Titel, Pensum, Arbeitsmodell und geforderten Skills sowie `raw_text` |

Beispiel für eine Jobantwort:

```json
{
  "profile": {
    "company_name": "PrimeSoft AG",
    "location": "Baar / Eschlikon",
    "job_title": "Product Template Specialist",
    "required_skills": {
      "soft_skills": ["Verantwortungsbewusstsein und analytische Auffassungsgabe"],
      "it_skills": ["Erfahrung mit Microsoft Office, XML, HTML und JavaScript"],
      "method_skills": [],
      "tool_skills": [],
      "language_skills": ["German (C2)", "English"]
    },
    "remote_work": null,
    "workload_pensum": "80-100%"
  },
  "raw_text": "Vollständig extrahierter Text der Stellenanzeige ..."
}
```

Beispielaufruf gegen einen lokal laufenden GraphRAG-Dienst:

```sh
curl -F "file=@stellenanzeige.pdf;type=application/pdf" \
  http://localhost:8000/api/v1/parse/job
```

## Betriebsarten

### Als GraphRAG-Router

GraphRAG bindet denselben Router in seine FastAPI-Anwendung ein:

```python
from fast_cvjob_parsing.app.router import create_cv_job_parser_router

app.include_router(create_cv_job_parser_router())
```

Der GraphRAG-Lifespan lädt `ResumeJobParser` beim Start und speichert ihn in `app.state.cv_job_parser`. Der Router greift über diesen Zustand darauf zu. Bis das Modell bereit ist, antwortet ein Parse-Aufruf mit HTTP 503. Der GraphRAG-Healthcheck wird erst erfolgreich, wenn die Startsequenz einschließlich Modellladen abgeschlossen ist.

### Eigenständiger Dienst

`app/main.py` erstellt eine FastAPI-Anwendung, bindet denselben Router ein und lädt das Modell in seinem eigenen Lifespan. Das Paket-Dockerfile startet diese Anwendung über Uvicorn auf Port `8000`.

## Limits und Fehler

- Standardlimit: 20 MiB pro Upload. `MAX_UPLOAD_BYTES` kann den Wert ändern.
- Akzeptierte Upload-MIME-Typen: `application/pdf`, `application/octet-stream` oder kein MIME-Typ. Der Inhalt muss trotzdem ein lesbares PDF sein.
- Der Parser extrahiert eingebetteten PDF-Text. Bildbasierte bzw. gescannte Dokumente ohne Textschicht benötigen vorab OCR und werden hier nicht erkannt.
- HTTP 400: ungültiges, leeres, verschlüsseltes oder nicht lesbares PDF.
- HTTP 413: Upload überschreitet das Größenlimit.
- HTTP 503: Parsermodell ist noch nicht bereit.
- HTTP 500: unerwarteter Fehler bei der Extraktion oder Inferenz; Details stehen im Serverlog.

## Modell und Konfiguration

Das Standardmodell ist `urchade/gliner_multi-v2.1`. `ResumeJobParser.load()` lädt es über GLiNER, verschiebt es auf CPU und aktiviert den Evaluationsmodus.

| Variable | Standard | Zweck |
| --- | --- | --- |
| `GLINER_MODEL` | `urchade/gliner_multi-v2.1` | GLiNER-Modellkennung |
| `MODEL_CACHE_DIR` | `/app/model_cache` | Cache-Verzeichnis für Modellartefakte |
| `TORCH_NUM_THREADS` | `2` | Maximale Torch-CPU-Threads; mindestens ein Thread |
| `MAX_UPLOAD_BYTES` | `20971520` | Maximale Uploadgröße in Bytes |
| `CORS_ORIGINS` | `*` (Standalone-App) | Kommagetrennte CORS-Ursprünge der Standalone-App |

Im eigenständigen Docker-Build wird das Modell während des Image-Builds geladen und der Laufzeitcontainer offline gestartet. Beim GraphRAG-Host erfolgt das Laden im Anwendungs-Lifespan; dessen Healthcheck sollte vor dem Freigeben des Frontends abgewartet werden.

## Tests

Die Tests für den Router verwenden einen injizierten Fake-Parser; sie laden weder Torch noch GLiNER. Die Tests für `skill_sections.py` prüfen deutsche Anforderungslisten, mehrzeilige Bulletpunkte und Abschnittsgrenzen.

Aus dem Verzeichnis `graphrag`:

```sh
python -m pip install -r fast_cvjob_parsing/requirements-test.txt
python -m pytest -q fast_cvjob_parsing/tests
```

Die Laufzeitabhängigkeiten des Parsers stehen in `requirements.txt`; sie enthalten FastAPI, PyMuPDF, GLiNER und Torch.