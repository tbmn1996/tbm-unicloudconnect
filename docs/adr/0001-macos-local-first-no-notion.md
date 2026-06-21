# ADR 0001: macOS-only, Local-first und Notion-Ausschluss für MVP 1

* **Status**: Akzeptiert (Accepted)
* **Datum**: 2026-06-21
* **Beteiligte**: Thomas Niermann (User), Coding Assistant (Agent)

---

## 1. Kontext (Context)

In früheren Prototypen und Automatisierungsskripten (z. B. `learnweb_sync` und `notion-drive-sync`) wurden Dateien und Metadaten von universitären Plattformen direkt in Notion-Datenbanken und Notion-Seiten hochgeladen. 

Obwohl diese Lösung für einzelne, technisch versierte Nutzer gut funktioniert, bringt sie erhebliche Einschränkungen mit sich:
1. **Hohe Komplexität beim Setup**: Nutzer mussten Notion-Integrations-Tokens erstellen, Notion-Datenbanken anlegen und die Relationen korrekt verknüpfen. Das ist für nicht-technische Kommilitonen eine große Hürde.
2. **Sicherheitsrisiken**: Notion-API-Keys und LearnWeb-Credentials wurden oft in ungesicherten Klartext-Dateien (`.env`) oder auf geteilten Cloud-Servern abgelegt.
3. **Performance- und Stabilitäts-Einschränkungen**: Große Dateiuploads über die Notion-API sind langsam und fehleranfällig. 
4. **Offline-Verfügbarkeit**: Dateien in Notion erfordern eine aktive Internetverbindung.

---

## 2. Entscheidung (Decision)

Für die Neuentwicklung von **TBM UniCloudConnect (MVP 1)** treffen wir folgende fundamentale Entscheidungen:

1. **Strikt local-first**: Alle heruntergeladenen Dateien und Metadaten verbleiben auf dem lokalen Mac des Anwenders.
2. **Keine Notion-Integration**: Alle Notion-spezifischen Datenbank-Mappings, Page-Generierungen und File-Uploads werden im MVP 1 **ausgeschlossen**. Das Produkt funktioniert autark ohne jegliche Notion-Konfiguration.
3. **macOS-only**: Wir fokussieren uns im MVP 1 auf macOS, um native Betriebssystem-Funktionen (wie die macOS Keychain für verschlüsselte Passwörter und native Benachrichtigungen) direkt nutzen zu können.
4. **Lokale SQLite-Datenbank**: Zur Steuerung von Sync-Läufen, Datei-Hashes und Statuswerten wird eine lokale SQLite-Datenbank verwendet.
5. **Transkripte als Markdown**: Aufzeichnungen werden als lokale `.md`-Dateien gespeichert, um sie flexibel in anderen Systemen (z. B. Obsidian) nutzbar zu machen.

---

## 3. Konsequenzen (Consequences)

### Positive Konsequenzen:
* **Einfaches Setup**: Der Setup-Wizard erfordert keine Notion-Konfiguration. Nutzer geben nur ihre LearnWeb-Kennung ein und wählen ein lokales Verzeichnis.
* **Maximale Sicherheit**: Passwörter liegen sicher in der macOS Keychain. Keine Klartext-Keys im Projektordner.
* **Offline-Unterstützung**: Alle Dateien liegen physisch auf dem Mac und sind offline voll nutzbar.
* **Saubere Code-Basis**: Wir vermeiden die Vermischung von LearnWeb- und Notion-Schnittstellen im Code.

### Negative Konsequenzen:
* **Keine Cloud-Ansicht in Notion**: Der Anwender kann seine Kursstruktur und Materialien im MVP 1 nicht direkt in Notion einsehen oder filtern.
* **Spätere Migration**: Wenn in einer späteren Ausbaustufe Notion wieder angebunden werden soll, muss dies als optionaler, modularer *Export-Adapter* implementiert werden, anstatt als Kernbestandteil der Sync-Engine.
