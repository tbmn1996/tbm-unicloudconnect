# TBM UniCloudConnect

Lokaler, read-only LearnWeb-Sync fuer macOS (TypeScript-Module: LearnWeb-Core, Sync-Engine, Local-Library, MCP). App-Shell/GUI-Technologie noch offen.

Produktspezifikation (Quelle): [Notion-PRD "TBM UniCloudConnect – Mac-only Statusbar-App MVP 1 ohne Notion"](https://www.notion.so/TBM-UniCloudConnect-Mac-only-Statusbar-App-MVP-1-ohne-Notion-386bf244cadc80678361e5b1828b6bdb)

## Status

Reines Scaffold, keine Implementierung. Offene Entscheidung laut PRD: App-Shell-Technologie (Swift/SwiftUI vs. Tauri vs. Electron) -- noch nicht festgelegt.

## Architektur (Module)

| Modul | Pfad | Verantwortlich fuer |
|---|---|---|
| LearnWeb Core | `src/learnweb-core/` | Login, Session, Kursliste/-struktur, Aktivitaetsparser |
| Sync Engine | `src/sync-engine/` | Auswahl auswerten, Jobs, Downloads, Retry, SQLite-Status |
| Local Library | `src/local-library/` | Dateipfade, Hashing/Dedupe, lokale Bibliothek |
| MCP-Modul | `src/mcp/` | optionaler, read-only MCP-Connector fuer Claude/Codex |
| Transcription Worker | `transcription-worker/` | isolierter Python-Worker, Aufzeichnung -> Markdown |
| App Shell / GUI | -- | noch nicht gescaffoldet (Tech-Entscheidung offen) |

Wiederverwendbare Logik (read-only Referenzen, nicht migriert): `AgentTools/tbmn-learnweb-connector` (TS: Session/Cookie/Parser/MCP), `learnweb_sync` (Python: State/Dedupe/Transkription).

## Stack

- Profil: `ts-service` (TypeScript-Service)
- Overlays: github-ci

## Befehle

| Zweck | Kommando |
|---|---|
| setup | `npm install` |
| run | `npm run dev` |
| test | `npm test` |
| lint | `npm run lint` |
| typecheck | `npm run typecheck` |
| build | `npm run build` |

Dependencies werden erst nach expliziter Freigabe installiert.

## Zugriffe

Siehe [`docs/ACCESS.md`](docs/ACCESS.md). Echte Secrets gehoeren in lokale oder verwaltete Secret-Stores und nie ins Repository.
