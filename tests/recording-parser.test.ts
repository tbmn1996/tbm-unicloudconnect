import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpencastEpisodes, parseRecordingsFromHtml } from '../src/learnweb-core/parsers/recording';

const BASE_URL = 'https://learnweb.example/moodle';

// ============================================================================
// OPENCAST / PAELLA TESTS
// ============================================================================

test('Münster-Opencast: parst window.episode mit escaped MP4-URL', () => {
  const html = String.raw`
    <script>
      window.episode = {
        "metadata": {
          "id": "ABCDEFAB-1234-5678-90AB-ABCDEFABCDEF",
          "title": "Vorlesung 4",
          "created": "2026-06-20T10:15:00Z"
        },
        "tracks": [{"url": "https:\/\/video.example\/lecture\/concat.mp4"}]
      };
    </script>`;

  assert.deepEqual(parseOpencastEpisodes(html, BASE_URL), [{
    episodeId: 'abcdefab-1234-5678-90ab-abcdefabcdef',
    title: 'Vorlesung 4',
    mediaUrl: 'https://video.example/lecture/concat.mp4',
    recordedAt: '2026-06-20T10:15:00.000Z',
    detailQuery: null,
  }]);
});

test('Münster-Opencast: parst Legacy-Liste, filtert Sprachlinks und dedupliziert', () => {
  const firstId = '11111111-1111-1111-1111-111111111111';
  const secondId = '22222222-2222-2222-2222-222222222222';
  const html = `
    <a href="/mod/opencast/view.php?id=42&amp;e=${firstId}">Vorlesung 1</a>
    <a href="/mod/opencast/view.php?id=42&amp;e=${firstId}">de</a>
    <a href="/mod/opencast/view.php?id=42&amp;e=${firstId}">Duplikat</a>
    <a href="/mod/opencast/view.php?id=42&amp;e=${secondId}">Vorlesung 2</a>`;

  const episodes = parseOpencastEpisodes(html, BASE_URL);

  assert.deepEqual(episodes.map((episode) => episode.episodeId), [firstId, secondId]);
  assert.deepEqual(episodes.map((episode) => episode.detailQuery), [
    `&e=${firstId}`,
    `&e=${secondId}`,
  ]);
  assert.deepEqual(episodes.map((episode) => episode.title), ['Vorlesung 1', 'Vorlesung 2']);
});

test('Münster-Opencast: leeres HTML liefert keine Episoden', () => {
  assert.deepEqual(parseOpencastEpisodes('', BASE_URL), []);
});

test('Opencast: erkennt LTI-iframe mit play/<uuid> Format', () => {
  const html = `
    <h1>Vorlesung Softwaretechnik</h1>
    <iframe src="https://opencast.example/play/abc123def456abc123def456abc123de"
            title="Vorlesung 2026-01-15"></iframe>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 7,
    activityCmid: 42,
    sectionName: 'Woche 1',
    sectionIndex: 0,
  });
  assert.equal(candidates.length, 1);
  const rec = candidates[0]!;
  assert.equal(rec.recordingKey, 'abc123def456abc123def456abc123de');
  assert.equal(rec.sourceKind, 'opencast');
  assert.equal(rec.needsAuth, true);
  assert.equal(rec.hasSubtitles, false);
  assert.match(rec.title, /Vorlesung/);
  assert.equal(rec.courseId, 7);
  assert.equal(rec.activityCmid, 42);
  assert.equal(rec.sectionName, 'Woche 1');
  assert.equal(rec.sectionIndex, 0);
});

test('Opencast: erkennt ?id=<uuid> Query-Parameter', () => {
  const html = `
    <a href="https://opencast.example/paella/ui/watch.html?id=xyz789def012xyz789def012xyz78901">
      Aufzeichnung ansehen
    </a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 9,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, 'xyz789def012xyz789def012xyz78901');
  assert.equal(candidates[0]!.sourceKind, 'opencast');
});

test('Opencast: erkennt /paella/ui/watch.html?id=<uuid> Link', () => {
  const html = `
    <iframe src="${BASE_URL}/mod/page/view.php" style="display:none;"></iframe>
    <iframe src="https://opencast.example/paella/ui/watch.html?id=paella1111111111111111111111111111"
            title="Paella Player"></iframe>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 8,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, 'paella1111111111111111111111111111');
});

test('Opencast: dedupliziert mehrfache Links zur gleichen Episode', () => {
  const html = `
    <iframe src="https://opencast.example/play/same-id-aaaabbbbccccdddd"
            title="Aufzeichnung 1"></iframe>
    <a href="https://opencast.example/play/same-id-aaaabbbbccccdddd">
      Nochmal ansehen
    </a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 10,
  });
  // Sollte deduplizieren innerhalb dieser einen Seite
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, 'same-id-aaaabbbbccccdddd');
});

// ============================================================================
// YOUTUBE TESTS
// ============================================================================

test('YouTube: erkennt youtube.com/embed/VIDEO_ID iframe', () => {
  const html = `
    <h1>Zusatzmaterial</h1>
    <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"
            title="Rick Astley"></iframe>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 5,
    activityCmid: 99,
  });
  assert.equal(candidates.length, 1);
  const rec = candidates[0]!;
  assert.equal(rec.recordingKey, 'dQw4w9WgXcQ');
  assert.equal(rec.sourceKind, 'youtube');
  assert.equal(rec.needsAuth, false);
  assert.equal(rec.mediaUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(rec.hasSubtitles, false);
  assert.match(rec.title, /Rick Astley/);
});

test('YouTube: erkennt youtube.com/watch?v=VIDEO_ID Link', () => {
  const html = `
    <a href="https://www.youtube.com/watch?v=9bZkp7q19f0&t=10s">
      Sehr gutes Video
    </a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 6,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, '9bZkp7q19f0');
  assert.equal(candidates[0]!.mediaUrl, 'https://www.youtube.com/watch?v=9bZkp7q19f0');
});

test('YouTube: erkennt youtu.be Shortlinks', () => {
  const html = `
    <a href="https://youtu.be/3jZ_D3FJKhY?t=42">
      Kurzvideo
    </a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 11,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, '3jZ_D3FJKhY');
});

test('YouTube: erkennt youtube.com/v/VIDEO_ID Format', () => {
  const html = `
    <iframe src="https://www.youtube.com/v/abcdefg1234"></iframe>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 12,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, 'abcdefg1234');
});

test('YouTube: dedupliziert mehrfache Links zum gleichen Video', () => {
  const html = `
    <iframe src="https://www.youtube.com/embed/uniqueYT123"></iframe>
    <a href="https://www.youtube.com/watch?v=uniqueYT123">
      Same video
    </a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 13,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, 'uniqueYT123');
});

// ============================================================================
// MEDIA / DIRECT FILE TESTS
// ============================================================================

test('Media: erkennt direkten MP4-Link', () => {
  const html = `
    <h1>Vorlesungsmitschnitt</h1>
    <a href="/pluginfile.php/123/mod_resource/content/0/lecture.mp4">
      Herunterladen
    </a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 3,
    activityCmid: 33,
  });
  assert.equal(candidates.length, 1);
  const rec = candidates[0]!;
  assert.equal(rec.sourceKind, 'media');
  assert.equal(rec.needsAuth, true);
  assert.match(rec.mediaUrl, /lecture\.mp4/);
  assert.equal(rec.hasSubtitles, false);
  assert.match(rec.title, /Herunterladen|Vorlesungsmitschnitt/);
});

test('Media: erkennt MP3-Audiodatei in HTML5 audio-Tag', () => {
  const html = `
    <audio controls>
      <source src="https://learnweb.example/moodle/pluginfile.php/456/audio.mp3"
              type="audio/mpeg">
    </audio>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 14,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.sourceKind, 'media');
  assert.match(candidates[0]!.mediaUrl, /audio\.mp3/);
});

test('Media: erkennt M4A-Datei', () => {
  const html = `
    <a href="/assets/podcast.m4a?version=2">
      Podcast
    </a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 15,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.sourceKind, 'media');
  assert.match(candidates[0]!.mediaUrl, /podcast\.m4a/);
});

test('Media: erkennt WEBM-Videodatei', () => {
  const html = `
    <video width="640" height="480" controls>
      <source src="/media/lesson.webm" type="video/webm">
    </video>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 16,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.sourceKind, 'media');
  assert.match(candidates[0]!.mediaUrl, /lesson\.webm/);
});

test('Media: erkennt MOV-Datei (macOS-Format)', () => {
  const html = `
    <a href="/assets/recording.mov">
      Recording
    </a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 17,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.sourceKind, 'media');
  assert.match(candidates[0]!.mediaUrl, /recording\.mov/);
});

test('Media: dedupliziert mehrfache Links zur gleichen Datei', () => {
  const html = `
    <a href="/files/video.mp4">Link 1</a>
    <a href="/files/video.mp4">Link 2</a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 18,
  });
  assert.equal(candidates.length, 1);
  assert.match(candidates[0]!.mediaUrl, /video\.mp4/);
});

test('Media: ignoriert Links zu nicht-Mediendateien', () => {
  const html = `
    <a href="/doc/skript.pdf">PDF</a>
    <a href="/files/example.zip">ZIP</a>
    <a href="/image.jpg">Bild</a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 19,
  });
  assert.equal(candidates.length, 0);
});

// ============================================================================
// MIXED / INTEGRATION TESTS
// ============================================================================

test('Mixed: erkennt mehrere unterschiedliche Aufzeichnungen auf einer Seite', () => {
  const html = `
    <h1>Kompletter Kurs mit Recordings</h1>

    <h2>Teil 1: Opencast</h2>
    <iframe src="https://opencast.example/play/opencast-id-aabbccdd"></iframe>

    <h2>Teil 2: YouTube-Videos</h2>
    <iframe src="https://www.youtube.com/embed/youtubeId12"></iframe>

    <h2>Teil 3: Direkte Mediendateien</h2>
    <a href="/files/mitschnitt.mp4">Download</a>
    <audio>
      <source src="/files/notes.mp3">
    </audio>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 20,
    activityCmid: 200,
  });
  assert.equal(candidates.length, 4);

  const kinds = candidates.map((c) => c.sourceKind).sort();
  assert.deepEqual(kinds, ['media', 'media', 'opencast', 'youtube']);
});

test('Preserved Context: CourseId, ActivityCmid, Section werden korrekt übergeben', () => {
  const html = `
    <iframe src="https://opencast.example/play/episode-123"></iframe>
    <a href="https://www.youtube.com/watch?v=videoId456"></a>
    <a href="/files/recording.mp4"></a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 42,
    activityCmid: 555,
    sectionName: 'Woche 5',
    sectionIndex: 4,
  });

  for (const rec of candidates) {
    assert.equal(rec.courseId, 42);
    assert.equal(rec.activityCmid, 555);
    assert.equal(rec.sectionName, 'Woche 5');
    assert.equal(rec.sectionIndex, 4);
  }
});

test('Empty HTML: gibt leeres Array zurück bei leerem HTML', () => {
  const html = '<p>Keine Recordings auf dieser Seite</p>';
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 30,
  });
  assert.equal(candidates.length, 0);
});

test('Relative URLs: werden korrekt zu absoluten URLs auflöst', () => {
  const html = `
    <a href="/files/recording.mp4">MP4</a>
  `;
  const candidates = parseRecordingsFromHtml(html, 'https://learnweb.example/moodle', {
    courseId: 40,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.mediaUrl, 'https://learnweb.example/files/recording.mp4');
});

test('Malformed URLs: werden sicher behandelt', () => {
  const html = `
    <a href="ht tp://invalid url space">Bad</a>
    <a href="/correct/path/video.mp4">Good</a>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 41,
  });
  // Sollte nur die gültige URL erkennen
  assert.equal(candidates.length, 1);
  assert.match(candidates[0]!.mediaUrl, /video\.mp4/);
});

test('Opencast: igniert nicht-UUID-Patterns', () => {
  const html = `
    <iframe src="https://opencast.example/play/not-a-uuid"></iframe>
    <iframe src="https://opencast.example/play/abc123def456abc123def456abc123de"></iframe>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 50,
  });
  // Sollte nur die korrekte UUID erkennen
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, 'abc123def456abc123def456abc123de');
});

test('YouTube: ignoriert ungültige Video-IDs (nicht 11 Zeichen)', () => {
  const html = `
    <iframe src="https://www.youtube.com/embed/short"></iframe>
    <iframe src="https://www.youtube.com/embed/validId1234567"></iframe>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 51,
  });
  // 'short' hat nur 5 Zeichen, 'validId1234567' hat 15 => auch igniert
  // YouTube IDs sind genau 11 Zeichen lang
  assert.equal(candidates.length, 0);
});

test('RecordingKey eindeutigkeit: gleiche Recording auf zwei Wegen erkannt => dedupliziert', () => {
  const html = `
    <iframe src="https://www.youtube.com/embed/abcDEF12345"></iframe>
    <a href="https://youtu.be/abcDEF12345">Same video</a>
  `;
  // Diese Funktion dedupliziert noch nicht (das macht scanRecordings),
  // aber die interne Logik der extractYoutubeRecordings sollte deduplizieren.
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 52,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.recordingKey, 'abcDEF12345');
});

test('Fields completeness: alle RecordingCandidate-Felder sind gesetzt', () => {
  const html = `
    <iframe src="https://opencast.example/play/full-test-id-1111111"></iframe>
  `;
  const candidates = parseRecordingsFromHtml(html, BASE_URL, {
    courseId: 60,
    activityCmid: 600,
    sectionName: 'Test Section',
    sectionIndex: 99,
  });
  assert.equal(candidates.length, 1);
  const rec = candidates[0]!;

  // Prüfe, dass alle Felder vorhanden sind
  assert.ok('recordingKey' in rec && rec.recordingKey);
  assert.ok('courseId' in rec && rec.courseId === 60);
  assert.ok('activityCmid' in rec && rec.activityCmid === 600);
  assert.ok('title' in rec && rec.title);
  assert.ok('sourceKind' in rec && rec.sourceKind === 'opencast');
  assert.ok('mediaUrl' in rec && rec.mediaUrl);
  assert.ok('needsAuth' in rec && typeof rec.needsAuth === 'boolean');
  assert.ok('hasSubtitles' in rec && typeof rec.hasSubtitles === 'boolean');
  assert.ok('sectionName' in rec && rec.sectionName === 'Test Section');
  assert.ok('sectionIndex' in rec && rec.sectionIndex === 99);
  assert.ok('recordingDate' in rec && rec.recordingDate === null);
});
