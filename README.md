# duden.allmendina.de

Small personal dictionary app with a React frontend and MongoDB-backed API. The stack is dockerized and intended to be routed through the shared Nginx Proxy Manager on `proxy_net`.

## Stack
- `web`: React (Vite dev server) on port 80
- `api`: Express + Mongoose on port 4000
- `mongo`: MongoDB 7 with a named volume

## Quick start
1. Copy `.env.example` to `.env` and adjust values.
2. Start the stack:
   ```sh
   docker compose up -d
   ```
3. Access the app through NPM once the proxy host is wired.

## NPM / proxy routing
- Network: `proxy_net` (external)
- Forward host: `duden-allmendina-web`
- Forward port: `80`
- WebSocket upgrade: enabled (Vite HMR)

SSL is handled in the NPM UI as requested. Repo: `https://github.com/tekercibasi/warefs-duden`.

## How it works (Kurzfassung)
- **Login:** `ADMIN_PASSWORD` schützt KI, Editieren und Löschen.
- **Rechtschreibung:** Das fokussierte Lemma wird lokal mit nspell + deutschem Wörterbuch geprüft. Gibt es einen Vorschlag, muss er bestätigt werden, bevor KI läuft.
- **KI-Vervollständigung:** OpenAI ergänzt fehlende Felder (Bedeutung, Gebrauch, Synonyme) und respektiert bestehende Inhalte. Prompt zwingt Lemma auf Kleinschreibung (außer Eigennamen/Abkürzungen).
- **Persistenz:** MongoDB (`mongo_data` Volume). API auf Port `4000`, Frontend (Vite) auf Port `80`.
- **Hilfe im UI:** Footer-Link **Help** öffnet ein Overlay mit Nutzer- und Technik-Anleitung. Siehe auch `HELP.md`.

## Husky & Commitlint
- Hooks folgen der Strategie aus `/home/art-institut`: `.husky/commit-msg` ruft `npx --no-install commitlint --edit "$1"` auf.
- Config: `commitlint.config.js` (conventional commits). Bei frischem Clone im Repo-Root `npm install` ausführen; Husky-Install erfolgt über das `prepare`-Script.

## Notes
- This uses the Vite dev server for now. For production, replace with a build + static server.
- The API is available under `/api` and is proxied by Vite during development.
- AI completion requires `OPENAI_API_KEY` in `.env`. Login uses `ADMIN_PASSWORD` and unlocks create/edit/delete/AI.
- Database persistence: data lives in the named volume `mongo_data`. Do not run `docker compose down -v` unless you intentionally want to delete the database.
