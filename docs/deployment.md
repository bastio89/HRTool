# HRTool Deployment-Guide

Diese Anleitung beschreibt Betrieb, Update und Wartung für macOS-Entwicklung und Deployment mit Docker Compose.

## 1) Manueller Betrieb auf macOS (lokal)

### Voraussetzungen

- Node.js 18+
- Lokale Ollama-Installation
- Tesseract + Poppler für OCR

### Schnellstart

1. Repository klonen und ins Projekt wechseln.
2. `cp .env.example .env` und Variablen prüfen.
3. Backend starten:
   ```bash
   cd backend
   npm install
   node server.js
   ```
4. Frontend starten:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
5. Zugriff:
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:3001/api`

Plattform-vorgaben und Zielumgebungshinweise befinden sich in `dockerization-documents/platform-reference.md`.

### Wichtige env-Werte

- `LLM_PROVIDER=ollama`
- `OLLAMA_BASE_URL=http://10.13.13.130:11434` (Remote-Ollama im Standardfall)
- `OLLAMA_MODEL=llama3.2`
- `LLM_MODEL=llama3.2` (Fallback)
- `JWT_SECRET` (starkes Secret)
- `TESSERACT_BIN`, `PDFTOPPM_BIN` auf lokale Installationen anpassen

## 2) Container-basiertes Deployment

### Architektur

- Backend Container: Node.js + OCR-Binärdateien + non-root Benutzer
- Frontend Container: Vite-Build + Nginx (SPA-Fallback)
- Datenpersistenz: `hrtool_data` Volume (SQLite unter `/app/data`)
- Ingress: Traefik im Host (bereits vorhanden)
- Optional: lokaler Ollama-Service via Compose-Profil `local-ollama`

### Konvention auf Zielplattform

- Host-Pfad: `/srv/deployments/hrtool`
- Datei `compose.yml` wird als Standard-Compose-Datei genutzt
- Deployment-Rollen: Betrieb als `appadmin`-fähiger Benutzer
- Kein `.env`-Commit in Git, `env.example` als Referenz
- Traefik-Netzwerk erstellen (falls nicht vorhanden):
  ```bash
  docker network create traefik
  ```

### Deployment-Schritte

```bash
cd /srv/deployments/hrtool
cp .env.example .env
# .env an Umgebung anpassen
docker compose pull
docker compose build --no-cache
docker compose up -d
```

### Wichtige Umgebungsvariablen

- **LLM lokal**
  - `LLM_PROVIDER=ollama`
  - `OLLAMA_BASE_URL=http://10.13.13.130:11434` (Standard)
  - `OLLAMA_MODEL=llama3.2`
  - Optionaler lokaler Ollama-Service: `docker compose --profile local-ollama up -d`
  - Beim lokalen Service ggf. `OLLAMA_BASE_URL=http://ollama:11434` setzen
- **OpenAI-kompatibel**
  - `LLM_PROVIDER=openai`
  - `OPENAI_BASE_URL=https://api.openai.com`
  - `OPENAI_API_KEY=<secret>`
  - `LLM_MODEL=<modell>`
- **OpenAI-kompatibel (kompatibler Endpunkt)**
  - `LLM_PROVIDER=openai-compatible`
  - `OPENAI_BASE_URL=https://api.openai.com/v1`
  - `OPENAI_API_KEY=<secret>`
  - `LLM_MODEL=<modell>`
- **OCR in Linux-Container**
  - `TESSERACT_BIN=/usr/bin/tesseract`
  - `PDFTOPPM_BIN=/usr/bin/pdftoppm`
- **Traefik**
  - `TRAEFIK_HOST=hrtool.example.com`
  - `TRAEFIK_ENTRYPOINT=websecure`
  - `TRAEFIK_NETWORK=traefik`

### Profilwahl

- Reine Remote-LLM-Nutzung (Standard ohne extra Service):
  ```bash
  docker compose up -d --build
  ```
- Mit lokalem Ollama-Service im selben Compose-Stack:
  ```bash
  docker compose --profile local-ollama up -d --build
  ```

## 3) Multi-Architecture-Image-Build

Für amd64/arm64 (z. B. lokale Entwicklung + Debain11/13 amd64-Hosts):

```bash
docker buildx create --name hrtool-builder --use
docker buildx build --platform linux/amd64,linux/arm64 -f backend/Dockerfile -t your-registry/hrtool-backend:latest --push .
docker buildx build --platform linux/amd64,linux/arm64 -f frontend/Dockerfile -t your-registry/hrtool-frontend:latest --push .
```

## 4) Healthchecks

- Backend:
  - `curl -f http://<backend-host>:3001/api/health`
- Frontend:
  - `curl -f http://<frontend-host>/health`
- Optionaler Ollama:
  - `docker compose exec ollama ollama ps`

## 5) Update & Rollback

- Update:
  ```bash
  git pull
  docker compose build
  docker compose up -d
  ```
- Schnell-Validierung:
  - API-Docs laden: `/api/docs`
  - Frontend: Startseite erreichbar
  - KI-Status (Model Card, Health) prüfen
- Rollback:
  ```bash
  docker compose down
  docker compose up -d --force-recreate
  ```

## 6) Backup / Restore (SQLite)

- Backup:
  ```bash
  docker run --rm -v hrtool_data:/data -v $(pwd):/backup busybox sh -c "cp /data/hrtool.db /backup/hrtool.db"
  ```
- Restore:
  ```bash
  docker run --rm -v hrtool_data:/data -v $(pwd):/backup busybox sh -c "cp /backup/hrtool.db /data/hrtool.db"
  ```
- Danach `docker compose restart backend`.
