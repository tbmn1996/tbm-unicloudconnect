# TBM UniCloudConnect

Lokaler, read-only LearnWeb-Sync für macOS (TypeScript-Module: LearnWeb-Core, Sync-Engine, Local-Library, MCP). 

Dieses Repository dient als saubere, local-first Spezifikation und Implementierung für den LearnWeb-Abgleich auf macOS. MVP 1 ist komplett entkoppelt von Notion und läuft als Hintergrunddienst mit einem Menüleisten-Icon und einem vollwertigen Dashboard.

## Produktspezifikation & Nordstern

Die kanonischen Anforderungen und Design-Entscheidungen des Projekts sind im Repository dokumentiert:

* 📄 **[docs/NORDSTERN.md](file:///Users/thomasniermann/Scripts/tbm-unicloudconnect/docs/NORDSTERN.md)**: Produktziel, Zielgruppen und der übergeordnete Funktionsanspruch.
* 🎯 **[docs/MVP1_SCOPE.md](file:///Users/thomasniermann/Scripts/tbm-unicloudconnect/docs/MVP1_SCOPE.md)**: Harte Scope-Grenzen (Was ist drin, was bleibt draußen).
* 🏛️ **[docs/ARCHITECTURE.md](file:///Users/thomasniermann/Scripts/tbm-unicloudconnect/docs/ARCHITECTURE.md)**: Das App-Modell, die Modul-Zuständigkeiten und die Datenflüsse.
* ⚙️ **[docs/SETUP_FLOW.md](file:///Users/thomasniermann/Scripts/tbm-unicloudconnect/docs/SETUP_FLOW.md)**: Ablauf und Design des 9-Schritt Setup-Wizards.
* 📝 **[docs/adr/0001-macos-local-first-no-notion.md](file:///Users/thomasniermann/Scripts/tbm-unicloudconnect/docs/adr/0001-macos-local-first-no-notion.md)**: Architekturentscheidung zu macOS-only, Local-first und Notion-Ausschluss.

---

## Status

Reines Scaffold, Spezifikationsphase abgeschlossen. 
Offene Architekturentscheidungen (z. B. konkrete GUI-Shell wie Tauri, Electron oder native Swift/SwiftUI) sind in der Spezifikation festgehalten.

## Architektur (Module)

| Modul | Pfad | Verantwortlich für |
|---|---|---|
| LearnWeb Core | `src/learnweb-core/` | Login, Session, Kursliste/-struktur, Aktivitätsparser |
| Sync Engine | `src/sync-engine/` | Auswahl auswerten, Jobs, Downloads, Retry, SQLite-Status |
| Local Library | `src/local-library/` | Dateipfade, Hashing/Dedupe, lokale Bibliothek |
| MCP-Modul | `src/mcp/` | optionaler, read-only MCP-Connector für Claude/Codex |
| Transcription Worker | `transcription-worker/` | isolierter Python-Worker, Aufzeichnung -> Markdown |
| App Shell / GUI | -- | noch nicht gescaffoldet (Tech-Entscheidung offen) |

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

Dependencies werden erst nach expliziter Freigabe installiert.
