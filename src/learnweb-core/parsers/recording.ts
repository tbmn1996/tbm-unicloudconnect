import * as cheerio from 'cheerio';
import * as crypto from 'node:crypto';
import type { RecordingCandidate } from '../../shared/domain';
import { absoluteUrl, decodeHtmlEntities, normalizeText } from './common';

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

export interface OpencastEpisode {
  episodeId: string | null;
  title: string | null;
  mediaUrl: string | null;
  recordedAt: string | null;
  detailQuery: string | null;
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
export function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

export function parseOpencastEpisodes(html: string, baseUrl: string): OpencastEpisode[] {
  if (!html) return [];

  const windowMatch = html.match(/window\.episode\s*=\s*(\{.*?\})\s*;/s);
  if (windowMatch?.[1]) {
    const rawEpisode = windowMatch[1];
    const mediaUrl = extractFirstMp4Url(rawEpisode, baseUrl)
      ?? extractFirstMp4Url(html, baseUrl);
    if (mediaUrl) {
      const episode = parseJsonObject(rawEpisode);
      const metadata = isRecord(episode?.metadata) ? episode.metadata : null;
      return [{
        episodeId: stringValue(metadata?.id) ?? stringValue(episode?.id)?.toLowerCase() ?? null,
        title: stringValue(metadata?.title) ?? stringValue(episode?.title) ?? null,
        mediaUrl,
        recordedAt: findRecordedAt(episode, rawEpisode),
        detailQuery: null,
      }].map((item) => ({
        ...item,
        episodeId: item.episodeId?.toLowerCase() ?? null,
      }));
    }
  }

  const $ = cheerio.load(html);
  const legacy: OpencastEpisode[] = [];
  const seen = new Set<string>();
  $('a[href*="/mod/opencast/view.php"]').each((_index, element) => {
    const href = ($(element).attr('href') ?? '').replaceAll('&amp;', '&');
    const match = href.match(/[?&]e=([0-9a-f-]{36})/i);
    if (!match?.[1]) return;
    const text = normalizeText($(element).text());
    if (/^(?:de|en)$/i.test(text)) return;
    const episodeId = match[1].toLowerCase();
    if (seen.has(episodeId)) return;
    seen.add(episodeId);
    legacy.push({
      episodeId,
      title: text || null,
      mediaUrl: null,
      recordedAt: null,
      detailQuery: `&e=${episodeId}`,
    });
  });
  if (legacy.length > 0) return legacy;

  const mediaUrl = extractFirstMp4Url(html, baseUrl);
  return mediaUrl ? [{
    episodeId: null,
    title: null,
    mediaUrl,
    recordedAt: findRecordedAt(null, html),
    detailQuery: null,
  }] : [];
}

function extractFirstMp4Url(text: string, baseUrl: string): string | null {
  const match = text.match(/https?:\\?\/\\?\/[^\s"'<>]+?\.mp4(?:[?#][^\s"'<>]*)?/i);
  if (!match?.[0]) return null;
  return absoluteUrl(baseUrl, match[0].replaceAll('\\/', '/'));
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function findRecordedAt(episode: Record<string, unknown> | null, rawText: string): string | null {
  const metadata = isRecord(episode?.metadata) ? episode.metadata : null;
  const candidates = [metadata?.created, metadata?.start, episode?.created, episode?.start];
  for (const candidate of candidates) {
    const normalized = normalizeRecordedAt(candidate);
    if (normalized) return normalized;
  }
  const rawMatch = rawText.match(/"(?:created|start)"\s*:\s*"([^"]+)"/);
  return normalizeRecordedAt(rawMatch?.[1]);
}

function normalizeRecordedAt(value: unknown): string | null {
  if ((typeof value !== 'string' || !value.trim()) && typeof value !== 'number') return null;
  const timestamp = typeof value === 'number' ? value * 1_000 : value;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
          // .attr('title') gibt rohe HTML-Entities zurück → dekodieren
          toNullable(decodeHtmlEntities($(elem).attr('title'))) ||
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
        // .attr('title') gibt rohe HTML-Entities zurück → dekodieren
        toNullable(decodeHtmlEntities($(elem).attr('title'))) ||
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
        // .attr('title') gibt rohe HTML-Entities zurück → dekodieren
        toNullable(decodeHtmlEntities($(elem).attr('title'))) || title || `YouTube Video ${videoId}`;
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
        // .attr('title') gibt rohe HTML-Entities zurück → dekodieren
        toNullable(decodeHtmlEntities($(elem).attr('title'))) ||
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
          // .attr('title')/.attr('alt') geben rohe HTML-Entities zurück → dekodieren
          toNullable(decodeHtmlEntities($(elem).attr('title'))) ||
          toNullable(decodeHtmlEntities($(elem).attr('alt'))) ||
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
          // .attr('title') gibt rohe HTML-Entities zurück → dekodieren
          toNullable(decodeHtmlEntities($(elem).attr('title'))) ||
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
