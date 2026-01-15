# warefs-duden.de

Small personal dictionary app with a React frontend and MongoDB-backed API. The stack is dockerized and intended to be routed through the shared Nginx Proxy Manager on `proxy_net`.

**Impressum:** Siehe `IMPRESSUM.md` (wichtiger Hinweis: privates Einzel-Login-Projekt).  

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
- Forward host: `warefs-duden-web`
- Forward port: `80`
- WebSocket upgrade: enabled (Vite HMR)

SSL is handled in the NPM UI as requested. Repo: `https://github.com/tekercibasi/warefs-duden`.

## Screenshot
![Frontend-Vorschau](web/src/img/frontend.png)

## How it works (Kurzfassung)
- **Login:** `ADMIN_PASSWORD` schützt KI, Editieren und Löschen.
- **Rechtschreibung/Lemmatisierung:** GPT‑4o liefert `{corrected, suggestions, lemma, partOfSpeech, article}`. Wortarten (auch mehrfach möglich): noun, verb, adjective, adverb, interjection, particle, conjunction, preposition, phrase. Vorschläge sind optional; KI-Flow wird nicht blockiert.
- **KI-Vervollständigung:** OpenAI ergänzt fehlende Felder (Bedeutung, Gebrauch, Synonyme) und respektiert bestehende Inhalte. Prompt zwingt Lemma auf Kleinschreibung (außer Eigennamen/Abkürzungen).
- **Morphologie-Prefill:** Kommt `partOfSpeech/article` aus der Spellcheck-Antwort, werden Auswahlfelder im Formular vorbefüllt (Nomen + Artikel).
- **Persistenz:** MongoDB (`mongo_data` Volume). API auf Port `4000`, Frontend (Vite) auf Port `80`.
- **Hilfe im UI:** Footer-Link **Help** öffnet ein Overlay mit Nutzer- und Technik-Anleitung inkl. Testhinweisen. Siehe auch `HELP.md`.

### Qualität
- Letzter Check: 50 Stichproben (inkl. Mehrfach-Wortarten wie Adjektiv+Adverb, Partikel, Konjunktionen, Redewendungen) direkt gegen GPT‑4o mit JSON-Schema; Ergebnis 50/50 korrekt (100 %). Mehrfach-Wortarten werden als Liste zurückgegeben.

## Husky & Commitlint
- Hooks folgen der Strategie aus `/home/art-institut`: `.husky/commit-msg` ruft `npx --no-install commitlint --edit "$1"` auf.
- Config: `commitlint.config.js` (conventional commits). Bei frischem Clone im Repo-Root `npm install` ausführen; Husky-Install erfolgt über das `prepare`-Script.

## Notes
- This uses the Vite dev server for now. For production, replace with a build + static server.
- The API is available under `/api` and is proxied by Vite during development.
- AI completion requires `OPENAI_API_KEY` in `.env`. Login uses `ADMIN_PASSWORD` and unlocks create/edit/delete/AI.
- Database persistence: data lives in the named volume `mongo_data`. Do not run `docker compose down -v` unless you intentionally want to delete the database.

## Production security checklist
- Serve the built frontend (not the Vite dev server) behind TLS, ideally via the shared NPM reverse proxy with enforced HTTPS/HSTS.
- Set auth cookies with `Secure`, `HttpOnly`, and `SameSite=Strict` (or `Lax`) and enforce CSRF protection on the API (tokens or same-origin + origin checking).
- Validate and size-limit all entry fields server-side; reject oversized payloads to prevent abuse/DoS.
- Keep MongoDB bound to internal networks only; never expose it publicly.
- Run `npm audit --production` (web/api) on deploys and pin upgrades as needed.
- If you add external embeds, adjust the CSP in `web/index.html` accordingly.
