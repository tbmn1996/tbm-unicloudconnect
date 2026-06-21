# transcription-worker

Isolierter lokaler Transkriptions-Worker (Audio/Video aus LearnWeb-Aufzeichnungen -> Markdown), per Subprocess aus tbm-unicloudconnect aufgerufen.

## Stack

- Profil: `python-automation` (Python-Automation)
- Overlays: keine

## Befehle

| Zweck | Kommando |
|---|---|
| setup | `uv sync --dev` |
| run | `uv run transcription_worker` |
| test | `uv run pytest -q` |
| lint | `uv run ruff check .` |
| typecheck | `-` |
| build | `-` |

Dependencies werden erst nach expliziter Freigabe installiert.

## Zugriffe

Siehe [`docs/ACCESS.md`](docs/ACCESS.md). Echte Secrets gehoeren in lokale oder verwaltete Secret-Stores und nie ins Repository.
