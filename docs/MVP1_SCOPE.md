# Scope: TBM UniCloudConnect MVP 1

Dieses Dokument definiert die harten Grenzen für die erste Ausbaustufe (MVP 1) der Anwendung. Dies soll verhindern, dass in zukünftigen Sessions unerwartet Cloud-Komponenten, Cross-Platform-Bibliotheken oder Notion-Anbindungen hinzugefügt werden.

---

## Scope-Abgrenzung

| Kategorie | In-Scope für MVP 1 | Out-of-Scope für MVP 1 |
|---|---|---|
| **Betriebssystem** | macOS (Apple Silicon & Intel) | Windows, Linux, iOS/Android |
| **Architektur** | Local-first, Offline-first, Standalone | Cloud-Backup, Multi-User-Datenbanken |
| **Credentials** | macOS Keychain (Schlüsselbund) | `.env`-Klartextdateien, Cloud-Vaults |
| **Persistenz** | Lokale SQLite-Datenbank | PostgreSQL, Firebase, Notion-DBs |
| **Notion** | **Keine Notion-Integration** | Notion-Seiten, Notion-Tabellen, Uploads |
| **Plattform** | Münster LearnWeb (feste URL intern) | Frei konfigurierbare LearnWeb-Instanzen |
| **Bedienung** | Grafischer Setup-Wizard & Dashboard | Reine CLI, manuelle `.env`-Konfiguration |
| **Hintergrund** | Statusbar-Menü zur schnellen Übersicht | Unsichtbare Dämonen ohne UI-Indikator |

---

## Statusübergänge & Definitionen

Die Synchronisations- und Download-Prozesse werden über fest definierte Zustände gesteuert, die in der lokalen SQLite-Datenbank persistiert werden.

### 1. Zustände für Kursaktivitäten (`activities.status`)
* `discovered`: Aktivität wurde im LearnWeb gefunden, aber noch nicht weiter verarbeitet.
* `selected`: Aktivität soll gemäß den Regeln synchronisiert werden.
* `ignored`: Aktivität wurde explizit vom Nutzer abgewählt oder ausgeschlossen.
* `download_pending`: Download-Job wurde für diese Aktivität erstellt.
* `downloaded`: Datei wurde erfolgreich lokal gespeichert.
* `deferred`: Download wurde aufgeschoben (z. B. wegen Größenbeschränkungen).
* `failed`: Download oder Verarbeitung ist fehlgeschlagen.
* `removed`: Aktivität existiert im LearnWeb nicht mehr, verbleibt aber lokal.

### 2. Zustände für Download-Jobs (`download_jobs.status`)
* `pending`: Job wartet in der Queue.
* `running`: Datei wird aktuell heruntergeladen.
* `done`: Download erfolgreich abgeschlossen.
* `failed_retryable`: Temporärer Fehler (z. B. Netzwerk-Timeout). Job wird wiederholt.
* `failed_permanent`: Permanenter Fehler (z. B. 404 Nicht Gefunden oder keine Berechtigung).
* `skipped_duplicate`: Download übersprungen, da eine identische Datei (gleicher Hash) bereits existiert.
* `skipped_too_large`: Datei überschreitet das voreingestellte Größenlimit.

### 3. Zustände für Transkriptionen (`transcript_jobs.status`)
* `pending`: Audio-/Videoaufzeichnung wartet auf Transkription.
* `claimed`: Job wurde vom Transkriptions-Worker reserviert.
* `downloading_media`: Mediendatei wird lokal heruntergeladen.
* `media_downloaded`: Mediendatei liegt lokal bereit.
* `transcribing`: Lokaler Transkriptions-Prozess läuft.
* `markdown_created`: Transkripttext wurde in Markdown-Datei überführt.
* `done`: Job erfolgreich abgeschlossen, temporäre Mediendateien bereinigt.
* `failed_retryable`: Temporärer Transkriptionsfehler (z. B. Speicherengpass).
* `failed_permanent`: Permanenter Transkriptionsfehler.

---

## Transkriptionsspezifikationen

Jedes erzeugte Transkript wird als eigenständige Markdown-Datei (`.md`) im Kursordner abgelegt. Die Datei muss folgenden standardisierten Header besitzen:

```markdown
# Transkript: [Aktivitätsname]

* **Kurs**: [Kursname (z. B. Informatik 2)]
* **Datum der Aufzeichnung**: [Datum]
* **Quelle**: [Link zur Original-Medienquelle im LearnWeb]
* **Transkribiert am**: [Datum des Sync-Laufs]
* **Modell**: [Modellbezeichnung, z. B. Whisper-base]
* **Dauer**: [Dauer der Aufzeichnung in Minuten]

---

[Hier folgt der eigentliche, nach Absätzen gegliederte Text des Transkripts...]
```
