# Hilfe zur Wort-Collection

Diese App sammelt persönliche Wörterbucheinträge. Sie prüft dein Lemma auf Rechtschreibung und ergänzt die anderen Felder bei Bedarf mit KI.

## So nutzt du die App
- **Anmelden:** Nutze den Login oben rechts, um Einträge anzulegen, zu bearbeiten oder zu löschen.
- **Lemma eingeben:** Trage dein Wort ein. Beim Klick auf **„Mit KI ergänzen“** wird zuerst nur das Lemma geprüft. Falls eine Schreibweise vorgeschlagen wird, wähle sie aus.
- **Felder ergänzen:** Erst nach deiner Auswahl ergänzt die KI Bedeutung, Gebrauch und Synonyme. Bestehender Text wird respektiert.
- **Speichern:** Mit **„Eintrag speichern“** ablegen. Bearbeiten oder löschen kannst du nur im eingeloggten Zustand.
- **Hilfe im UI:** Im Footer gibt es einen **Help**‑Link. Er öffnet ein Overlay, das den Ablauf und die Technik erklärt.

## Was passiert wann?
1. **Rechtschreibprüfung (Lemma):** GPT‑4o prüft das Lemma (und optional andere Felder), liefert Vorschläge/Artikel/Part-of-Speech, blockiert den Flow aber nicht.
2. **KI‑Vervollständigung:** OpenAI ergänzt fehlende Felder (Bedeutung, Gebrauch, Synonyme). Vorhandener Text bleibt bestehen.
3. **Speichern:** Einträge liegen in MongoDB. Die API läuft auf Port 4000, das Frontend auf 80 (Docker‑Compose).

## Technischer Überblick
- **Frontend:** React (Vite). Rechtschreibhinweise und KI‑Ausgaben werden je Feld angezeigt.
- **API:** Express + Mongoose. Endpunkte: `/api/entries` (CRUD), `/api/entries/ai-complete` (KI), `/api/entries/spellcheck` (Spellcheck/Lemmatisierung via GPT‑4o).
- **Rechtschreibung:** GPT‑4o, liefert Vorschläge/Artikel/POS je Feld.
- **KI:** OpenAI ergänzt nur fehlende Felder und korrigiert Rechtschreibung/Typografie schonende Weise.
- **Login:** ADMIN_PASSWORD aktiviert Bearbeiten/Löschen/KI.
- **Infra:** Docker‑Compose (web/api/mongo), Proxy‑Netz `proxy_net` für NPM.
 - **Repo:** https://github.com/tekercibasi/warefs-duden

## Development-Hinweise
- **Husky/Commitlint:** Commit‑Hooks laufen per `npx --no-install commitlint --edit "$1"` (conventional commits). Beim Clone: `npm install` im Repo und `npm run prepare`, falls nötig. Repo: https://github.com/tekercibasi/warefs-duden
- **Start lokal:** `docker compose up -d` im Repo‑Root. Frontend auf Port 80, API auf 4000.
- **Sicherheit:** `.env` enthält Credentials (ADMIN_PASSWORD, OPENAI_API_KEY, Mongo‑Daten). Nicht einchecken.
