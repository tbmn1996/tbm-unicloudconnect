# Nordstern: TBM UniCloudConnect

## Kurzfassung

**TBM UniCloudConnect** ist ein local-first Synchronisations-Werkzeug für macOS. Die Anwendung lädt ausgewählte Vorlesungs- und Studienmaterialien von der universitären Lernplattform (Münster LearnWeb) automatisch herunter, ordnet sie lokal in einer verständlichen Verzeichnisstruktur und transkribiert auf Wunsch Audio- und Videoaufzeichnungen in strukturierte Markdown-Dateien.

MVP 1 ist bewusst komplett unabhängig von Notion konzipiert und läuft als Hintergrunddienst über ein macOS-Statusbar-Icon, kombiniert mit einem vollwertigen Dashboard.

---

## Produktziel

Das Hauptziel ist es, Studierenden und Lehrenden einen schnellen, verlässlichen und offline-fähigen Zugriff auf ihre Lehrmaterialien zu geben, ohne dass sie manuell durch die Web-Oberfläche navigieren müssen. 

### Pflicht-Ergebnisse (MVP 1):
* **Lokale Ordnerstruktur**: Ordnung der Dateien nach Semester, Kurs und Thema/Woche.
* **Unterstützte Dateiformate**: PDFs, Skripte, ZIPs und sonstige Moodle-Dateien.
* **Transkripte**: Lokale Audio- und Videoaufzeichnungen (z. B. Opencast) werden in `.md`-Dateien transkribiert.
* **Lokale Metadaten**: Eine SQLite-Datenbank speichert Sync-Läufe, Dateipfade, Hashes und Statuswerte.
* **MCP-Connector**: Ein optionaler, read-only Schnittstellen-Connector (Model Context Protocol) erlaubt es KI-Systemen (wie Claude oder Codex), die lokalen Kursunterlagen abzufragen.

*Das Tool agiert strikt **read-only** gegenüber LearnWeb. Es werden keine Daten hochgeladen oder in LearnWeb verändert.*

---

## Zielnutzer

1. **Primäre Zielgruppe**:
   * Studierende der Universität Münster mit gültiger Kennung.
   * macOS-Nutzer, die einen nahtlosen, dateibasierten Offline-Zugriff wünschen.
   * Nicht-technische Anwender, die keine Konfigurationsdateien (`.env`) oder Terminal-Kommandos verwenden möchten.
2. **Sekundäre Zielgruppe**:
   * Technisch versierte Nutzer und Entwickler, die ihre Kursunterlagen mit lokalen LLMs (z. B. über den MCP-Connector) oder Notiz-Systemen (z. B. Obsidian) verknüpfen wollen.

---

## Datenschutz- & Vertrauensmodell

Da universitäre Zugangsdaten und Lehrmaterialien sensible Daten sind, basiert TBM UniCloudConnect auf einem strikt restriktiven Sicherheitsmodell:

* **Local-first & Local-only**: Alle heruntergeladenen Dateien und Datenbankeinträge verbleiben ausschließlich lokal auf dem Mac des Nutzers. Es gibt keine eigene Synchronisations-Cloud und keine Übertragung an fremde Server.
* **Sichere Zugangsdaten**: LearnWeb-Kennungen werden ausschließlich in der systemeigenen **macOS Keychain (Schlüsselbund)** verschlüsselt hinterlegt. Die Datenbank (SQLite) oder Konfigurationsdateien enthalten zu keinem Zeitpunkt Klartextpasswörter.
* **Transparenter Hintergrundbetrieb**: Der Sync- und Transkriptionsstatus ist jederzeit über das Symbol in der Menüleiste sichtbar. Es laufen keine verdeckten Hintergrundaktivitäten.
* **MCP-Sicherheit**: Die optionale MCP-Schnittstelle muss vom Anwender explizit freigegeben werden. Der Zugriff von KI-Agenten erfolgt rein lokal und nur, wenn die App aktiv läuft. Der MCP-Zugriff ist nicht automatisch auf die lokal synchronisierten Kurse beschränkt. Er ist ein optionaler, lokaler, read-only Zugriff auf das LearnWeb-Profil bzw. die lokal/indexierten Kursdaten und muss vom Nutzer bewusst aktiviert werden.
