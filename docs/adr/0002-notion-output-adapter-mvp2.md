# ADR 0002: Aufhebung des Notion-Ausschlusses — Notion-Output-Adapter für MVP 2

* **Status**: Akzeptiert (Accepted)
* **Datum**: 2026-06-23
* **Beteiligte**: Thomas Niermann (User), Coding Assistant (Agent)
* **Bezug**: Hebt Punkt 2 von [ADR 0001](0001-macos-local-first-no-notion.md) auf; GitHub Issue [#23](https://github.com/tbmn1996/tbm-unicloudconnect/issues/23)

---

## 1. Kontext (Context)

ADR 0001 schloss Notion-Integration für MVP 1 explizit aus, sah aber selbst eine Exit-Klausel vor:
Falls Notion später zurückkommt, "muss dies als optionaler, modularer Export-Adapter implementiert
werden, anstatt als Kernbestandteil der Sync-Engine."

Ein vorab durchgeführter Feasibility-Check zu GitHub Issue #23 ("Epic: Notion Output-Adapter &
Database Synchronization") kam zu folgendem Ergebnis:

* Technisch additiv umsetzbar — der bestehende SQLite-Migrationsmechanismus (`PRAGMA user_version`
  + `MIGRATIONS`-Record in `src/db/db.ts`) verträgt neue Tabellen risikoarm.
* Kein bestehender Code-Stub vorhanden — komplettes Neuland (keine Notion-Dependencies, keine
  IPC-Channels, kein DB-Schema im aktuellen Code).
* Reuse-Potenzial vorhanden, aber teils überschätzt: Backend-Logik aus `learnweb_sync.py`
  (3679 Zeilen, echte Notion-API-Nutzung: Rate-Limiting, Property-Mapping, Page-Writes) ist real
  wiederverwendbar. Von den zwei behaupteten Frontend-Reuse-Quellen existiert `NotionSection.tsx`
  nirgends, `NotionDataSourcePicker.tsx` liegt nur noch in einem archivierten, aufgegebenen Projekt.
* Architektur-Fit: mittlerer bis großer Eingriff allein für den Adapter/Router-Teil — zwei
  unabhängige, heute hartcodierte Schreibpfade (Datei-Downloads via `src/local-library/store.ts`,
  Transkripte via `src/transcription/manager.ts`) müssten beide an einen Router angebunden werden;
  das bestehende Status-Modell (`ActivityStatus`, `DownloadJobStatus`, `TranscriptJobStatus`) ist
  einkanalig und bräuchte eine Erweiterung für ein zweites Output-Ziel.
* `docs/FUTURE_OUTPUT_ADAPTERS.md` enthält bereits eine passende Konzept-Skizze (Router +
  `OutputTarget`-Interface, Notion als erstes Remote-Target, Filesystem-Adapter bleibt Default).

Thomas hat entschieden: Der bisherige MVP-1-Rahmen ("keine Notion-Integration") ist für seine
aktuellen Bedürfnisse überholt. Die Notion-Anbindung ist der nächste Arbeitsschritt.

## 2. Entscheidung (Decision)

1. **Punkt 2 von ADR 0001 wird aufgehoben.** Notion-Integration ist ab jetzt ein geplanter, aktiver
   Bestandteil der Roadmap (informell "MVP 2" genannt), nicht mehr ausgeschlossen.
2. **Die übrigen Punkte von ADR 0001 bleiben unverändert gültig**: macOS-only, lokale SQLite-DB,
   macOS-Keychain für Credentials, Markdown-Transkripte als Default-Format. Diese ADR betrifft
   ausschließlich den Notion-Ausschluss.
3. **Umsetzung als optionaler Adapter, nicht als Kernbestandteil**: Die Sync-Engine bleibt
   local-first im Default. Notion wird über die in `docs/FUTURE_OUTPUT_ADAPTERS.md` Abschnitt 4
   skizzierte Output-Adapter-Schicht (Router + `OutputTarget`-Interface) angebunden — der
   Filesystem-Adapter bleibt aktiv, Notion ist ein zusätzliches, vom Nutzer explizit zu
   konfigurierendes Ziel.
4. **`docs/FUTURE_OUTPUT_ADAPTERS.md` wird von einer reinen Sondierung zur aktiven
   Design-Grundlage** für die Umsetzung. Offene Fragen aus dessen Abschnitt 8 (Fehlerbehandlung,
   Backfill, Rate Limits, Auto-DB-Erstellung, Dateigrößen-Limits, Konflikterkennung) müssen vor
   bzw. während der Implementierung der jeweiligen Sub-Issues geklärt werden.

## 3. Konsequenzen (Consequences)

### Positive Konsequenzen:
* Nutzer können Vorlesungsmaterial und Transkripte künftig optional direkt in Notion verfügbar
  machen — deckt die in ADR 0001 als "negative Konsequenz" benannte Lücke ("Cloud-Ansicht in
  Notion") ab.
* Die Umsetzung folgt der bereits vorbereiteten, sauberen Adapter/Router-Architektur statt einer
  Ad-hoc-Lösung.

### Negative Konsequenzen / Risiken:
* Notion-Integration bringt die in ADR 0001 Abschnitt 1 genannten Risiken zurück ins Projekt
  (Setup-Komplexität für Token/DB-Auswahl, Credential-Handling, API-Rate-Limits, Performance bei
  großen Uploads, Offline-Bruch für den Notion-Pfad). Diese Risiken werden nicht durch diese ADR
  gelöst, sondern müssen in der Implementierung der einzelnen Sub-Issues (Issue #23, Parts 1–7)
  adressiert werden.
* Zwei unabhängige Schreibpfade (`local-library/store.ts`, `transcription/manager.ts`) müssen beide
  umgebaut werden — größerer Eingriff als ein einzelner Interface-Cut.
* Reuse-Annahmen aus Issue #23 sind nur teilweise belastbar (Frontend-Reuse-Quellen
  unvollständig/veraltet) — der tatsächliche Aufwand könnte über der dort genannten Schätzung
  (3–4 Wochen) liegen.

## 4. Folgeschritte (nicht Teil dieser ADR)

* Code-Implementierung gemäß Issue #23 Sub-Issues, beginnend mit Part 1 (Keychain & Database
  Migrations).
* `docs/MVP1_SCOPE.md`, `docs/NORDSTERN.md`, `docs/FUTURE_OUTPUT_ADAPTERS.md` und die
  Projekt-`CLAUDE.md` wurden im selben Zug aktualisiert, um den neuen Stand widerzuspiegeln (siehe
  Commit-Historie).
