import type { Activity, Course, RecordingCandidate } from '../shared/domain';
import { parseCourses } from './parsers/courses';
import { parseFolderHtml } from './parsers/folder';
import { parseCourseOverview } from './parsers/overview';
import { parseResourceResponse } from './parsers/resource';
import { parsePageHtml, type ParsedPage } from './parsers/page';
import { parseUrlResponse, type ParsedUrlActivity } from './parsers/url';
import { parseRecordingsFromHtml } from './parsers/recording';
import type { LearnwebSession } from './session';

export interface DownloadTarget {
  activityCmid: number;
  sourceUrl: string;
  filename: string;
}

export class LearnwebClient {
  constructor(private readonly session: LearnwebSession) {}

  async listCourses(): Promise<Course[]> {
    const response = await this.session.get('/my/index.php', { allowRedirects: true });
    return parseCourses(response.data, this.session.getBaseUrl()).map((course) => ({
      courseId: course.courseId,
      fullname: course.name,
      shortname: null,
      semester: course.semester,
      courseUrl: course.url,
      isSelected: false,
      firstSeenAt: null,
      lastSeenAt: null,
    }));
  }

  async listActivities(courseId: number): Promise<Activity[]> {
    const response = await this.session.get(`/course/view.php?id=${courseId}`);
    const overview = parseCourseOverview(response.data, courseId, this.session.getBaseUrl());
    return overview.sections.flatMap((section, sectionIndex) => section.activities.map((activity) => ({
      cmid: activity.cmid,
      courseId,
      modtype: activity.modtype,
      name: activity.name,
      sectionName: section.name || null,
      sectionIndex,
      viewUrl: activity.url,
      isSelected: false,
      status: 'discovered' as const,
      lastSeenAt: null,
    })));
  }

  async resolveDownloadTargets(activity: Activity): Promise<DownloadTarget[]> {
    if (activity.modtype === 'resource') {
      const response = await this.session.get(`/mod/resource/view.php?id=${activity.cmid}`);
      const resource = parseResourceResponse(response, activity.cmid, this.session.getBaseUrl());
      return resource.downloadUrl ? [{
        activityCmid: activity.cmid,
        sourceUrl: resource.downloadUrl,
        filename: resource.filename ?? activity.name,
      }] : [];
    }
    if (activity.modtype === 'folder') {
      const response = await this.session.get(`/mod/folder/view.php?id=${activity.cmid}`);
      if (response.status < 200 || response.status >= 300) return [];
      return parseFolderHtml(response.data, activity.cmid, this.session.getBaseUrl()).entries.map((entry) => ({
        activityCmid: activity.cmid,
        sourceUrl: entry.downloadUrl,
        filename: entry.name,
      }));
    }
    return [];
  }

  async readUrlActivity(cmid: number): Promise<ParsedUrlActivity> {
    const response = await this.session.get(`/mod/url/view.php?id=${cmid}`);
    return parseUrlResponse(
      response.data,
      cmid,
      this.session.getBaseUrl(),
      response.headers.location,
    );
  }

  async readPage(cmid: number): Promise<ParsedPage> {
    const response = await this.session.get(`/mod/page/view.php?id=${cmid}`);
    return parsePageHtml(response.data, cmid);
  }

  /**
   * Löst Recordings (Opencast, YouTube, Mediendateien) für eine gegebene Aktivität auf.
   * Unterstützt url, page, resource, folder und andere Aktivitätstypen, die HTML-Inhalte haben.
   * Gibt eine flache Liste von RecordingCandidate-Objekten zurück.
   */
  async resolveRecordingCandidates(activity: Activity): Promise<RecordingCandidate[]> {
    let htmlContent: string;
    let redirectLocation: string | undefined;

    if (activity.modtype === 'url') {
      // URL-Aktivitäten: externe Links, potentiell zu Streaming-Plattformen
      const response = await this.session.get(`/mod/url/view.php?id=${activity.cmid}`);
      htmlContent = response.data;
      redirectLocation = response.headers.location;
    } else if (activity.modtype === 'page') {
      // Page-Aktivitäten: HTML-Seiten mit potenziellen Embeddings
      const response = await this.session.get(`/mod/page/view.php?id=${activity.cmid}`);
      htmlContent = response.data;
      redirectLocation = response.headers.location;
    } else if (activity.modtype === 'resource') {
      // Ressourcen-Aktivitäten: können Mediendateien sein
      const response = await this.session.get(`/mod/resource/view.php?id=${activity.cmid}`);
      htmlContent = response.data;
      redirectLocation = response.headers.location;
    } else if (activity.modtype === 'folder') {
      // Ordner-Aktivitäten: können mehrere Mediendateien enthalten
      const response = await this.session.get(`/mod/folder/view.php?id=${activity.cmid}`);
      if (response.status < 200 || response.status >= 300) return [];
      htmlContent = response.data;
      redirectLocation = response.headers.location;
    } else {
      // Unbekannte Aktivitätstypen: keine Recordings extrahierbar
      return [];
    }

    const redirectAnchor = redirectLocation
      ? `<a href="${escapeHtmlAttribute(redirectLocation)}">Weiterleitung</a>`
      : '';
    return parseRecordingsFromHtml(`${htmlContent}${redirectAnchor}`, this.session.getBaseUrl(), {
      courseId: activity.courseId,
      activityCmid: activity.cmid,
      sectionName: activity.sectionName,
      sectionIndex: activity.sectionIndex,
    });
  }

  /**
   * Scannt alle übergebenen Aktivitäten nach Recordings und dedupliziert nach recordingKey.
   * Gibt eine Liste einzigartiger RecordingCandidate-Objekte zurück.
   */
  async scanRecordings(activities: Activity[]): Promise<RecordingCandidate[]> {
    const allCandidates: RecordingCandidate[] = [];

    for (const activity of activities) {
      try {
        const candidates = await this.resolveRecordingCandidates(activity);
        allCandidates.push(...candidates);
      } catch {
        // Fehler bei einzelnen Aktivitäten werden ignoriert;
        // der Scan läuft weiter mit den nächsten.
      }
    }

    // Dedupliziere nach recordingKey: Behalte die erste Instanz
    const seen = new Map<string, RecordingCandidate>();
    for (const candidate of allCandidates) {
      if (!seen.has(candidate.recordingKey)) {
        seen.set(candidate.recordingKey, candidate);
      }
    }

    return Array.from(seen.values());
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
