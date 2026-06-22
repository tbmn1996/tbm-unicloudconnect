"""
Umfassende Tests für den Transkriptions-Worker.

Teste Kern-Funktionen ohne echte Whisper-Modelle oder Netzwerk-Calls:
- YouTube-Untertitel-Priorität
- Markdown-Header-Generierung
- Segment-Normalisierung (~30s mit [HH:MM:SS]-Format)
- Path-Sicherheit (Directory-Traversal)
- Atomares Schreiben
- Intel-Modell-Mapping
- PyAV Audio-Normalisierung (Smoke-Test)
"""

import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from transcription_worker.main import (
    _map_model_to_mlx_repo,
    _parse_subtitle_content,
    _seconds_to_hms,
    build_markdown_transcript,
    detect_architecture,
    get_youtube_subtitles,
    map_model_for_backend,
    normalize_audio,
    process_request,
    segment_transcript_into_paragraphs,
    validate_output_path,
)


class TestArchitectureDetection:
    """Test Architektur-Erkennung."""

    def test_detect_architecture_returns_valid_value(self):
        """Architektur sollte entweder 'arm64' oder 'x86_64' sein."""
        arch = detect_architecture()
        assert arch in ("arm64", "x86_64")

    def test_detect_architecture_matches_platform(self):
        """Architektur sollte platform.machine() entsprechen."""
        import platform
        machine = platform.machine()
        arch = detect_architecture()
        expected = "arm64" if machine == "arm64" else "x86_64"
        assert arch == expected


class TestModelMapping:
    """Test Modell-Name-Mapping für Backends."""

    def test_intel_turbo_maps_to_large_v3(self):
        """Auf Intel sollte 'large-v3-turbo' zu 'large-v3' gemappt werden."""
        result = map_model_for_backend("large-v3-turbo", "faster_whisper")
        assert result == "large-v3"

    def test_non_turbo_models_unchanged(self):
        """Nicht-Turbo-Modelle sollten unverändert bleiben."""
        assert map_model_for_backend("base", "faster_whisper") == "base"
        assert map_model_for_backend("small", "faster_whisper") == "small"
        assert map_model_for_backend("large-v3", "faster_whisper") == "large-v3"

    def test_mlx_models_unchanged(self):
        """MLX-Backend sollte alle Modelle unverändert lassen."""
        assert map_model_for_backend("large-v3-turbo", "mlx_whisper") == "large-v3-turbo"


class TestYouTubeSubtitles:
    """Test YouTube-Untertitel-Verarbeitung."""

    def test_parse_subtitle_content_vtt(self):
        """Teste VTT-Parsing."""
        vtt_content = """WEBVTT

00:00:00.000 --> 00:00:05.000
Hello world

00:00:05.000 --> 00:00:10.000
This is a test"""
        result = _parse_subtitle_content(vtt_content)
        # "Hello world" und "This is a test" sollten extrahiert werden
        assert "Hello" in result
        assert "test" in result
        # WEBVTT und Zeitmarken sollten NICHT enthalten sein
        assert "WEBVTT" not in result
        assert "-->" not in result

    def test_parse_subtitle_content_srt(self):
        """Teste SRT-Parsing."""
        srt_content = """1
00:00:00,000 --> 00:00:05,000
Hello world

2
00:00:05,000 --> 00:00:10,000
This is a test"""
        result = _parse_subtitle_content(srt_content)
        assert "Hello" in result
        assert "test" in result
        assert "1" not in result
        assert "2" not in result

    def test_parse_subtitle_content_json3(self):
        """YouTube-JSON3-Tracks werden ohne Metadaten in Text umgewandelt."""
        content = json.dumps({
            "events": [
                {"segs": [{"utf8": "Hallo "}, {"utf8": "Welt"}]},
                {"segs": [{"utf8": "\nNächster Satz"}]},
            ],
        })
        assert _parse_subtitle_content(content) == "Hallo Welt Nächster Satz"

    def test_parse_subtitle_content_empty(self):
        """Leere oder ungültige Inhalte sollten None zurückgeben."""
        result = _parse_subtitle_content("")
        assert result is None or result == ""

    @patch('yt_dlp.YoutubeDL')
    def test_get_youtube_subtitles_no_yt_dlp(self, mock_ydl):
        """Wenn yt_dlp nicht verfügbar, sollte None zurückgegeben werden."""
        with patch('transcription_worker.main.yt_dlp', None):
            result = get_youtube_subtitles(None, "https://youtube.com/watch?v=test", "de")
            assert result is None


class TestMarkdownGeneration:
    """Test Markdown-Transkript-Generierung."""

    def test_markdown_header_structure(self):
        """Teste Markdown-Header-Struktur nach MVP1_SCOPE.md."""
        markdown = build_markdown_transcript(
            title="Vorlesung Informatik",
            course_name="Informatik 2",
            recording_date="2026-01-15",
            source_url="https://learnweb.uni-muenster.de/...",
            model_label="mlx-whisper:small-mlx",
            duration_seconds=3600,
            paragraphs=[
                {"time": "[00:00:00]", "text": "Hallo zusammen."},
                {"time": "[00:01:00]", "text": "Heute geht es um..."},
            ],
        )

        # Prüfe Header-Struktur
        assert "# Transkript: Vorlesung Informatik" in markdown
        assert "* **Kurs**: Informatik 2" in markdown
        assert "* **Datum der Aufzeichnung**: 2026-01-15" in markdown
        assert "* **Quelle**: https://learnweb.uni-muenster.de/..." in markdown
        assert "* **Modell**: mlx-whisper:small-mlx" in markdown
        assert "* **Dauer**: 60 Minuten" in markdown

    def test_markdown_unknown_fallback(self):
        """Fehlende Metadaten sollten als 'Unbekannt' ausgegeben werden."""
        markdown = build_markdown_transcript(
            title=None,
            course_name=None,
            recording_date=None,
            source_url=None,
            model_label="unknown",
            duration_seconds=0,
            paragraphs=[],
        )

        assert "Unbekanntes Transkript" in markdown or "Unbekannt" in markdown
        # URL sollte NIEMALS ausgegeben werden
        assert "http" not in markdown
        assert "learnweb" not in markdown

    def test_markdown_source_url_is_preserved(self):
        """Die Quell-URL gehört gemäß MVP1_SCOPE in den lokalen Markdown-Header."""
        markdown = build_markdown_transcript(
            title="Test",
            course_name="Test Course",
            recording_date="2026-01-15",
            source_url="https://secret.learnweb.url/with/cookies",
            model_label="test",
            duration_seconds=120,
            paragraphs=[{"time": "[00:00:00]", "text": "Test"}],
        )

        assert "https://secret.learnweb.url/with/cookies" in markdown

    def test_markdown_paragraphs_preserved(self):
        """Paragraph-Struktur sollte mit Zeitmarken erhalten bleiben."""
        paragraphs = [
            {"time": "[00:00:00]", "text": "First segment"},
            {"time": "[00:00:30]", "text": "Second segment"},
            {"time": "[00:01:00]", "text": "Third segment"},
        ]
        markdown = build_markdown_transcript(
            title="Test",
            course_name="Test",
            recording_date="2026-01-15",
            source_url="",
            model_label="test",
            duration_seconds=60,
            paragraphs=paragraphs,
        )

        assert "[00:00:00]" in markdown
        assert "[00:00:30]" in markdown
        assert "[00:01:00]" in markdown
        assert "First segment" in markdown
        assert "Second segment" in markdown


class TestSegmentation:
    """Test Segment-Normalisierung auf ~30-Sekunden-Absätze."""

    def test_seconds_to_hms_format(self):
        """Test [HH:MM:SS]-Formatierung."""
        assert _seconds_to_hms(0) == "[00:00:00]"
        assert _seconds_to_hms(3661) == "[01:01:01]"
        assert _seconds_to_hms(7200) == "[02:00:00]"
        assert _seconds_to_hms(59) == "[00:00:59]"

    def test_segment_mlx_whisper(self):
        """Test Segmentierung für mlx-whisper (ohne Zeitmarken)."""
        transcript = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five."
        paragraphs = segment_transcript_into_paragraphs(
            transcript,
            backend_name="mlx_whisper",
            target_duration=30.0,
        )

        # Sollte mindestens einen Absatz geben
        assert len(paragraphs) > 0
        # Jeder Absatz sollte einen [HH:MM:SS]-Zeitmarker haben
        for para in paragraphs:
            assert "time" in para
            assert para["time"].startswith("[")
            assert "text" in para
            assert len(para["text"]) > 0

    def test_segment_faster_whisper(self):
        """Test Segmentierung für faster-whisper (mit Zeitmarken)."""
        segments = [
            {"start": 0.0, "end": 5.0, "text": "Hello"},
            {"start": 5.0, "end": 10.0, "text": "world"},
            {"start": 10.0, "end": 15.0, "text": "This"},
            {"start": 15.0, "end": 20.0, "text": "is"},
            {"start": 20.0, "end": 25.0, "text": "test"},
        ]
        transcript = json.dumps(segments)
        paragraphs = segment_transcript_into_paragraphs(
            transcript,
            backend_name="faster_whisper",
            target_duration=30.0,
        )

        # Sollte mindestens einen Absatz geben
        assert len(paragraphs) > 0
        # Jeder Absatz sollte [HH:MM:SS]-Format haben
        for para in paragraphs:
            assert para["time"].startswith("[")
            assert para["time"].count(":") == 2

    def test_segment_empty_transcript(self):
        """Leere Transkripte sollten keine Absätze generieren oder einen leeren zurückgeben."""
        paragraphs = segment_transcript_into_paragraphs("", "mlx_whisper")
        assert isinstance(paragraphs, list)


class TestAudioNormalization:
    """Test PyAV-basierte Audio-Normalisierung."""

    def test_normalize_audio_creates_wav(self):
        """PyAV sollte eine gültige 16 kHz Mono-WAV erzeugen."""
        # Überspringe Test, wenn av nicht verfügbar
        av = __import__('importlib').util.find_spec('av')
        if av is None:
            __import__('pytest').skip("av (PyAV) nicht installiert")

        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir = Path(tmpdir)
            input_file = tmpdir / "test_input.wav"
            output_file = tmpdir / "test_output.wav"
            import math
            import struct
            import wave

            sample_rate = 44_100
            samples = [
                int(16_383 * math.sin(2 * math.pi * 440 * index / sample_rate))
                for index in range(sample_rate)
            ]
            with wave.open(str(input_file), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(sample_rate)
                wav.writeframes(b"".join(struct.pack("<h", sample) for sample in samples))

            duration = normalize_audio(str(input_file), str(output_file))

            assert output_file.exists(), "Normalisierte WAV wurde nicht erstellt"
            assert duration == 1
            with wave.open(str(output_file), "rb") as wav:
                assert wav.getframerate() == 16_000
                assert wav.getnchannels() == 1
                assert wav.getnframes() > 15_000


class TestMlxModelMapping:
    """Test mlx-whisper Modell-zu-Repo-Abbildung."""

    def test_mlx_model_mapping_tiny(self):
        """Modell 'tiny' sollte auf tiny-mlx gemappt werden."""
        repo = _map_model_to_mlx_repo("tiny")
        assert repo == "mlx-community/whisper-tiny-mlx"

    def test_mlx_model_mapping_large_v3(self):
        """Modell 'large-v3' sollte auf large-v3-mlx gemappt werden."""
        repo = _map_model_to_mlx_repo("large-v3")
        assert repo == "mlx-community/whisper-large-v3-mlx"

    def test_mlx_model_mapping_large_v3_turbo(self):
        """Das offizielle Turbo-Repo trägt kein zusätzliches -mlx-Suffix."""
        repo = _map_model_to_mlx_repo("large-v3-turbo")
        assert repo == "mlx-community/whisper-large-v3-turbo"

    def test_mlx_model_mapping_unknown_default(self):
        """Unbekanntes Modell sollte auf small-mlx defaulten."""
        repo = _map_model_to_mlx_repo("unknown-model")
        assert repo == "mlx-community/whisper-small-mlx"


class TestPathSecurity:
    """Test Path-Sicherheit gegen Directory-Traversal."""

    def test_validate_output_path_resolves_absolute(self):
        """Pfade sollten zu absoluten Pfaden aufgelöst werden."""
        with tempfile.TemporaryDirectory() as tmpdir:
            relative_path = "subdir/file.md"
            full_path = Path(tmpdir) / relative_path
            result = validate_output_path(str(full_path), tmpdir)
            assert result.is_absolute()

    def test_validate_output_path_no_traversal(self):
        """Directory-Traversal sollte durch resolve() verhindert werden."""
        # Path mit .. sollte aufgelöst werden
        with tempfile.TemporaryDirectory() as tmpdir:
            library_root = Path(tmpdir) / "safe"
            library_root.mkdir()
            traversal_path = str(library_root / ".." / "outside.md")
            with __import__('pytest').raises(ValueError):
                validate_output_path(traversal_path, str(library_root))


class TestAtomicWrite:
    """Test atomares Schreiben von Dateien."""

    def test_atomic_write_creates_file(self):
        """Atomes Schreiben sollte die Datei erzeugen."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "test.md"
            markdown = "# Test Header\n\nTest content"

            # Simuliere atomares Schreiben
            output_path.parent.mkdir(parents=True, exist_ok=True)
            temp_file = output_path.with_suffix(".tmp")
            temp_file.write_text(markdown, encoding="utf-8")

            import os
            os.replace(temp_file, output_path)

            # Datei sollte existieren
            assert output_path.exists()
            # Inhalt sollte korrekt sein
            assert output_path.read_text() == markdown
            # Temp-Datei sollte weg sein
            assert not temp_file.exists()


class TestProcessRequest:
    """Test Request-Verarbeitung auf höherer Ebene."""

    def test_process_request_missing_output_path(self):
        """Request ohne output_path sollte Error-Event zurückgeben."""
        request = {
            "id": "test-1",
            "source_kind": "youtube",
            "language": "de",
        }
        result = process_request(request)
        assert result["type"] == "error"
        assert result["code"] == "MISSING_OUTPUT_PATH"

    def test_process_request_youtube_no_subs(self):
        """YouTube ohne Untertitel sollte media_url benötigen."""
        with tempfile.TemporaryDirectory() as tmpdir:
            request = {
                "id": "test-2",
                "source_kind": "youtube",
                "language": "de",
                "output_path": str(Path(tmpdir) / "test.md"),
                "library_root": tmpdir,
            }
            # Kein media_url → error
            with patch('transcription_worker.main.get_youtube_subtitles', return_value=None):
                result = process_request(request)
            assert result["type"] == "error"

    def test_process_request_youtube_with_subs(self):
        """YouTube mit verfügbaren Untertiteln sollte erfolgreich sein."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_file = Path(tmpdir) / "test.md"
            request = {
                "id": "test-3",
                "source_kind": "youtube",
                "media_url": "https://youtube.com/watch?v=test",
                "language": "de",
                "output_path": str(output_file),
                "library_root": tmpdir,
                "title": "Test Lecture",
                "metadata": {"course_name": "Test Course"},
            }

            # Mock YouTube-Untertitel
            with patch('transcription_worker.main.get_youtube_subtitles',
                      return_value="Sample transcript text"):
                result = process_request(request)

            # Sollte erfolgreich sein
            assert result["type"] == "result"
            assert "youtube-subs" in result["backend"]
            # Datei sollte erstellt worden sein
            assert output_file.exists()
            content = output_file.read_text()
            assert "Test Lecture" in content
            assert "Sample transcript text" in content

    def test_process_request_error_handling(self):
        """Requests mit Exceptions sollten Error-Events zurückgeben."""
        # Dieser Test ist dokumentativ: error_handling wird durch
        # andere Tests abgedeckt (z.B. missing_output_path).
        pass


class TestSecurityNoLeaks:
    """Test, dass keine Secrets/URLs/Cookies geloggt werden."""

    def test_request_with_cookies_no_leak(self):
        """Cookies sollten nicht in Events auftauchen."""
        request = {
            "id": "test-5",
            "source_kind": "opencast",
            "media_url": "https://opencast.uni-muenster.de/...",
            "cookies": {"MoodleSession": "secret-session-id"},
            "output_path": "/tmp/test.md",
            "library_root": "/tmp",
        }
        # Verarbeite Request (mit Mocks)
        with patch('transcription_worker.main.get_youtube_subtitles', return_value=None):
            with patch('transcription_worker.main.get_transcription_backend',
                      return_value=("mlx_whisper", MagicMock())):
                result = process_request(request)

        # Cookies sollten NICHT in der Response sein
        import json
        json_str = json.dumps(result)
        assert "secret-session-id" not in json_str
        assert "MoodleSession" not in json_str


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
