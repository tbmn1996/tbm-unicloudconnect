# Sondierung: Output-Adapter für Note-Taking-Apps

> **Status**: Sondierung / Pre-Planning  
> **Scope**: Post-MVP 1 — Kein Code in MVP 1, nur Designgrundlage.  
> **Referenz**: [learnweb_sync](https://github.com/tbmn1996/learnweb_sync) als Vorgängerprojekt mit Notion-Push.

---

## 1. Motivation

MVP 1 speichert alle Outputs (heruntergeladene Dateien + Transkript-Markdown) ausschließlich in
einem lokalen Ordner auf der Platte des Nutzers (`profiles.default_library_path`). Das genügt für
den Offline-Zugriff, spiegelt aber nicht den realen Workflow vieler Nutzer wider, die ihre
Vorlesungsunterlagen direkt in persönlichen Note-Taking-Apps (Notion, Obsidian, …) organisieren.

**Ziel**: Der Nutzer soll im Dashboard eine Note-Taking-App als **Output-Target** konfigurieren
können, sodass synchronisierte Inhalte (Dateien + Transkripte) dort direkt landen — zusätzlich zu
oder anstelle des lokalen Ordners.

---

## 2. Design-Entscheidungen (fixiert)

| Frage | Entscheidung |
|---|---|
| **Erstes Target** | Notion (konsistent mit learnweb_sync) |
| **Datei-Handling** | Dateien als Attachment in die Ziel-App hochladen; Transkripte als native Seiten/Notes |
| **Lokaler Ordner** | Nutzer wählt: lokaler Ordner ODER Note-Taking-App ODER beides |
| **Transkript-Ausgabe** | Direkt als Seite/Note in der Ziel-App (kein .md-File-Upload) |
| **Multi-Target** | Maximal eine Ziel-App (plus optionaler lokaler Ordner) |
| **Credentials** | Adapter-Secrets (z. B. Notion-Token) → macOS Keychain; IDs und Mappings → SQLite `settings`-Tabelle |
| **DB-Struktur (Notion)** | Adapter-interne Sache, nicht im Vertrag festgelegt |

---

## 3. Ist-Zustand in MVP 1

### 3.1 Output-Pfad im Code

Der lokale Output wird aktuell durch drei Dateien im `src/local-library/`-Modul gesteuert:

| Datei | Zuständigkeit |
|---|---|
| [`paths.ts`](../src/local-library/paths.ts) | `buildRelativeLibraryPath()` — erzeugt `Semester/Kurs/Section/Datei`-Pfade |
| [`store.ts`](../src/local-library/store.ts) | `storeFile()` — schreibt Bytes atomar ins Filesystem mit Hash-Deduplizierung |
| [`access.ts`](../src/local-library/access.ts) | `checkLibraryPath()` — prüft Schreibrechte auf den Zielordner |

**Kernbeobachtung**: `storeFile()` ist ein reiner Filesystem-Writer. Es gibt keine Abstraktion
über das Output-Ziel — der Sync-Engine ruft `storeFile()` direkt mit `rootPath` + `relativePath`
auf. Transkripte werden vom Python-Worker ebenfalls direkt als `.md`-Datei ins Filesystem geschrieben.

### 3.2 Relevante Entitäten

- **`file_assets`-Tabelle**: Speichert `local_path` (relativ zum Library-Root). Müsste um ein
  optionales `adapter_ref` oder `remote_id` erweitert werden, um den Sync-Zustand zur Ziel-App zu
  tracken.
- **`transcript_jobs`-Tabelle**: `transcript_local_path` zeigt auf die `.md`-Datei. Analog müsste
  ein `remote_ref` dazu.
- **`profiles`-Tabelle**: `default_library_path` ist der einzige Output-Pfad. Kein Konzept für
  alternative Targets.
- **`settings`-Tabelle**: Key-Value-Store, geeignet für Adapter-Konfiguration (DB-IDs, Mappings).

### 3.3 Transkripte in learnweb_sync (Referenz)

Im Vorgängerprojekt werden Transkripte als **Notion-Seiten** in der Inhalts-Datenbank angelegt.
Der Transkripttext wird als Notion-Blocks formatiert, nicht als File-Upload. Das ist der
angestrebte Weg auch für UniCloudConnect.

---

## 4. Konzept: Output-Adapter-Schicht

### 4.1 Adapter-Verantwortlichkeiten

Ein Output-Adapter übernimmt zwei Aufgaben:

1. **Datei-Platzierung** (`placeFile`): Nimmt eine heruntergeladene Datei (Bytes + Metadaten) und
   platziert sie im Zielsystem (Filesystem: Datei schreiben; Notion: Seite erstellen + Attachment
   hochladen).

2. **Transkript-Platzierung** (`placeTranscript`): Nimmt ein fertiges Transkript (strukturierter
   Markdown + Metadaten) und erstellt daraus eine native Repräsentation im Zielsystem (Filesystem:
   `.md`-Datei schreiben; Notion: Notion-Seite mit Blocks erstellen).

### 4.2 Adapter-Auswahl

```
┌─────────────────────┐
│   Sync Engine /     │
│   Transcription     │
│   Worker            │
│                     │
│   ↓ placeFile()     │
│   ↓ placeTranscript │
└────────┬────────────┘
         │
    ┌────▼────┐
    │ Router  │ ← Liest Nutzer-Konfiguration
    └────┬────┘
         │
    ┌────┴─────────────────────────┐
    │                              │
    ▼                              ▼
┌──────────────┐          ┌───────────────┐
│ Filesystem-  │          │ Notion-       │
│ Adapter      │          │ Adapter       │
│ (MVP 1)      │          │ (Post-MVP 1)  │
└──────────────┘          └───────────────┘
```

Der **Router** entscheidet basierend auf der Nutzer-Konfiguration, an welche(n) Adapter
weitergeleitet wird:

- **Nur lokaler Ordner** (MVP 1 Default): Nur Filesystem-Adapter aktiv.
- **Nur Ziel-App**: Nur Notion-Adapter (o. Ä.) aktiv, kein lokaler Ordner.
- **Beides**: Router leitet an beide Adapter weiter (Fan-out).

### 4.3 Adapter-Konfiguration in der Datenbank

Adapter-spezifische Einstellungen werden in der bestehenden `settings`-Tabelle als Key-Value-Paare
gespeichert. Sensible Werte (Tokens) in der macOS Keychain.

**Beispiel-Keys für Notion:**

| Key | Wert | Speicherort |
|---|---|---|
| `output.adapter` | `"filesystem"` \| `"notion"` \| `"both"` | settings-Tabelle |
| `output.notion.lw_db_id` | Notion-Datenbank-ID für Inhalte | settings-Tabelle |
| `output.notion.courses_db_id` | Notion-Datenbank-ID für Kurse (optional) | settings-Tabelle |
| `output.notion.course_map` | JSON-Mapping `{ "lw_shortname": "notion_label" }` | settings-Tabelle |
| Notion API Token | `secret_xxx…` | macOS Keychain |

### 4.4 Tracking des Remote-Zustands

Damit der Sync idempotent bleibt (keine Duplikate bei erneutem Lauf), muss der Adapter-Zustand
pro Datei/Transkript getrackt werden:

**Option A — Eigene Spalten in bestehenden Tabellen:**

```sql
ALTER TABLE file_assets ADD COLUMN remote_ref TEXT;      -- z. B. Notion Page-ID
ALTER TABLE file_assets ADD COLUMN remote_pushed_at TEXT; -- Zeitstempel des Pushes
ALTER TABLE transcript_jobs ADD COLUMN remote_ref TEXT;
ALTER TABLE transcript_jobs ADD COLUMN remote_pushed_at TEXT;
```

**Option B — Eigene Junction-Tabelle (sauberer bei mehreren Adaptern):**

```sql
CREATE TABLE output_refs (
  id           INTEGER PRIMARY KEY,
  entity_type  TEXT NOT NULL,       -- 'file_asset' | 'transcript'
  entity_id    INTEGER NOT NULL,    -- FK auf file_assets.id oder transcript_jobs.id
  adapter      TEXT NOT NULL,       -- 'filesystem' | 'notion' | 'obsidian'
  remote_ref   TEXT,                -- Adapter-spezifische ID (Notion Page-ID, etc.)
  pushed_at    TEXT,
  UNIQUE(entity_type, entity_id, adapter)
);
```

**Empfehlung**: Option A für den Start (maximal ein Adapter, einfacher). Option B, falls
Multi-Adapter später doch kommt.

---

## 5. Auswirkungen auf MVP 1 Code

### 5.1 Was jetzt schon vorbereitet werden KÖNNTE (aber nicht MUSS)

> Diese Punkte sind **keine MVP-1-Anforderungen**. Sie dokumentieren lediglich, wo eine spätere
> Refaktorierung am wenigsten schmerzhaft wäre.

1. **`storeFile()` hinter ein Interface stellen**: Aktuell ruft die Sync-Engine `storeFile()`
   direkt auf. Wenn diese Funktion stattdessen über ein `OutputTarget`-Interface aufgerufen würde,
   ließe sich der Notion-Adapter später ohne Änderungen an der Sync-Engine einstecken.

2. **Transkript-Output entkoppeln**: Der Transcription-Worker schreibt die `.md`-Datei direkt.
   Wenn stattdessen der Main-Prozess den fertigen Markdown-String empfängt und an einen
   `placeTranscript()`-Aufruf weitergibt, wäre der Adapter-Einbau trivial.

3. **`settings`-Tabelle mit Namespace-Konvention**: Die vorhandene Key-Value-Tabelle ist bereits
   geeignet. Eine Konvention wie `output.*`-Prefix für Adapter-Config würde reichen.

### 5.2 Was NICHT in MVP 1 geändert werden soll

- Kein Notion SDK (`@notionhq/client`) als Dependency.
- Keine UI-Elemente für Adapter-Konfiguration im Setup-Wizard oder Dashboard.
- Keine zusätzlichen Tabellen oder Schema-Migrationen für `output_refs`.
- Keine Änderungen an den IPC-Kanälen für Adapter-Management.

---

## 6. Notion-Adapter: Grobe Architektur (Post-MVP 1)

### 6.1 Dateifluss

```
Heruntergeladene Datei (Bytes + Metadaten)
    │
    ▼
NotionAdapter.placeFile()
    │
    ├─ 1. Kurs in Notion-Kursdatenbank suchen/anlegen
    │     (falls courses_db_id konfiguriert)
    │
    ├─ 2. Inhalts-Seite in Notion-Inhaltsdatenbank erstellen
    │     - Properties: Kursname, Semester, Sektion, Dateiname, Typ, Datum
    │
    └─ 3. Datei als Attachment an die Notion-Seite anhängen
          (Notion File-Upload via Blocks API)
```

### 6.2 Transkript-Fluss

```
Fertiger Transkript-Markdown + Metadaten
    │
    ▼
NotionAdapter.placeTranscript()
    │
    ├─ 1. Notion-Seite erstellen mit Properties
    │     (Kursname, Aufzeichnungstitel, Datum, Modell, Dauer)
    │
    └─ 2. Transkript-Text als Notion-Blocks einfügen
          (Paragraphs, Headings — kein File-Upload)
```

### 6.3 Credential-Flow

```
Dashboard → „Notion verbinden"
    │
    ├─ 1. Nutzer gibt Notion Integration Token ein
    │     (Internal Integration, kein OAuth)
    │
    ├─ 2. Token wird in macOS Keychain gespeichert
    │     (credential_refs: provider = "notion")
    │
    ├─ 3. Test-API-Call (z. B. Datenbanken auflisten)
    │
    └─ 4. Nutzer wählt/erstellt Ziel-Datenbank(en)
          → IDs werden in settings-Tabelle gespeichert
```

---

## 7. Spätere Erweiterungen (Horizon)

| Target | Aufwand | Besonderheiten |
|---|---|---|
| **Obsidian** | Niedrig | Reiner Filesystem-Adapter in einen Vault-Ordner; kein API-Key nötig. Transkripte als `.md`-Dateien mit Obsidian-Frontmatter (YAML). |
| **Apple Notes** | Mittel | AppleScript/Shortcuts-Automation; kein offizielles SDK. |
| **Logseq** | Niedrig | Filesystem-basiert wie Obsidian, aber anderes Markdown-Format (Outline). |
| **Capacities** | Mittel | REST API, strukturierte Objekte statt Seiten. |

---

## 8. Offene Fragen für die spätere Planung

1. **Fehlerbehandlung**: Was passiert, wenn der Notion-Upload fehlschlägt, aber die lokale Datei
   schon geschrieben wurde? → Retry-Queue oder separater Push-Job?

2. **Rückwärts-Sync**: Wenn ein Nutzer von „nur lokal" auf „Notion" wechselt — sollen bestehende
   Dateien nachträglich gepusht werden? (Backfill)

3. **Rate Limits**: Notion API hat Rate Limits (3 req/s). Wie wird die Push-Queue gedrosselt?

4. **Notion-Datenbank-Schema**: Soll die App die Notion-Datenbank automatisch erstellen (mit
   definierten Properties) oder eine vorhandene DB des Nutzers nutzen? learnweb_sync setzt eine
   manuell angelegte DB voraus.

5. **Dateigrößen-Limits**: Notion erlaubt max. 5 MB pro File-Upload (Integration API). Große PDFs
   müssten entweder nur als Link oder gar nicht gepusht werden.

6. **Konflikterkennung**: Wenn der Nutzer eine Notion-Seite manuell löscht, soll die App sie beim
   nächsten Sync wiederherstellen?

---

## 9. Zusammenfassung

Das Output-Adapter-Konzept lässt sich sauber auf den MVP-1-Code aufsetzen, da die Output-Logik
bereits in einem eigenen Modul (`local-library`) isoliert ist. Die Hauptarbeit wird sein:

1. Ein `OutputTarget`-Interface vor `storeFile()` / Transkript-Output zu stellen.
2. Einen Router zu bauen, der basierend auf der Nutzerkonfiguration an den richtigen Adapter
   dispatched.
3. Den Notion-Adapter als ersten konkreten Remote-Adapter zu implementieren.
4. Dashboard-UI für Adapter-Konfiguration zu bauen (Token-Eingabe, DB-Auswahl).

Die bestehende `settings`-Tabelle und die macOS Keychain decken die Konfigurationsspeicherung ab.
Das SQLite-Schema braucht minimal ein `remote_ref`-Feld in `file_assets` und `transcript_jobs`.
