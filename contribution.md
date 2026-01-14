# Contribution Guide

Danke, dass du zu **duden.allmendina.de** beitragen möchtest! Dieses Projekt ist ein kleines Wörterbuch-Frontend (React/Vite) mit Express/MongoDB-API. KI ergänzt fehlende Felder, die Rechtschreibung wird lokal geprüft.

## Überblick & Architektur
- **Frontend:** React (Vite), Port 80. UI enthält einen Help-Overlay (Footer-Link), der Nutzer:innen den Ablauf erklärt.
- **API:** Express + Mongoose, Port 4000. Endpunkte: `/api/entries` (CRUD), `/api/entries/ai-complete` (OpenAI), `/api/entries/ai-review` (lokale Rechtschreibprüfung via nspell + deutsches Wörterbuch).
- **DB:** MongoDB 7 (Container, Volume `mongo_data`).
- **Login:** `ADMIN_PASSWORD` schaltet Editieren/Löschen/KI frei.
- **Netz:** Compose hängt `web` ans `proxy_net` für NPM-Routing.

## Setup (Entwicklung)
1. `.env.example` nach `.env` kopieren und Platzhalter ausfüllen (siehe Security-Hinweise unten).
2. Abhängigkeiten im Root installieren (Husky/Commitlint) und in `web`/`api` je nach Bedarf:
   ```sh
   npm install        # Root: commitlint/husky
   cd web && npm install
   cd ../api && npm install
   ```
3. Docker-Stack starten:
   ```sh
   docker compose up -d
   ```
   - Frontend: http://localhost (Port 80 im Compose)
   - API: http://localhost:4000
4. Optional lokal ohne Docker (nicht empfohlen fürs Komplett-Setup):
   - `api`: `npm run dev` (PORT 4000, MONGO_URL setzen)
   - `web`: `npm run dev -- --host --port 80`

## Tests & Qualität
- **Commitlint:** Husky-Hook erzwingt conventional commits. Hook: `.husky/commit-msg` ruft `npx --no-install commitlint --edit "$1"` auf.
- **Prepare:** `npm run prepare` richtet Husky ein (Root). Bei frischem Clone einmal ausführen.
- **Lint/Format:** Noch keine Linters/Formatter konfiguriert. Bitte konsistenten Stil beibehalten; gern PRs mit ESLint/Prettier vorschlagen.
- **CI:** Nicht vorhanden. Bitte manuell sicherstellen, dass Compose-Stack startet und Seiten laden.

## Branch- & PR-Workflow
- Fork & Branch: `feat/*`, `fix/*`, `docs/*` etc.
- Pull Requests: Kurz beschreiben, was geändert wurde, Tests/Manuelle Checks erwähnen (z.B. "docker compose up -d; UI smoke test").
- Review: Bitte keine Secrets in PRs; Screenshots willkommen.

## UI/Feature-Hinweise
- **Lemma-Prüfung:** Beim Klick auf „Mit KI ergänzen“ wird zuerst nur das Lemma geprüft. Wenn ein Vorschlag erscheint, muss er bestätigt werden; erst dann ruft die KI die restlichen Felder ab.
- **Help-Overlay:** Footer-Link „Help“ erklärt Nutzer-Flow und Technik; bitte bei UI-Änderungen aktualisieren.
- **Warnungen:** Rechtschreibhinweise in den Textfeldern ignorieren Großschreibung am Satzanfang; Lemma-Hinweis bleibt aktiv.

## Security & Secrets
- **Keine Secrets ins Repo**: `.env` ist in `.gitignore`. Nutze Platzhalter (z.B. `OPENAI_API_KEY=sk-...` ohne echten Wert) und lokale `.env`.
- **Rotation:** Falls versehentlich Schlüssel genutzt wurden, bitte sofort rotieren (OpenAI, ADMIN_PASSWORD).
- **E2E-Daten:** Keine produktiven Daten ins Repo oder Issues kopieren.

## Bug Reports & Feature Requests
- Neue Issues bitte mit:
  - Kontext/Schritte
  - Erwartetes vs. aktuelles Verhalten
  - Logs (API/Browser) ohne Secrets

## Lizenz & Danksagung
- Geplante Veröffentlichung als Open Source (Lizenz bitte ergänzen). Bis dahin: interne Nutzung.
- Danke an alle Beitragenden! Jede PR, die UX, Zuverlässigkeit oder Security verbessert, ist willkommen.
