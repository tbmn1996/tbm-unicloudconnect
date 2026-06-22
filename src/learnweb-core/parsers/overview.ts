import * as cheerio from 'cheerio';
import { absoluteUrl, decodeHtmlEntities, normalizeText, truncate } from './common';

export interface ParsedActivity {
  cmid: number;
  name: string;
  modtype: string;
  url: string;
}

export interface ParsedSection {
  name: string;
  activities: ParsedActivity[];
}

export interface ParsedCourseOverview {
  courseId: number;
  courseName: string;
  sections: ParsedSection[];
}

export function parseCourseOverview(
  html: string,
  courseId: number,
  baseUrl: string,
): ParsedCourseOverview {
  const $ = cheerio.load(html);
  const courseName = normalizeText($('h1').first().text()) || `Kurs ${courseId}`;
  const sections: ParsedSection[] = [];

  $('li.course-section').each((_, sectionElement) => {
    const section = $(sectionElement);
    // data-sectionname ist ein HTML-Attribut → .attr() gibt rohe Entities zurück → dekodieren.
    const name = decodeHtmlEntities(section.attr('data-sectionname'))
      || normalizeText(section.find('h3, h4').first().text());
    const activities: ParsedActivity[] = [];

    section.find('ul[data-for="cmlist"] li[data-for="cmitem"]').each((__, itemElement) => {
      const item = $(itemElement);
      const cmid = Number.parseInt(item.attr('data-id') ?? '', 10);
      if (!Number.isFinite(cmid)) return;
      const modtype = item.attr('class')?.match(/\bmodtype_([a-z_]+)/)?.[1] ?? '';
      if (!modtype || modtype === 'label') return;
      // data-activityname ist ein HTML-Attribut → .attr() gibt rohe Entities zurück → dekodieren.
      const activityName = (
        decodeHtmlEntities(item.find('[data-activityname]').first().attr('data-activityname'))
        || normalizeText(item.find('.instancename').first().text())
      ) || `Aktivität ${cmid}`;
      const href = item.find('a.aalink, a.stretched-link').first().attr('href')
        ?? `/mod/${modtype}/view.php?id=${cmid}`;
      activities.push({
        cmid,
        name: truncate(activityName, 200),
        modtype,
        url: absoluteUrl(baseUrl, href),
      });
    });

    if (activities.length > 0) sections.push({ name, activities });
  });

  return { courseId, courseName, sections };
}
