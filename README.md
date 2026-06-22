# TBM UniCloudConnect

Lokaler, read-only LearnWeb-Sync für macOS (TypeScript-Module: LearnWeb-Core, Sync-Engine, Local-Library, MCP). 

Dieses Repository dient als saubere, local-first Spezifikation und Implementierung für den LearnWeb-Abgleich auf macOS. MVP 1 ist komplett entkoppelt von Notion und läuft als Hintergrunddienst mit einem Menüleisten-Icon und einem vollwertigen Dashboard.

## Produktspezifikation & Nordstern

Die kanonischen Anforderungen und Design-Entscheidungen des Projekts sind im Repository dokumentiert:

* 📄 **[docs/NORDSTERN.md](docs/NORDSTERN.md)**: Produktziel, Zielgruppen und der übergeordnete Funktionsanspruch.
* 🎯 **[docs/MVP1_SCOPE.md](docs/MVP1_SCOPE.md)**: Harte Scope-Grenzen (Was ist drin, was bleibt draußen).
* 🏛️ **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: Das App-Modell, die Modul-Zuständigkeiten und die Datenflüsse.
* ⚙️ **[docs/SETUP_FLOW.md](docs/SETUP_FLOW.md)**: Ablauf und Design des 8-Schritt Setup-Wizards.
* 🔌 **[docs/MCP_SPEC.md](docs/MCP_SPEC.md)**: Technische Spezifikation der 9 read-only MCP-Tools.
* 📝 **[docs/adr/0001-macos-local-first-no-notion.md](docs/adr/0001-macos-local-first-no-notion.md)**: Architekturentscheidung zu macOS-only, Local-first und Notion-Ausschluss.

---

## Status

Lauffähige Electron-App vorhanden: Statusbar, 8-Schritt-Setup-Wizard und Dashboard, Keychain-Login,
Kursauswahl, SQLite-Zustand und Datei-Sync mit SHA-256-Deduplizierung. Lokale Transkription
(Apple Silicon: MLX Whisper, Intel: faster-whisper) sowie der optionale MCP-Connector mit neun
read-only Tools sind verdrahtet und im Dashboard steuerbar. Scheduler und Autostart folgen separat.

## Architektur (Module)

| Modul | Pfad | Verantwortlich für |
|---|---|---|
| LearnWeb Core | `src/learnweb-core/` | Login, Session, Kursliste/-struktur, Aktivitätsparser |
| Sync Engine | `src/sync-engine/` | Auswahl auswerten, Jobs, Downloads, Retry, SQLite-Status |
| Local Library | `src/local-library/` | Dateipfade, Hashing/Dedupe, lokale Bibliothek |
| Datenlayer | `src/db/` | SQLite-Schema, Migrationen und Repositories |
| App Shell | `src/main/`, `src/preload/` | Electron-Lifecycle, Statusbar, Fenster und IPC |
| Dashboard | `src/renderer/` | React-Setup-Wizard und Dashboard |
| MCP-Modul | `src/mcp/` | optionaler read-only MCP-Connector über stdio und lokales SSE |
| Transcription Manager | `src/transcription/` | Scan, Queue, Retry, Worker-Lifecycle und sichere Medienübergabe |
| Transcription Worker | `transcription-worker/` | isolierter Python-Worker, Aufzeichnung -> Markdown |

Wiederverwendbare Logik (read-only Referenzen): `AgentTools/tbmn-learnweb-connector` (TS: Session/Cookie/Parser/MCP), `learnweb_sync` (Python: State/Dedupe/Transkription).

## Befehle

| Zweck | Kommando |
|---|---|
| setup | `npm install` |
| run | `npm run dev` |
| test | `npm test` |
| lint | `npm run lint` |
| typecheck | `npm run typecheck` |
| build | `npm run build` |
| SQLite für Electron bauen | `npm run rebuild:electron` |
| SQLite für Node-Tests zurückbauen | `npm run rebuild:node` |

`better-sqlite3` ist ein natives Modul. Vor `npm run dev` muss es für Electron gebaut sein;
für direkte Node-Tests anschließend bei Bedarf wieder mit `npm run rebuild:node`.
