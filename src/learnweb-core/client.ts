import type { Activity, Course } from '../shared/domain';
import { parseCourses } from './parsers/courses';
import { parseFolderHtml } from './parsers/folder';
import { parseCourseOverview } from './parsers/overview';
import { parseResourceResponse } from './parsers/resource';
import { parsePageHtml, type ParsedPage } from './parsers/page';
import { parseUrlResponse, type ParsedUrlActivity } from './parsers/url';
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
}
