#!/usr/bin/env python3
"""
Transkriptions-Worker: Nimmt JSON-RPC-Requests von stdin an (JSONL-Protokoll),
transkribiert Audio-/Videodateien lokal (mlx-whisper auf Apple Silicon,
faster-whisper auf Intel), gibt Event-Updates auf stdout zurück.

Architektur:
- Ein Job zur Zeit (Main-Prozess serialisiert Anfragen)
- YouTube-Untertitel-Priorität: Wenn verfügbar, kein Whisper
- Ausgabe: Markdown nach MVP1_SCOPE.md mit standardisierten Headern
- Keine Secrets/URLs/Cookies in stdout oder Logs
"""

import json
import os
import platform
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

# MediaHandling (PyAV)
try:
    import av
except ImportError:
    av = None

# YouTube-Untertitel & Download
try:
    import yt_dlp
except ImportError:
    yt_dlp = None


def detect_architecture() -> str:
    """
    Erkenne Architektur: 'arm64' (Apple Silicon) oder 'x86_64' (Intel).
    Gibt den Architektur-String zurück.
    """
    machine = platform.machine()
    return "arm64" if machine == "arm64" else "x86_64"


def get_transcription_backend(architecture: str) -> tuple[str, Any]:
    """
    Lade Transkriptions-Backend basierend auf Architektur.
    Gibt (backend_name, module) zurück.
    """
    if architecture == "arm64":
        try:
            import mlx_whisper
            return "mlx_whisper", mlx_whisper
        except ImportError as err:
            raise RuntimeError(
                "mlx-whisper nicht verfügbar (nur auf Apple Silicon). "
                "Installiere: pip install mlx-whisper"
            ) from err
    else:
        # Intel: faster-whisper
        try:
            from faster_whisper import WhisperModel
            return "faster_whisper", type("FasterWhisper", (), {"WhisperModel": WhisperModel})
        except ImportError as err:
            raise RuntimeError(
                "faster-whisper nicht verfügbar. "
                "Installiere: pip install faster-whisper"
            ) from err


def map_model_for_backend(model: str, backend: str) -> str:
    """
    Bilde Modellnamen für das Backend um. Intel kennt 'turbo' nicht.
    """
    if backend == "faster_whisper" and model == "large-v3-turbo":
        return "large-v3"
    return model


def get_youtube_subtitles(subtitle_url: str | None, source_url: str, language: str) -> str | None:
    """
    Versuche, YouTube-Untertitel zu laden und in Text umzuwandeln.
    Gibt Transkript als String zurück oder None, wenn keine Untertitel gefunden.

    Lädt Untertitel-Tracks über ihre URL (yt-dlp liefert i.d.R. track["url"], nicht "data").
    Fallback: automatic_captions, Sprach-Fallback (gewünschte Sprache → erste verfügbar).
    """
    if not yt_dlp:
        return None

    # Wenn subtitle_url übergeben wurde, versuche sie direkt zu laden
    if subtitle_url:
        try:
            import urllib.request
            with urllib.request.urlopen(subtitle_url, timeout=10) as response:
                content = response.read().decode("utf-8")
            transcript = _parse_subtitle_content(content)
            if transcript:
                return transcript
        except Exception:
            pass

    # Hole Video-Info via yt-dlp und versuche Untertitel zu laden
    try:
        with yt_dlp.YoutubeDL({
            "quiet": True,
            "no_warnings": True,
            "skip_unavailable_fragments": True,
        }) as ydl:
            info = ydl.extract_info(source_url, download=False)

            if not info:
                return None

            # Versuche gewünschte Sprache in "subtitles" oder "automatic_captions"
            subtitles_dict = info.get("subtitles", {})
            auto_captions_dict = info.get("automatic_captions", {})

            # Bevorzuge gewünschte Sprache; sonst erste verfügbare
            selected_tracks = None
            if language in subtitles_dict and subtitles_dict[language]:
                selected_tracks = subtitles_dict[language]
            elif language in auto_captions_dict and auto_captions_dict[language]:
                selected_tracks = auto_captions_dict[language]
            elif subtitles_dict:
                # Fallback: erste Sprache aus subtitles
                first_lang = next(iter(subtitles_dict))
                selected_tracks = subtitles_dict[first_lang]
            elif auto_captions_dict:
                # Fallback: erste Sprache aus automatic_captions
                first_lang = next(iter(auto_captions_dict))
                selected_tracks = auto_captions_dict[first_lang]

            if not selected_tracks:
                return None

            # Bevorzuge textbasierte Formate; YouTube liefert sonst oft JSON3 zuerst.
            import urllib.request
            preferred_tracks = sorted(
                selected_tracks,
                key=lambda track: 0 if track.get("ext") in {"vtt", "srt"} else 1,
            )
            for track in preferred_tracks:
                track_url = track.get("url")
                if track_url:
                    try:
                        with urllib.request.urlopen(track_url, timeout=10) as response:
                            content = response.read().decode("utf-8")
                        transcript = _parse_subtitle_content(content)
                        if transcript:
                            return transcript
                    except Exception:
                        continue

    except Exception:
        pass

    return None


def _parse_subtitle_content(content: str) -> str | None:
    """
    Konvertiere VTT/SRT-Subtiteldaten in einfachen Text.
    Gibt den Transkript-String zurück.
    """
    try:
        payload = json.loads(content)
        events = payload.get("events", []) if isinstance(payload, dict) else []
        json_text = " ".join(
            str(segment.get("utf8", "")).strip()
            for event in events
            if isinstance(event, dict)
            for segment in event.get("segs", [])
            if isinstance(segment, dict) and segment.get("utf8")
        )
        if json_text.strip():
            return re.sub(r"\s+", " ", json_text).strip()
    except (json.JSONDecodeError, TypeError, AttributeError):
        pass

    lines = []
    for line in content.split("\n"):
        # Filtere Zeitmarken, WEBVTT-Header und leere Zeilen
        line = line.strip()
        if not line or "-->" in line or line.startswith("WEBVTT"):
            continue
        # Ignoriere Cue-IDs (nur Zahlen oder Text ohne Doppelpunkt)
        if not line.isdigit() and not re.match(r"^\d{2}:\d{2}:\d{2}", line):
            lines.append(line)
    return " ".join(lines) if lines else None


def normalize_audio(input_path: str, output_path: str) -> int:
    """
    Lese Audio-/Videodatei mit PyAV ein und schreibe als 16 kHz Mono WAV.
    Nutze av.AudioResampler für zuverlässiges Resampling.
    Gibt die Dauer in Sekunden zurück.
    """
    if not av:
        raise RuntimeError("av (PyAV) nicht verfügbar. Installiere: pip install av")

    # Öffne die Input-Datei
    container = av.open(input_path)

    # Suche Audio-Stream
    audio_stream = None
    for stream in container.streams.audio:
        audio_stream = stream
        break

    if not audio_stream:
        raise ValueError("Keine Audio-Spur in der Datei gefunden")

    # Ziel-Parameter
    target_rate = 16000
    target_format = "s16"
    target_layout = "mono"

    # Öffne Output-Datei mit korrekten Stream-Optionen (nicht per stream.channels setzen)
    out_container = av.open(output_path, "w")
    out_stream = out_container.add_stream(
        "pcm_s16le",
        rate=target_rate,
        layout=target_layout,
    )

    # Erstelle AudioResampler für zuverlässiges Resampling
    resampler = av.AudioResampler(
        format=target_format,
        layout=target_layout,
        rate=target_rate,
    )

    total_samples = 0

    # Dekodiere und resample jeden Frame
    for frame in container.decode(audio_stream):
        # Resample den Frame
        resampled_frames = resampler.resample(frame)
        # resample() gibt eine Liste von Frames zurück
        for resampled_frame in resampled_frames:
            # PTS zuruecksetzen: die resampleten Frames tragen noch die
            # Zeitstempel der Quellspur (z. B. 48 kHz/Stereo). Beim Muxen in
            # die 16-kHz-Mono-WAV ergeben diese ungueltige Zeitstempel
            # (EINVAL/errno 22). None laesst den Encoder gueltige PTS vergeben.
            resampled_frame.pts = None
            # Encode und mux
            for packet in out_stream.encode(resampled_frame):
                out_container.mux(packet)
            total_samples += resampled_frame.samples

    # Flush des Resamplers und Encoders
    for resampled_frame in resampler.resample(None):
        resampled_frame.pts = None  # s. o.: ungueltige Quell-PTS vermeiden
        for packet in out_stream.encode(resampled_frame):
            out_container.mux(packet)
        total_samples += resampled_frame.samples

    for packet in out_stream.encode():
        out_container.mux(packet)

    out_container.close()
    container.close()

    # Berechne Dauer aus tatsächlich geschriebenen Samples
    duration_seconds = total_samples / target_rate
    return int(duration_seconds)


def _map_model_to_mlx_repo(model: str) -> str:
    """
    Bilde Whisper-Modellnamen auf MLX-Community Hugging Face Repos ab.
    Default: small-mlx für unbekannte Modelle.
    """
    model_map = {
        "tiny": "mlx-community/whisper-tiny-mlx",
        "base": "mlx-community/whisper-base-mlx",
        "small": "mlx-community/whisper-small-mlx",
        "medium": "mlx-community/whisper-medium-mlx",
        "large-v3": "mlx-community/whisper-large-v3-mlx",
        "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    }
    return model_map.get(model, "mlx-community/whisper-small-mlx")


def transcribe_audio(
    audio_path: str,
    model: str,
    language: str,
    backend_name: str,
    backend_module: Any,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> tuple[str, str]:
    """
    Transkribiere Audio mit Whisper-Backend.
    Gibt (transcript, backend_label) zurück.

    Für faster-whisper: Transkript ist JSON mit Segmenten (start/end/text).
    Für mlx-whisper: Transkript ist JSON mit Segmenten (start/end/text) aus result["segments"].
    """
    if backend_name == "mlx_whisper":
        # mlx-whisper API: transcribe() gibt dict zurück, nicht einen Generator
        repo = _map_model_to_mlx_repo(model)

        if on_progress:
            import tqdm
            class TqdmProgressInterceptor(tqdm.tqdm):
                def update(self, n=1):
                    super().update(n)
                    if self.total:
                        on_progress(self.n, self.total)

            original_tqdm = tqdm.tqdm
            tqdm.tqdm = TqdmProgressInterceptor

        try:
            result = backend_module.transcribe(
                audio_path,
                path_or_hf_repo=repo,
                language=None if language == "auto" else language,
                verbose=False if on_progress else None,
            )
        finally:
            if on_progress:
                tqdm.tqdm = original_tqdm

        # result ist ein dict mit "text", "segments", "language"
        # Nutze Segmente für Zeitmarken (wenn vorhanden), sonst Text
        transcript_segments = []
        if isinstance(result.get("segments"), list):
            for segment in result["segments"]:
                transcript_segments.append({
                    "start": segment.get("start", 0),
                    "end": segment.get("end", 0),
                    "text": segment.get("text", "").strip(),
                })
        else:
            # Fallback: nur Text ohne Zeitmarken
            text = result.get("text", "")
            if text.strip():
                transcript_segments.append({
                    "start": 0,
                    "end": 0,
                    "text": text.strip(),
                })

        transcript = json.dumps(transcript_segments)
        backend_label = f"mlx-whisper:{model}"

    else:
        # faster-whisper API (CTranslate2)
        WhisperModel = backend_module.WhisperModel
        whisper_model = WhisperModel(
            model,
            device="auto",
            compute_type="auto",
        )
        segments, info = whisper_model.transcribe(
            audio_path,
            language=language if language != "auto" else None,
            beam_size=5,
        )

        total_duration = info.duration if (info and hasattr(info, 'duration') and info.duration) else None

        # Sammle alle Segmente mit Zeitmarken und melde Fortschritt
        transcript_segments = []
        for segment in segments:
            transcript_segments.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
            })
            if total_duration and on_progress:
                on_progress(int(segment.end), int(total_duration))

        transcript = json.dumps(transcript_segments)
        backend_label = f"faster-whisper:{model}"

    return transcript, backend_label


def segment_transcript_into_paragraphs(
    transcript: str,
    backend_name: str,
    target_duration: float = 30.0,
) -> list:
    """
    Teile Transkript in ~30-Sekunden-Absätze auf mit [HH:MM:SS]-Zeitmarken.

    Beide faster-whisper und mlx-whisper geben JSON mit Segmenten zurück.
    Fallback: naive Satz-Aufteilung wenn JSON ungültig.
    """
    paragraphs = []

    # Versuche JSON-Segmente zu laden (für faster-whisper und mlx-whisper)
    segments = None
    try:
        data = json.loads(transcript)
        if isinstance(data, list) and data and "start" in data[0]:
            segments = data
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    if segments:
        # JSON-Segmente vorhanden: gruppiere zu ~30s-Absätzen
        current_paragraph = []
        current_start_time = 0.0
        current_duration = 0.0

        for segment in segments:
            start = segment.get("start", 0)
            end = segment.get("end", 0)
            text = segment.get("text", "").strip()

            if not text:
                continue

            segment_duration = end - start

            # Wenn Absatz lang genug oder erstes Segment
            if current_duration >= target_duration and current_paragraph:
                # Speichere aktuellen Absatz
                time_str = _seconds_to_hms(current_start_time)
                paragraphs.append({
                    "time": time_str,
                    "text": " ".join(current_paragraph),
                })
                current_paragraph = []
                current_duration = 0.0
                current_start_time = start

            current_paragraph.append(text)
            current_duration += segment_duration

        # Verbleibender Absatz
        if current_paragraph:
            time_str = _seconds_to_hms(current_start_time)
            paragraphs.append({
                "time": time_str,
                "text": " ".join(current_paragraph),
            })

    else:
        # Fallback: Naive Satz-Aufteilung (wenn JSON ungültig oder leer)
        sentences = transcript.split(". ")
        current_paragraph = []
        sentence_count = 0

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            current_paragraph.append(sentence)
            sentence_count += 1

            # Etwa alle 3-4 Sätze ein Absatz (heuristische Approximation)
            if sentence_count >= 4:
                time_str = _seconds_to_hms(len(paragraphs) * 30)
                paragraphs.append({
                    "time": time_str,
                    "text": ". ".join(current_paragraph) + ".",
                })
                current_paragraph = []
                sentence_count = 0

        # Verbleibender Absatz
        if current_paragraph:
            time_str = _seconds_to_hms(len(paragraphs) * 30)
            paragraphs.append({
                "time": time_str,
                "text": ". ".join(current_paragraph) + ".",
            })

    return paragraphs


def _seconds_to_hms(seconds: float) -> str:
    """
    Konvertiere Sekunden in [HH:MM:SS]-Format.
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    return f"[{hours:02d}:{minutes:02d}:{secs:02d}]"


def build_markdown_transcript(
    title: str,
    course_name: str | None,
    recording_date: str | None,
    source_url: str | None,
    model_label: str,
    duration_seconds: int,
    paragraphs: list,
) -> str:
    """
    Baue Markdown-Transkript nach MVP1_SCOPE.md-Spezifikation.
    Nur Metadaten-Header, keine Secrets ausgeben.
    """
    safe_source = "Unbekannt"
    if source_url and re.match(r"^https?://[^\r\n]+$", source_url):
        safe_source = source_url

    transcript_title = title or "Unbekanntes Transkript"
    course = course_name or "Unbekannt"
    rec_date = recording_date or "Unbekannt"
    minutes = duration_seconds // 60

    header = f"""# Transkript: {transcript_title}

* **Kurs**: {course}
* **Datum der Aufzeichnung**: {rec_date}
* **Quelle**: {safe_source}
* **Transkribiert am**: {datetime.now().strftime("%Y-%m-%d")}
* **Modell**: {model_label}
* **Dauer**: {minutes} Minuten

---

"""

    # Absätze hinzufügen
    body = ""
    for para in paragraphs:
        body += f"{para['time']} {para['text']}\n\n"

    return header + body


def validate_output_path(output_path: str, library_root: str) -> Path:
    """
    Validiere output_path gegen Directory-Traversal.
    Gibt absoluten Path zurück oder wirft ValueError.
    """
    if not library_root:
        raise ValueError("library_root erforderlich")
    root = Path(library_root).resolve()
    path = Path(output_path).resolve()
    if not path.is_relative_to(root):
        raise ValueError("output_path liegt außerhalb der Bibliothek")
    return path


def process_request(request: dict[str, Any]) -> dict[str, Any]:
    """
    Verarbeite einen JSONL-Request und gebe Event-Responses zurück.
    """
    job_id = request.get("id", "unknown")

    try:
        # Validiere Request-Felder
        source_kind = request.get("source_kind")
        media_url = request.get("media_url")
        subtitle_url = request.get("subtitle_url")
        language = request.get("language", "de")
        model = request.get("model", "base")
        output_path = request.get("output_path")
        library_root = request.get("library_root")
        title = request.get("title", "Unbekanntes Transkript")
        source_url = request.get("source_url")
        # needs_auth = request.get("needs_auth", False)  # TODO: Später für Auth-Flow
        # cookies = request.get("cookies")  # Nie loggen! Nur im Speicher halten
        metadata = request.get("metadata", {})

        if not output_path:
            return {
                "type": "error",
                "id": job_id,
                "code": "MISSING_OUTPUT_PATH",
                "message": "output_path erforderlich",
            }
        if not library_root:
            return {
                "type": "error",
                "id": job_id,
                "code": "MISSING_LIBRARY_ROOT",
                "message": "library_root erforderlich",
            }

        # YouTube-Untertitel-Priorität
        if source_kind == "youtube":
            subs_text = get_youtube_subtitles(subtitle_url, media_url, language)
            if subs_text:
                # YouTube-Untertitel gefunden → Direkt verwenden, kein Whisper
                paragraphs = [{"time": "[00:00:00]", "text": subs_text}]
                backend_label = f"youtube-subs:{language}"
                duration = 0

                markdown = build_markdown_transcript(
                    title=title,
                    course_name=metadata.get("course_name"),
                    recording_date=metadata.get("recording_date"),
                    source_url=source_url,
                    model_label=backend_label,
                    duration_seconds=duration,
                    paragraphs=paragraphs,
                )

                # Atomar schreiben
                output_file = validate_output_path(output_path, library_root)
                output_file.parent.mkdir(parents=True, exist_ok=True)
                temp_file = output_file.with_suffix(".tmp")
                temp_file.write_text(markdown, encoding="utf-8")
                os.replace(temp_file, output_file)

                return {
                    "type": "result",
                    "id": job_id,
                    "transcript_path": str(output_file),
                    "backend": "youtube-subs",
                    "model": backend_label,
                    "duration_seconds": duration,
                }

        # Kein YouTube-Untertitel gefunden → Whisper-Weg
        if not media_url and not request.get("media_path"):
            return {
                "type": "error",
                "id": job_id,
                "code": "MISSING_MEDIA_URL",
                "message": "media_url erforderlich, wenn keine Untertitel vorhanden",
            }

        # Erkenne Architektur und Backend
        architecture = detect_architecture()
        backend_name, backend_module = get_transcription_backend(architecture)

        # Bilde Modell für Backend um (Intel: turbo → large-v3)
        mapped_model = map_model_for_backend(model, backend_name)

        # Lade und normalisiere Audio
        emit_event({
            "type": "progress",
            "id": job_id,
            "phase": "downloading",
            "done": 0,
            "total": 100,
        })

        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            # Bestimme Audioquelle
            media_file = None

            # 1. Prüfe media_path (lokal vorgegeben vom Main-Prozess)
            media_path = request.get("media_path")
            if media_path:
                media_file = Path(media_path)
                if not media_file.exists():
                    return {
                        "type": "error",
                        "id": job_id,
                        "code": "MEDIA_NOT_FOUND",
                        "message": f"Mediendatei nicht gefunden: {media_path}",
                    }
            # 2. YouTube-Audio: lade öffentlich via yt-dlp
            elif source_kind == "youtube" and media_url:
                emit_event({
                    "type": "progress",
                    "id": job_id,
                    "phase": "downloading",
                    "done": 0,
                    "total": 100,
                })

                if not yt_dlp:
                    return {
                        "type": "error",
                        "id": job_id,
                        "code": "YT_DLP_NOT_AVAILABLE",
                        "message": "yt-dlp nicht verfügbar für YouTube-Download",
                    }

                try:
                    # Lade Audio mit yt-dlp (bestaudio Format)
                    media_file = tmpdir_path / "audio.mp4"
                    with yt_dlp.YoutubeDL({
                        "quiet": True,
                        "no_warnings": True,
                        "format": "bestaudio",
                        "outtmpl": str(media_file.with_suffix("")),
                    }) as ydl:
                        ydl.download([media_url])

                    # yt-dlp benennt die Datei um; finde sie
                    for f in tmpdir_path.glob("audio.*"):
                        media_file = f
                        break

                    if not media_file or not media_file.exists():
                        return {
                            "type": "error",
                            "id": job_id,
                            "code": "YOUTUBE_DOWNLOAD_FAILED",
                            "message": "YouTube-Audio konnte nicht heruntergeladen werden",
                        }
                except Exception as e:
                    return {
                        "type": "error",
                        "id": job_id,
                        "code": "YOUTUBE_DOWNLOAD_ERROR",
                        "message": f"YouTube-Download-Fehler: {type(e).__name__}",
                    }
            else:
                # Keine Audioquelle gefunden
                return {
                    "type": "error",
                    "id": job_id,
                    "code": "NO_MEDIA_SOURCE",
                    "message": (
                        "Keine Audioquelle: weder media_path noch YouTube media_url verfügbar"
                    ),
                }

            # Nur Downloading-Event emittieren wenn wirklich geladen (YouTube-Fall)
            if source_kind == "youtube" and media_path is None:
                emit_event({
                    "type": "progress",
                    "id": job_id,
                    "phase": "downloading",
                    "done": 100,
                    "total": 100,
                })

            # Normalisiere zu WAV
            wav_file = tmpdir_path / "normalized.wav"
            try:
                duration = normalize_audio(str(media_file), str(wav_file))
            except Exception as e:
                return {
                    "type": "error",
                    "id": job_id,
                    "code": "NORMALIZATION_FAILED",
                    "message": f"Audio-Normalisierung fehlgeschlagen: {type(e).__name__}",
                }

            # Transkribiere
            emit_event({
                "type": "progress",
                "id": job_id,
                "phase": "transcribing",
                "done": 0,
                "total": 100,
            })

            def on_transcribe_progress(done: int, total: int):
                emit_event({
                    "type": "progress",
                    "id": job_id,
                    "phase": "transcribing",
                    "done": done,
                    "total": total,
                })

            try:
                transcript, backend_label = transcribe_audio(
                    str(wav_file),
                    mapped_model,
                    language,
                    backend_name,
                    backend_module,
                    on_progress=on_transcribe_progress,
                )
            except Exception as e:
                return {
                    "type": "error",
                    "id": job_id,
                    "code": "TRANSCRIPTION_FAILED",
                    "message": f"Transkription fehlgeschlagen: {type(e).__name__}",
                }

            # Prüfe auf leeres Transkript
            if not transcript or not transcript.strip():
                return {
                    "type": "error",
                    "id": job_id,
                    "code": "EMPTY_TRANSCRIPT",
                    "message": "Das resultierende Transkript ist leer",
                }

            emit_event({
                "type": "progress",
                "id": job_id,
                "phase": "transcribing",
                "done": 100,
                "total": 100,
            })

            # Segmentiere in Absätze
            paragraphs = segment_transcript_into_paragraphs(
                transcript,
                backend_name,
                target_duration=30.0,
            )

            emit_event({
                "type": "progress",
                "id": job_id,
                "phase": "writing",
                "done": 0,
                "total": 100,
            })

            # Baue Markdown
            markdown = build_markdown_transcript(
                title=title,
                course_name=metadata.get("course_name"),
                recording_date=metadata.get("recording_date"),
                source_url=source_url,
                model_label=backend_label,
                duration_seconds=duration,
                paragraphs=paragraphs,
            )

            # Schreibe atomar
            output_file = validate_output_path(output_path, library_root)
            output_file.parent.mkdir(parents=True, exist_ok=True)
            temp_file = output_file.with_suffix(".tmp")
            temp_file.write_text(markdown, encoding="utf-8")
            os.replace(temp_file, output_file)

            emit_event({
                "type": "progress",
                "id": job_id,
                "phase": "writing",
                "done": 100,
                "total": 100,
            })

            # Temporäre Dateien werden durch TemporaryDirectory gelöscht

        return {
            "type": "result",
            "id": job_id,
            "transcript_path": str(output_file),
            "backend": backend_name,
            "model": backend_label,
            "duration_seconds": duration,
        }

    except Exception as e:
        # Redigiere Fehlermeldung (keine Secrets)
        error_code = type(e).__name__
        generic_message = "Transkription fehlgeschlagen (siehe Logs für Details)"
        return {
            "type": "error",
            "id": job_id,
            "code": error_code,
            "message": generic_message,
        }


def emit_event(event: dict[str, Any]) -> None:
    """
    Gebe Event auf stdout als JSON-Zeile aus (JSONL-Protokoll).
    """
    print(json.dumps(event), flush=True)


def main() -> None:
    """
    Hauptschleife: Lese JSONL-Requests von stdin, verarbeite seriell,
    gebe Events auf stdout zurück.
    """
    # Sende "ready"-Event beim Start
    emit_event({"type": "ready"})

    # Lese Requests von stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            emit_event({
                "type": "error",
                "id": "unknown",
                "code": "INVALID_JSON",
                "message": "Ungültiges JSON in Request",
            })
            continue

        # Verarbeite Request
        response = process_request(request)

        # Gebe Response aus
        emit_event(response)


if __name__ == "__main__":
    main()
