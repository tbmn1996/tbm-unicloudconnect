# Zugriffe fuer TBM UniCloudConnect

Diese Datei dokumentiert nur Namen und Bezugswege. Keine Werte, Accountnamen, Projekt-IDs oder URLs eintragen.

| Name | Klasse | Bezugsquelle | Bedarf |
|---|---|---|---|
| - | - | - | Aktuell keine Runtime-Variable definiert |

Provider/Tools: `github-ci`

## Einrichtung

1. Installierte CLI und Auth-Status pruefen; nur `ready`, `missing` oder `unknown` protokollieren.
2. Vor Login, Projektverknuepfung oder Secret-Setzen eine separate Freigabe einholen.
3. Reale Werte lokal in `.env.local`, macOS Keychain oder dem Provider-Secret-Store ablegen.
4. Vor Commit `git ls-files` und einen Literal-Secret-Scan ausfuehren.
