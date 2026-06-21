# TBM UniCloudConnect - Agentenanleitung

`CLAUDE.md` ist die kanonische Projektanleitung. `AGENTS.md` verweist per Symlink auf diese Datei; `GEMINI.md` importiert sie.

## Zweck

Lokaler, read-only LearnWeb-Sync fuer macOS (TypeScript-Module: LearnWeb-Core, Sync-Engine, Local-Library, MCP). App-Shell/GUI-Technologie noch offen.

## Stack

- Profil: `ts-service` (TypeScript-Service)
- Overlays: github-ci

## Vor dem Arbeiten

1. Lies diese Datei und `README.md`.
2. Pruefe vorhandene Manifeste, Lockfiles und relevante Aufrufer vor Aenderungen.
3. Veraendere keine fremden oder unerwarteten Working-Tree-Aenderungen.

## Befehle

- **setup:** `npm install`
- **run:** `npm run dev`
- **test:** `npm test`
- **lint:** `npm run lint`
- **typecheck:** `npm run typecheck`
- **build:** `npm run build`

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
