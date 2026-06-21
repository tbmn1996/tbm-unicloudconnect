# Architektur-Entwurf (Draft)

## 1. Lokaler State & SQLite-Datenbankschicht

Die Datenbank bildet die *Single Source of Truth* für den gesamten App-Zustand, den Verlauf und die Einstellungen. Sie speichert keine Passwörter, sondern nur Metadaten und Referenzen.

- **Zielordner:** Wird im `index.ts` verwaltet.
- **Hauptaufgaben:**
  - Initialisierung einer lokalen SQLite-Datenbank (z. B. via `better-sqlite3` oder `sqlite3` in TypeScript).
  - Erstellung des relationalen Schemas laut PRD:
    - `profiles` (Nutzerprofil und Standard-Bibliothekspfad)
    - `credential_refs` (Referenzen auf Keychain-Einträge)
    - `courses` (Gefundene LearnWeb-Kurse)
    - `activities` (Einzelne Ressourcen, URLs, Ordner, Videos im Kurs)
    - `selection_rules` (Welche Kurse/Abschnitte synchronisiert oder transkribiert werden)
    - `file_assets` (Metadaten und Pfade lokal heruntergeladener Dateien)
    - `sync_runs`, `download_jobs` & `transcript_jobs` (Verlauf und Job-Queue)
    - `settings` (Globale Einstellungen wie Sync-Frequenz, Größenlimits)
- **Wiederverwendung:** Das Manifest- und State-Konzept aus `learnweb_sync.py` dient als funktionale Vorlage für die SQLite-Struktur.

---

## 2. Sicherheits- & Credentials-Modul (macOS Keychain)

Da die App ohne eigene Cloud läuft und `.env`-Dateien für Endnutzer ungeeignet sind, müssen Zugangsdaten sicher auf dem System verwahrt werden.

- **Zielordner:** Teil des Authentifizierungs-Flows in `index.ts`.
- **Hauptaufgaben:**
  - Anbindung an die native macOS Keychain via Node.js-Bindings (z. B. `keytar` oder ein schlankes Shell-Wrapper-Modul über `security`), um den LearnWeb-Nutzernamen und das Passwort sicher abzulegen.
  - Implementierung von Funktionen zur Credential-Prüfung und zum rückstandslosen Löschen ("Logout").
  - Sicherstellung der Fehlerhygiene: Zugangsdaten dürfen niemals in SQLite-States, Log-Dateien oder API-Antworten auftauchen.
- **Wiederverwendung:** Der Keychain-Ansatz aus `tbmn-learnweb-connector` wird als TS-Modul adaptiert.

---

## 3. LearnWeb-Core (Parser & HTTP-Client)

Dieser Bereich übernimmt die direkte, read-only Kommunikation mit dem LearnWeb der Uni Münster.

- **Zielordner:** `index.ts`.
- **Hauptaufgaben:**
  - Login-Handhabung und Session-/Cookie-Erneuerung (Moodle-Session-Handling).
  - Abrufen und Parsen der Kursübersichtsseite (Dashboard) zur Erfassung aller belegten Kurse.
  - Parsen der Kursinhalte (Wochen/Themen) und Identifikation der Aktivitäten (cmid-basiert) inklusive Typklassifizierung (`Resource`, `Folder`, `Page`, `URL`, `Opencast`).
  - Bereitstellung von sicheren Download-URLs für Dateiobjekte.
- **Wiederverwendung:** Fast das gesamte Session- und Parser-Tooling kann direkt aus dem TypeScript-Code von `src` übernommen werden.

---

## 4. Lokale Bibliothek (Local Library)

Verwaltet den Dateispeicherort auf dem Mac, die Benennung der Ordner und die Deduplizierung.

- **Zielordner:** `index.ts`.
- **Hauptaufgaben:**
  - Erstellung der Ordnerhierarchie (z. B. `TBM UniCloudConnect/Semester/Kursname/Abschnitt/`).
  - Normalisierung von Kurs- und Dateinamen (Entfernen von macOS-ungültigen Sonderzeichen).
  - Hashing-Funktion (z. B. SHA-256) zur Erkennung von inhaltlichen Änderungen an bereits heruntergeladenen Dateien (Deduplizierung).
  - Logisches Behandeln von gelöschten LearnWeb-Dateien (lokale Kopien werden nicht gelöscht, sondern in der DB auf `removed` bzw. `not_seen_recently` gesetzt).
- **Wiederverwendung:** Die Deduplizierungs- und Normalisierungsregeln aus `learnweb_sync.py` dienen hier als Vorlage.

---

## 5. Sync-Engine (Zustands- & Download-Orchestrator)

Das Gehirn des Backends, das die Cloud-Struktur mit dem lokalen Dateisystem abgleicht und die eigentliche Arbeit verrichtet.

- **Zielordner:** `index.ts`.
- **Hauptaufgaben:**
  - Auswertung der aktiven `selection_rules` des Users.
  - Vergleich der aktuellen LearnWeb-Struktur (aus Schritt 3) mit dem Datenbank-State (Schritt 1) zur Erkennung neuer oder geänderter Inhalte.
  - Erstellung von Download- und Transkriptions-Jobs in der Datenbank.
  - Ausführen der Downloads mit Limitierung (z. B. max. 3 parallele Verbindungen, um LearnWeb nicht zu überlasten) und Größenbeschränkung (z. B. Warnung ab 100 MB).
  - Fehlerbehandlung & Retry-Logik (Klassifizierung in temporäre vs. permanente Fehler).
- **Wiederverwendung:** Der Sync-Ablauf und die Download-Pipeline-Erfahrungen aus `learnweb_sync.py`.

---

## 6. Transkriptions-Worker (Python-Integration)

Dieser Teil verarbeitet Audio-/Video-Aufzeichnungen (z. B. Opencast) in lesbare Markdown-Dateien. Er läuft isoliert, damit die App auch ohne Transkription benutzbar bleibt.

- **Zielordner:** (isoliertes Python-Submodul).
- **Hauptaufgaben:**
  - Herunterladen der Medienquellen (falls nicht bereits lokal).
  - Extraktion der Audiospuren.
  - Transkription über ein lokales Python-Modell (z. B. Whisper) oder externe APIs.
  - Speicherung der Transkripte als strukturierte `.md`-Dateien mit standardisierten Metadaten (Kurs, Aktivität, Quelle, Datum, Modell) im Zielverzeichnis.
  - TS-to-Python-Schnittstelle (Steuerung des Python-Prozesses via Subprocess oder Status-Polling über die SQLite-DB).
- **Wiederverwendung:** Der komplette Transkriptions-Stack aus `transcription`.

---

## 7. Lokale Dienst-API (HTTP-Server)

Damit der Clickdummy und spätere App-Shells (wie Tauri oder Electron) mit dem Backend kommunizieren können, stellt die App eine lokale HTTP-API bereit.

- **Zielordner:** Ausbau von `index.ts`.
- **Hauptaufgaben:**
  - Bereitstellung von REST-Endpoints (bzw. JSON-RPC) für das UI:
    - **Setup-Flow:** Login testen, Credentials speichern, Zielverzeichnis setzen.
    - **Dashboard-Daten:** Sync-Status, Fortschritts-Prozent, Fehlerlogs, Liste der Kurse und Dateiverzeichnis.
    - **Steuerung:** Synchronisation manuell starten, pausieren, Transkription triggern.
    - **Einstellungen:** Sync-Intervall ändern, Credentials entfernen.
  - Integration von Web-Sockets (oder Server-Sent Events SSE) für Echtzeit-Statusupdates im Dashboard (z. B. "Syncing file X of Y...").

---

## 8. Optionaler MCP-Server (Model Context Protocol)

Ein read-only Connector, der es KI-Agenten (wie Claude oder Codex) ermöglicht, direkt auf die gelernten und indizierten Vorlesungsmaterialien des Nutzers zuzugreifen.

- **Zielordner:** `index.ts`.
- **Hauptaufgaben:**
  - Implementierung des Model Context Protocol-Standards (stdio-basiert).
  - Bereitstellung von Tools zum Suchen, Lesen und Analysieren der lokalen Bibliothek und (read-only) des LearnWeb-Accounts.
  - Einhaltung des Sicherheitsprinzips: MCP-Zugriff ist optional und muss im Dashboard aktiviert werden.
- **Wiederverwendung:** MCP-Struktur aus `src`.