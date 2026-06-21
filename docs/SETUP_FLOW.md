# Setup-Wizard: Benutzerführung & Ablauf

Dieses Dokument beschreibt die neun Schritte des Erst-Einrichtungs-Assistenten (Setup-Wizard) für TBM UniCloudConnect. Da die Anwendung ohne Terminal-Interaktion für Kommilitonen bedienbar sein muss, bildet dieser Wizard den Kern des Produkts.

---

## Schritt 1: Willkommen

### Ziele:
* Dem Anwender verständlich erklären, was die App tut.
* Vertrauen aufbauen (local-first, read-only).
* Klarmachen, dass diese Ausbaustufe (MVP 1) ohne Notion arbeitet.

### Inhalt im UI:
* *„Dieses Tool lädt ausgewählte LearnWeb-Inhalte lokal auf deinen Mac und kann Aufzeichnungen lokal transkribieren.“*
* *„Die App arbeitet strikt read-only und verändert nichts in deinem LearnWeb-Konto.“*
* *„Ihre Zugangsdaten werden nicht in Projektdateien, Cloud-Speichern oder Logs abgelegt.“*
* *„Die App läuft im Hintergrund und ist über das Symbol in der macOS-Menüleiste erreichbar.“*

---

## Schritt 2: Lokalen Speicherort wählen

### Ziele:
* Bestimmen, wo die Studienmaterialien und die SQLite-Datenbank abgelegt werden.

### Ablauf:
* Die App bietet einen sinnvollen Standard-Ordner an (z. B. `~/Documents/TBM UniCloudConnect/`).
* Der Nutzer kann den Pfad über einen nativen macOS-Datei-Auswahldialog anpassen.
* Die App prüft sofort die **Schreibrechte** auf das ausgewählte Verzeichnis.
* Bei erfolgreicher Prüfung wird die SQLite-Datenbank (`state.db`) in diesem Verzeichnis (oder im Standard-Application-Support-Ordner) initialisiert.

---

## Schritt 3: LearnWeb verbinden

### Ziele:
* Sichere Erfassung und Prüfung der LearnWeb-Zugangsdaten der Universität Münster.

### Ablauf:
* Eingabefelder: **LearnWeb-Nutzername** und **Passwort**.
* *Wichtig:* Keine Eingabe einer URL. Die URL für das LearnWeb der Universität Münster ist intern fest als Konstante hinterlegt.
* Nach Klick auf "Verbinden" führt das Backend einen Test-Login (über [src/learnweb-core/index.ts](../src/learnweb-core/index.ts)) durch.
* **Erfolg**: Das Passwort wird verschlüsselt in der **macOS Keychain (Schlüsselbund)** abgelegt. Ein Verweis-Eintrag (`credential_refs`) wird in der SQLite-Datenbank erzeugt.
* **Fehler**: Anzeige einer verständlichen Fehlermeldung (z. B. "Kennwort ungültig" oder "Netzwerkverbindung fehlgeschlagen"), ohne sicherheitsrelevante Details oder HTML-Dumps zu loggen.

---

## Schritt 4: Kurse laden

### Ziele:
* Auflistung aller im LearnWeb belegten Kurse für den Anwender.

### Ablauf:
* Das Core-Modul fragt nach erfolgreichem Login das LearnWeb-Dashboard ab.
* Gefundene Kurse werden mit Name, ID (Moodle Course ID) und Semester im UI aufgelistet.
* Der Nutzer kann hier eine erste grobe Auswahl treffen, welche Kurse grundsätzlich synchronisiert werden sollen (`courses.is_selected = true`).

---

## Schritt 5: Sync-Auswahl verfeinern

### Ziele:
* Feineinstellungs-Regeln für Ordner, Themen oder einzelne Dateien festlegen.

### Konzept:
* Der Anwender kann pro ausgewähltem Kurs bestimmen:
  * **Gesamten Kurs synchronisieren** (Standard: Alle künftigen und aktuellen PDFs, Ordner und URLs werden automatisch geladen).
  * **Nur bestimmte Abschnitte/Themen** (Wochen-Auswahl).
  * **Nur bestimmte Dateitypen** (z. B. nur PDFs, keine ZIPs).
* Diese Auswahlregeln werden in der Tabelle `selection_rules` hinterlegt.

---

## Schritt 6: Transkription konfigurieren

### Ziele:
* Optionale Aktivierung und Einrichtung des lokalen Transkriptions-Workers.

### Ablauf:
* Der Nutzer wählt aus drei Optionen:
  1. **Keine Transkription** (Standard, spart Speicherplatz und Rechenleistung).
  2. **Manuelle Auswahl** (Nur explizit im Dashboard markierte Aufzeichnungen werden transkribiert).
  3. **Vollautomatisch** (Alle gefundenen Video- und Audioaufzeichnungen in sync-aktiven Kursen werden transkribiert).
* **Hinweis im UI**: Die App informiert über den erhöhten Speicherplatzbedarf für temporäre Mediendateien und die Rechenleistung bei lokaler Verarbeitung.

---

## Schritt 7: Optionaler MCP-Zugriff für Claude

### Ziele:
* Erklärung und Einrichtung der lokalen Schnittstelle für KI-Agenten.

### Wichtiger Hinweis im UI:
* *„Der MCP-Connector erlaubt es Programmen wie Claude oder Codex, read-only auf dein LearnWeb-Konto zuzugreifen. Dieser Zugriff ist nicht auf die lokal ausgewählten Kurse beschränkt, sondern betrifft dein gesamtes Profil.“*
* *„Der MCP-Zugriff funktioniert nur lokal auf diesem Mac und nur, wenn TBM UniCloudConnect aktiv ausgeführt wird.“*
* **Aktion**: Der Schritt ist überspringbar. Bei Aktivierung bereitet das Backend die lokale `stdio`-Konfiguration vor und trägt den Server in der Claude-Konfigurationsdatei des Systems ein.

---

## Schritt 8: Kontrollierter Testlauf

### Ziele:
* Verifikation der gesamten Kette vor Aktivierung des Automatikbetriebs.

### Ablauf:
* Die App führt einen ersten, minimalen Synchronisationslauf durch:
  * Prüft die Keychain-Credentials.
  * Lädt die Kursliste und die Struktur der ausgewählten Kurse.
  * Lädt eine kleine Testdatei (z. B. ein PDF < 1 MB) herunter und prüft die Schreibrechte im Bibliotheksordner.
  * Schreibt den Test-Zustand in die SQLite-Datenbank.
* **Ergebnis-Feedback**: Das UI zeigt an:
  * *„X Kurse erfolgreich geprüft.“*
  * *„Testdatei erfolgreich unter [Pfad] gespeichert.“*
  * *„Datenbank-State intakt.“*

---

## Schritt 9: Sync-Modus wählen

### Ziele:
* Festlegung, wie und wann die Synchronisation künftig im Hintergrund laufen soll.

### Optionen im MVP 1:
* **Manuell**: Synchronisation erfolgt nur nach Klick auf "Jetzt synchronisieren" in der Menüleiste.
* **Bei App-Start**: Einmaliger Abgleich, wenn die App gestartet wird.
* **Periodisch / Zeitgesteuert**: Täglicher Abgleich oder stündliches Polling.
* **macOS-Login-Item**: Optionale Checkbox *„Beim Anmelden starten“*, um die App automatisch beim macOS-Systemstart im Hintergrund zu laden.

*Der automatische Hintergrundsync wird erst freigeschaltet, wenn Schritt 8 (Testlauf) erfolgreich abgeschlossen wurde.*
