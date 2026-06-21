# TBM UniCloudConnect - Agentenanleitung

`CLAUDE.md` ist die kanonische Projektanleitung. `AGENTS.md` verweist per Symlink auf diese Datei; `GEMINI.md` importiert sie.

## Zweck

Lokaler, read-only LearnWeb-Sync fuer macOS (TypeScript-Module: LearnWeb-Core, Sync-Engine, Local-Library, MCP). App-Shell/GUI-Technologie noch offen.

## Guardrails (MVP 1)

- **Plattform**: MVP 1 ist strikt macOS-only. Keine Windows- oder Linux-Kompatibilität implementieren.
- **Speicherung (Local-first)**: Alle Daten und die Synchronisation laufen komplett local-first auf dem Rechner des Nutzers. Keine Cloud-Speicherung oder zentrale Server.
- **Keine Notion-Integration**: Es gibt in MVP 1 keine Notion-Push-Pfade, Notion-Datenbanken oder Notion-File-Uploads. Keine Google-Drive-, Notion- oder Lovable-Cloud-Flows als MVP-Kern.
- **LearnWeb-Zugriff**: Der Zugriff auf das LearnWeb ist strikt read-only. Es wird nichts zurückgeschrieben.
- **Credentials**: Passwörter und Zugangsdaten werden ausschließlich in der macOS Keychain (Schlüsselbund) gesichert. Keine Klartext-Credentials in `.env`, der SQLite-DB oder Logs.
- **Zustand (State)**: Der Anwendungszustand wird in einer lokalen SQLite-Datenbank verwaltet.
- **Output**: Die synchronisierten Vorlesungsdateien werden in einer lokalen Ordnerstruktur abgelegt. Aufzeichnungstranskripte werden als Markdown-Dateien (.md) ausgegeben.
- **MCP-Schnittstelle**: Der Model Context Protocol (MCP) Connector ist optional, lokal, stdio-basiert, muss explizit vom Nutzer im Dashboard aktiviert werden und ist nicht auf die lokal ausgewählte Sync-Auswahl beschränkt (sondern erlaubt kontoweiten Lesezugriff).
- **Referenzspezifikationen**: Folgende Dokumente sind die kanonische Projektbeschreibung und für Agenten bindend:
  - [docs/NORDSTERN.md](docs/NORDSTERN.md) (Produktziel und Datenschutzmodell)
  - [docs/MVP1_SCOPE.md](docs/MVP1_SCOPE.md) (Harte Scope-Grenzen und Tabellen-Zustände)
  - [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (App-Modell, Modulzuständigkeiten und SQLite-Schema)
  - [docs/SETUP_FLOW.md](docs/SETUP_FLOW.md) (9 Schritte des Setup-Wizards)

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
