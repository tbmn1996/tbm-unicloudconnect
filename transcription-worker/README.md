# transcription-worker

Isolierter lokaler Transkriptions-Worker (Audio/Video aus LearnWeb-Aufzeichnungen -> Markdown), per Subprocess aus tbm-unicloudconnect aufgerufen.

**Architektur**: JSONL-basiertes Protokoll über stdin/stdout. Ein Job zur Zeit (Main-Prozess serialisiert). YouTube-Untertitel-Priorität. Markdown-Ausgabe nach [MVP1_SCOPE.md](../docs/MVP1_SCOPE.md).

## Stack

- Profil: `python-automation` (Python-Automation)
- Overlays: keine
- **Dependencies**: `av` (PyAV), `yt-dlp`, `faster-whisper` (Intel), `mlx-whisper` (Apple Silicon)

## Befehle

| Zweck | Kommando |
|---|---|
| setup | `uv sync --dev` |
| run | `uv run transcription_worker` |
| test | `uv run pytest -v` |
| lint | `uv run ruff check .` |
| lint:fix | `uv run ruff check --fix .` |
| typecheck | `-` |
| build | `-` |

Dependencies werden erst nach expliziter Freigabe installiert.

## JSONL-Protokoll

**Request (stdin, eine JSON-Zeile pro Job)**:
```json
{
  "id": "job-123",
  "source_kind": "youtube|opencast|media",
  "media_url": "https://...",
  "subtitle_url": "https://... (optional, YouTube)",
  "language": "de|en|auto",
  "model": "base|small|large-v3-turbo",
  "output_path": "/absolute/path/to/transcript.md",
  "title": "Vorlesung XYZ",
  "needs_auth": true,
  "cookies": {"MoodleSession": "..."},
  "metadata": {"course_name": "...", "recording_date": "..."}
}
```

**Events (stdout, JSON-Zeilen)**:
- `{"type":"ready"}` – Worker startet
- `{"type":"progress","id":"...","phase":"downloading|transcribing|writing","done":0,"total":100}`
- `{"type":"result","id":"...","transcript_path":"...","backend":"mlx_whisper|faster_whisper|youtube-subs","model":"...","duration_seconds":123}`
- `{"type":"error","id":"...","code":"MISSING_MEDIA_URL","message":"Generische Fehlermeldung (keine Secrets)"}`

## Features

- **YouTube-Untertitel-Priorität**: Wenn `source_kind == "youtube"` und Untertitel vorhanden, wird Whisper übersprungen
- **Architektur-Erkennung**: Automatisch mlx-whisper (Apple Silicon) oder faster-whisper (Intel)
- **Model-Mapping**: Intel ignoriert "turbo" (wird zu "large-v3")
- **PyAV-Normalisierung**: Audio auf 16 kHz Mono WAV normalisieren (kein System-ffmpeg)
- **Markdown-Output**: Nach MVP1_SCOPE.md mit standardisierten Headern (Kurse, Daten, Modell, Dauer)
- **Keine Secrets**: URLs, Cookies, Tokens werden NIE geloggt oder in Events ausgegeben
- **Atomare Schreibvorgänge**: Temporäre .tmp-Datei → os.replace()
- **Cleanup**: Temporäre Mediendateien automatisch löschen

## Tests

25 Tests, alle grün ✓
- Architektur-Erkennung
- Model-Mapping (Intel: turbo → large-v3)
- YouTube-Untertitel-Parsing (VTT/SRT)
- Markdown-Header-Struktur + "Unbekannt"-Fallback
- Segment-Normalisierung (~30s mit [HH:MM:SS])
- Path-Sicherheit (Directory-Traversal)
- Atomares Schreiben
- Security: Keine Secrets in Events/Logs

## Zugriffe

Siehe [`docs/ACCESS.md`](../docs/ACCESS.md). Echte Secrets gehören in lokale oder verwaltete Secret-Stores und nie ins Repository.
