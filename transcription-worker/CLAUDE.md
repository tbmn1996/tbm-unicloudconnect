# transcription-worker - Agentenanleitung

`CLAUDE.md` ist die kanonische Projektanleitung. `AGENTS.md` verweist per Symlink auf diese Datei; `GEMINI.md` importiert sie.

## Zweck

Isolierter lokaler Transkriptions-Worker (Audio/Video aus LearnWeb-Aufzeichnungen -> Markdown), per Subprocess aus tbm-unicloudconnect aufgerufen.

## Stack

- Profil: `python-automation` (Python-Automation)
- Overlays: keine

## Vor dem Arbeiten

1. Lies diese Datei und `README.md`.
2. Pruefe vorhandene Manifeste, Lockfiles und relevante Aufrufer vor Aenderungen.
3. Veraendere keine fremden oder unerwarteten Working-Tree-Aenderungen.

## Befehle

- **setup:** `uv sync --dev`
- **run:** `uv run transcription_worker`
- **test:** `uv run pytest -q`
- **lint:** `uv run ruff check .`
- **typecheck:** `-`
- **build:** `-`

## Arbeitsregeln

- Keine neuen Dependencies, Installationen, Loeschungen, Commits, Pushes oder Deployments ohne klare Freigabe.
- Bestehende Patterns und die kleinste tragfaehige Aenderung bevorzugen.
- Tests nach Risiko und betroffener Flaeche auswaehlen.
- CLI-Ausgaben begrenzen und keine kompletten Logs oder grossen JSON-Antworten ausgeben.

## Sicherheit und Zugriffe

- Echte `.env`-Dateien, lokale Settings, Tokens und Credential-JSON niemals ausgeben oder committen.
- Zugriffsvoraussetzungen stehen ohne Werte in `docs/ACCESS.md`.
- OAuth, Provider-Linking, Secret-Setzen und Remote-Aktionen benoetigen jeweils eine separate Freigabe.
- Clientcode darf keine serverseitigen Secrets wie Service Roles, Client Secrets, Datenbank- oder Redis-URLs enthalten.

## Abschluss

- Relevante Tests, Lint und Typecheck ausfuehren.
- `git status --short` pruefen.
- Fehlende Logins oder manuelle Schritte konkret nennen, ohne Accounts oder IDs auszugeben.
