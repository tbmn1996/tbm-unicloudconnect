import * as cheerio from 'cheerio';
import * as crypto from 'node:crypto';
import type { RecordingCandidate } from '../../shared/domain';
import { absoluteUrl, normalizeText } from './common';

/**
 * Kontext, der beim Parsen von Recordings übergeben wird.
 * Enthält Kurs-, Aktivitäts- und Section-Informationen.
 */
export interface RecordingParseContext {
  courseId: number;
  activityCmid?: number | null;
  sectionName?: string | null;
  sectionIndex?: number | null;
}

/**
 * Erkannte Opencast-Episode aus HTML-Markup.
 */
interface OpencastCandidate {
  episodeId: string;
  mediaUrl: string;
  title: string | null;
}

/**
 * Erkannte YouTube-Episode aus HTML-Markup.
 */
interface YoutubeCandidate {
  videoId: string;
  mediaUrl: string;
  title: string | null;
  hasSubtitles: boolean;
}

/**
 * Erkannte Mediendatei (mp4/m4a/mp3/webm/mov) aus HTML.
 */
interface MediaCandidate {
  url: string;
  title: string | null;
}

/**
 * Extrahiert stabile Recording-Keys basierend auf dem Quelltyp.
 */
function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Normalisiert Text zu string oder null (statt leerem String).
 */
function normalizeTextOrNull(text: string | null | undefined): string | null {
  const normalized = normalizeText(text);
  return normalized || null;
}

/**
 * Konvertiert undefined zu null für Typ-Kompatibilität.
 */
function toNullable(value: string | undefined): string | null {
  return value ?? null;
}

/**
 * Erkennt Opencast-Episoden in zwei gängigen Einbettungsformaten:
 * (a) LTI-/Opencast-iframe oder Engage-Link mit Episode-/Event-ID
 * (b) Direkter Paella-Player-/Mediapackage-Link
 */
function extractOpencastRecordings(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  title: string | null = null,
): OpencastCandidate[] {
  const candidates: OpencastCandidate[] = [];
  const seenIds = new Set<string>();

  // Format (a): LTI-/Opencast-iframe oder Engage-Link
  // Suchmuster: .../play/<uuid> oder ?id=<uuid> oder /paella/ui/watch.html?id=<uuid>
  $('iframe[src*="opencast"], iframe[src*="paella"], a[href*="opencast"], a[href*="paella"]').each(
    (_i, elem) => {
      const src = $(elem).attr('src') || $(elem).attr('href') || '';
      if (!src) return;

      let episodeId: string | null = null;

      // Muster: /play/<id> (Opencast-UUID o. ä.; min. 16 Zeichen verhindert Falschtreffer)
      let match = src.match(/\/play\/([a-zA-Z0-9_-]{16,})/i);
      if (match?.[1]) {
        episodeId = match[1];
      }

      // Muster: ?id=<id> oder &id=<id>
      if (!episodeId) {
        match = src.match(/[?&]id=([a-zA-Z0-9_-]{16,})/i);
        if (match?.[1]) {
          episodeId = match[1];
        }
      }

      // Muster: /paella/ui/watch.html?id=<id>
      if (!episodeId && src.includes('/paella/ui/watch.html')) {
        match = src.match(/watch\.html\?id=([a-zA-Z0-9_-]{16,})/i);
        if (match?.[1]) {
          episodeId = match[1];
        }
      }

      if (episodeId && !seenIds.has(episodeId)) {
        seenIds.add(episodeId);
        const mediaUrl = absoluteUrl(baseUrl, src);
        const elemTitle =
          toNullable($(elem).attr('title')) ||
          normalizeText($(elem).text()) ||
          title ||
          `Opencast Recording ${episodeId.slice(0, 8)}`;
        candidates.push({
          episodeId,
          mediaUrl,
          title: normalizeTextOrNull(elemTitle),
        });
      }
    },
  );

  // Format (b): Direkter Link zu Paella-Player oder Mediapackage
  $('a[href*="player.opencast"], a[href*="mediapackage"]').each((_i, elem) => {
    const href = $(elem).attr('href') || '';
    if (!href) return;

    // Versuche Episode-ID zu extrahieren (UUID-Länge 36)
    const match = href.match(/[/?]([a-zA-Z0-9_-]{36})/);
    const episodeId = match ? match[1] : null;

    if (episodeId && !seenIds.has(episodeId)) {
      seenIds.add(episodeId);
      const mediaUrl = absoluteUrl(baseUrl, href);
      const elemTitle =
        toNullable($(elem).attr('title')) ||
        normalizeText($(elem).text()) ||
        title ||
        `Opencast Recording ${episodeId.slice(0, 8)}`;
      candidates.push({
        episodeId,
        mediaUrl,
        title: normalizeTextOrNull(elemTitle),
      });
    }
  });

  return candidates;
}

/**
 * Erkennt eingebettete YouTube-Videos.
 * Unterstützt: youtube.com/watch?v=, youtu.be/, /embed/, /v/
 */
function extractYoutubeRecordings(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  title: string | null = null,
): YoutubeCandidate[] {
  const candidates: YoutubeCandidate[] = [];
  const seenIds = new Set<string>();

  // YouTube iframes: src="https://www.youtube.com/embed/VIDEO_ID"
  $('iframe[src*="youtube.com"], iframe[src*="youtu.be"]').each((_i, elem) => {
    const src = $(elem).attr('src') || '';
    if (!src) return;

    let videoId: string | null = null;

    // Format: .../embed/VIDEO_ID oder .../v/VIDEO_ID
    const embedMatch = src.match(/(?:embed|v)\/([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/);
    if (embedMatch?.[1]) {
      videoId = embedMatch[1];
    }

    if (videoId && !seenIds.has(videoId)) {
      seenIds.add(videoId);
      const mediaUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const elemTitle =
        toNullable($(elem).attr('title')) || title || `YouTube Video ${videoId}`;
      candidates.push({
        videoId,
        mediaUrl,
        title: normalizeTextOrNull(elemTitle),
        hasSubtitles: false, // YouTube-Untertitel werden später vom Worker geprüft
      });
    }
  });

  // YouTube Links: <a href="https://www.youtube.com/watch?v=VIDEO_ID">
  $('a[href*="youtube.com"], a[href*="youtu.be"]').each((_i, elem) => {
    const href = $(elem).attr('href') || '';
    if (!href) return;

    let videoId: string | null = null;
    let match;

    // Format: youtube.com/watch?v=VIDEO_ID
    match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/);
    if (match?.[1]) {
      videoId = match[1];
    }

    // Format: youtu.be/VIDEO_ID
    if (!videoId) {
      match = href.match(/youtu\.be\/([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/);
      if (match?.[1]) {
        videoId = match[1];
      }
    }

    // Format: youtube.com/embed/VIDEO_ID oder youtube.com/v/VIDEO_ID
    if (!videoId) {
      match = href.match(/(?:embed|v)\/([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/);
      if (match?.[1]) {
        videoId = match[1];
      }
    }

    if (videoId && !seenIds.has(videoId)) {
      seenIds.add(videoId);
      const mediaUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const elemTitle =
        toNullable($(elem).attr('title')) ||
        normalizeText($(elem).text()) ||
        `YouTube Video ${videoId}`;
      candidates.push({
        videoId,
        mediaUrl,
        title: normalizeTextOrNull(elemTitle),
        hasSubtitles: false,
      });
    }
  });

  return candidates;
}

/**
 * Erkennt direkte Mediendateien (mp4, m4a, mp3, webm, mov) in Links und iframes.
 */
function extractMediaRecordings(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  title: string | null = null,
): MediaCandidate[] {
  const candidates: MediaCandidate[] = [];
  const mediaRegex = /\.(mp4|m4a|mp3|webm|mov)(\?|#|$)/i;
  const seenUrls = new Set<string>();

  // Audio/Video iframes oder Video-Tags
  $('iframe[src], video source[src], audio source[src]').each((_i, elem) => {
    const src = $(elem).attr('src') || '';
    if (src && mediaRegex.test(src)) {
      const mediaUrl = absoluteUrl(baseUrl, src);
      if (!seenUrls.has(mediaUrl)) {
        seenUrls.add(mediaUrl);
        const elemTitle =
          toNullable($(elem).attr('title')) ||
          toNullable($(elem).attr('alt')) ||
          title ||
          'Mediendatei';
        candidates.push({
          url: mediaUrl,
          title: normalizeTextOrNull(elemTitle),
        });
      }
    }
  });

  // Links zu Mediendateien
  $('a[href]').each((_i, elem) => {
    const href = $(elem).attr('href') || '';
    if (href && mediaRegex.test(href)) {
      const mediaUrl = absoluteUrl(baseUrl, href);
      if (!seenUrls.has(mediaUrl)) {
        seenUrls.add(mediaUrl);
        const elemTitle =
          toNullable($(elem).attr('title')) ||
          normalizeText($(elem).text()) ||
          title ||
          'Mediendatei';
        candidates.push({
          url: mediaUrl,
          title: normalizeTextOrNull(elemTitle),
        });
      }
    }
  });

  return candidates;
}

/**
 * Parsed HTML und extrahiert alle erkannten Recordings (Opencast, YouTube, Mediendateien).
 * Gibt eine flache Liste von RecordingCandidate-Objekten zurück.
 */
export function parseRecordingsFromHtml(
  html: string,
  baseUrl: string,
  context: RecordingParseContext,
): RecordingCandidate[] {
  const $ = cheerio.load(html);
  const results: RecordingCandidate[] = [];

  // Extrahiere Seitentitel, falls vorhanden
  const pageTitle = normalizeTextOrNull($('h1, h2').first().text());

  // Opencast-Recordings
  const opencastCandidates = extractOpencastRecordings($, baseUrl, pageTitle);
  for (const oc of opencastCandidates) {
    results.push({
      recordingKey: oc.episodeId,
      courseId: context.courseId,
      activityCmid: context.activityCmid ?? null,
      title: oc.title ?? 'Opencast Recording',
      sourceKind: 'opencast',
      mediaUrl: oc.mediaUrl,
      needsAuth: true, // Opencast ist LearnWeb-geschützt
      hasSubtitles: false, // Wird später vom Worker geprüft
      sectionName: context.sectionName ?? null,
      sectionIndex: context.sectionIndex ?? null,
      recordingDate: null, // Wird später vom Worker geprüft
    });
  }

  // YouTube-Recordings
  const youtubeCandidates = extractYoutubeRecordings($, baseUrl, pageTitle);
  for (const yt of youtubeCandidates) {
    results.push({
      recordingKey: yt.videoId,
      courseId: context.courseId,
      activityCmid: context.activityCmid ?? null,
      title: yt.title ?? 'YouTube Video',
      sourceKind: 'youtube',
      mediaUrl: yt.mediaUrl,
      needsAuth: false, // YouTube ist öffentlich
      hasSubtitles: yt.hasSubtitles ?? false,
      sectionName: context.sectionName ?? null,
      sectionIndex: context.sectionIndex ?? null,
      recordingDate: null,
    });
  }

  // Direkte Mediendateien
  const mediaCandidates = extractMediaRecordings($, baseUrl, pageTitle);
  for (const media of mediaCandidates) {
    results.push({
      recordingKey: hashUrl(media.url),
      courseId: context.courseId,
      activityCmid: context.activityCmid ?? null,
      title: media.title ?? 'Mediendatei',
      sourceKind: 'media',
      mediaUrl: media.url,
      needsAuth: true, // Mediendateien sind LearnWeb-geschützt
      hasSubtitles: false,
      sectionName: context.sectionName ?? null,
      sectionIndex: context.sectionIndex ?? null,
      recordingDate: null,
    });
  }

  return results;
}
