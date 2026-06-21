import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeText } from './common';

export interface ParsedCourse {
  courseId: number;
  name: string;
  semester: string | null;
  url: string;
}

export function parseCourses(html: string, baseUrl: string): ParsedCourse[] {
  const $ = cheerio.load(html);
  const courses = new Map<number, ParsedCourse & { score: number }>();

  $('a[href*="/course/view.php?id="]').each((_, element) => {
    const href = $(element).attr('href');
    const match = href?.match(/[?&]id=(\d+)/);
    if (!href || !match?.[1]) return;
    const courseId = Number.parseInt(match[1], 10);
    const title = normalizeText($(element).attr('title'));
    const text = normalizeText($(element).text());
    const candidates = [
      title ? { name: title, score: scoreName(title, true) } : null,
      text ? { name: text, score: scoreName(text, false) } : null,
    ].filter((candidate): candidate is { name: string; score: number } => candidate !== null);
    const candidate = candidates.sort((a, b) => b.score - a.score)[0];
    if (!candidate || candidate.score <= (courses.get(courseId)?.score ?? -1)) return;
    courses.set(courseId, {
      courseId,
      name: candidate.name,
      semester: extractSemester(candidate.name),
      url: absoluteUrl(baseUrl, href),
      score: candidate.score,
    });
  });

  return Array.from(courses.values(), ({ score: _score, ...course }) => course);
}

export function extractSemester(value: string): string | null {
  const abbreviated = value.match(/\b(SoSe|WiSe)\s*(\d{4})(?:\s*\/\s*(\d{2,4}))?/i);
  if (abbreviated) {
    const label = abbreviated[1]?.toLowerCase() === 'sose' ? 'SoSe' : 'WiSe';
    return `${label} ${abbreviated[2]}${abbreviated[3] ? `/${abbreviated[3]}` : ''}`;
  }

  const writtenOut = value.match(/\b(Sommersemester|Wintersemester)\s*(\d{4})(?:\s*\/\s*(\d{2,4}))?/i);
  if (!writtenOut) return null;
  const label = writtenOut[1]?.toLowerCase() === 'sommersemester' ? 'SoSe' : 'WiSe';
  return `${label} ${writtenOut[2]}${writtenOut[3] ? `/${writtenOut[3]}` : ''}`;
}

function scoreName(value: string, fromTitle: boolean): number {
  const isTruncated = /(?:\.\.\.|…)$/.test(value);
  return (isTruncated ? 0 : 1_000) + (fromTitle ? 100 : 0) + Math.min(value.length, 500);
}
