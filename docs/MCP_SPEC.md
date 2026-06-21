# Spezifikation: Model Context Protocol (MCP) Modul

Dieses Dokument beschreibt die exakten Werkzeuge (Tools) und Spezifikationen des optionalen, lokalen MCP-Moduls von TBM UniCloudConnect. Das Modul basiert auf dem stdio-Transport und stellt read-only Werkzeuge zur Verfügung, mit denen KI-Agenten (wie Claude oder Codex) direkt auf das LearnWeb-Profil des Nutzers zugreifen können.

---

## Sicherheits- & Verwendungsprinzipien

* **Optional**: Das Modul ist standardmäßig deaktiviert und muss vom Anwender im Dashboard explizit eingeschaltet werden.
* **Keine Scope-Einschränkung**: Der MCP-Zugriff ist *nicht* auf die lokal für den Synchronisationslauf ausgewählten Kurse beschränkt, sondern ermöglicht einen lesenden Zugriff auf das gesamte LearnWeb-Konto des Nutzers.
* **Read-only**: Alle Werkzeuge sind strikt lesend implementiert. Es gibt keine Schreibwerkzeuge.
* **Local-only**: Die Kommunikation läuft rein lokal über stdio zwischen der App (bzw. dem Dämon) und dem KI-Client auf dem Rechner des Nutzers.

---

## Verfügbare MCP-Tools

Das Modul stellt folgende 9 Werkzeuge bereit:

### 1. `learnweb-get-courses`
* **Beschreibung**: Listet alle Kurse auf, die auf dem LearnWeb-Dashboard des Nutzers sichtbar sind.
* **Eingabe-Parameter**: Keine.
* **Ausgabe**: Liste von Kursen mit `course_id`, `fullname`, `shortname` und `course_url`.

### 2. `learnweb-get-course-overview`
* **Beschreibung**: Liefert die Wochen-/Themenstruktur und alle darin enthaltenen Aktivitäten eines Kurses.
* **Eingabe-Parameter**:
  * `course_id` (Zahl, Pflicht): Die numerische Moodle-Kurs-ID.
* **Ausgabe**: Liste der Abschnitte mit Namen und den darin liegenden Aktivitäten (cmids, Modultypen, Namen).

### 3. `learnweb-read-activity`
* **Beschreibung**: Liest Details einer einzelnen Aktivität strukturiert aus (z. B. Forum-Beiträge, Ordner-Inhalte, Links oder Seiten-Texte). *Hinweis: Dateien werden hierbei nicht heruntergeladen, Ressourcen liefern nur eine `download_url` zurück.*
* **Eingabe-Parameter**:
  * `cmid` (Zahl, Pflicht): Die Moodle Course Module ID.
  * `modtype` (Text, Pflicht): Moodle-Modultyp (z. B. `resource`, `folder`, `url`, `page`, `forum`, `assign`).
  * `limit` (Zahl, optional): Maximale Anzahl von Forendiskussionen bei Paginiation.
  * `offset` (Zahl, optional): Offset für Foren-Pagination.
* **Ausgabe**: Inhaltstyp-spezifische strukturierte Textdaten.

### 4. `learnweb-read-quiz-review`
* **Beschreibung**: Liest die Detail-Auswertung (Fragen, eigene Antworten, richtige Antworten, Punkte) eines eigenen, bereits abgeschlossenen Quiz-Versuchs zur Fehleranalyse aus.
* **Eingabe-Parameter**:
  * `cmid` (Zahl, Pflicht): Moodle Course Module ID des Quizzes.
  * `attempt` (Zahl, Pflicht): Die ID des spezifischen Versuchs (aus der Review-URL).
* **Ausgabe**: Liste der Fragen mit Text, abgegebener Antwort und Erklärung der Musterlösung.

### 5. `learnweb-get-timeline`
* **Beschreibung**: Listet anstehende Abgaben, Quizzes und Kalender-Events kursübergreifend auf, sortiert nach Fälligkeitsdatum.
* **Eingabe-Parameter**:
  * `window_days` (Zahl, optional, Standard: 30): Suchfenster in Tagen (max. 90 Tage).
  * `modtypes` (Array aus Texten, optional): Filter nach Typ, z. B. `['quiz', 'assign']`.
  * `course_id` (Zahl, optional): Auf diesen Kurs einschränken.
  * `event_type` (Text, optional): Event-Typ (z. B. `due`, `open`, `close`).
* **Ausgabe**: Kalender-Ereignisse mit Datum, Kursbezug und Fälligkeit.

### 6. `learnweb-search-courses`
* **Beschreibung**: Durchsucht den globalen LearnWeb-Kurskatalog der Universität Münster.
* **Eingabe-Parameter**:
  * `query` (Text, Pflicht): Suchbegriff (2 bis 200 Zeichen).
  * `page` (Zahl, optional, Standard: 0): Ergebnisseite.
  * `limit` (Zahl, optional): Maximale Anzahl an Treffern.
* **Ausgabe**: Suchergebnisse mit Kursnamen, IDs und Beschreibungen.

### 7. `learnweb-get-page`
* **Beschreibung**: Liefert den bereinigten Textinhalt einer geschützten Moodle-Seite. Der Zugriff ist aus Sicherheitsgründen streng auf Pfade unter `/mod`, `/course`, `/calendar`, `/my` und `/blocks` beschränkt.
* **Eingabe-Parameter**:
  * `path` (Text, Pflicht): Relativer Pfad im LearnWeb (z. B. `/mod/forum/view.php?id=123`).
* **Ausgabe**: Bereinigter HTML-zu-Text-Inhalt.

### 8. `learnweb-get-calendar-month`
* **Beschreibung**: Liefert alle Kalender-Einträge für einen bestimmten Monat. Nützlich, wenn Deadlines weit in der Zukunft liegen.
* **Eingabe-Parameter**:
  * `year` (Zahl, optional): Jahr (z. B. 2026).
  * `month` (Zahl, optional): Monat (1-12).
  * `course_id` (Zahl, optional): Kurs-Filter.
* **Ausgabe**: Monatskalender-Einträge.

### 9. `learnweb-download-resource`
* **Beschreibung**: Authentifizierter Download einer Datei über eine Moodle-Pluginfile-URL unter Nutzung der aktiven Sitzung.
* **Eingabe-Parameter**:
  * `url` (Text, Pflicht): Die absolute Moodle-Pluginfile-URL (aus einem vorherigen Aufruf von `learnweb-read-activity`).
  * `max_bytes` (Zahl, optional, Standard: 3 MB, Hard-Limit: 25 MB): Größenbeschränkung der heruntergeladenen Datei.
* **Ausgabe**: Dateiname, Mime-Type und die Dateiinhalte als Base64-Blob.
