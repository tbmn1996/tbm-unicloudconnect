import * as cheerio from 'cheerio';
import type { LearnwebResponse } from '../session';
import { absoluteUrl, extractText, normalizeText } from './common';

export interface ParsedResource {
  title: string;
  description?: string;
  filename?: string;
  downloadUrl?: string;
}

export function parseResourceResponse(
  response: LearnwebResponse,
  cmid: number,
  baseUrl: string,
): ParsedResource {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.location;
    return {
      title: `Ressource ${cmid}`,
      downloadUrl: location ? absoluteUrl(baseUrl, location) : undefined,
    };
  }
  if (response.status < 200 || response.status >= 300) return { title: `Ressource ${cmid}` };

  const $ = cheerio.load(response.data);
  const href = $('a[href*="pluginfile.php"], a[href*="forcedownload"]').first().attr('href');
  const downloadUrl = href ? absoluteUrl(baseUrl, href) : undefined;
  let filename: string | undefined;
  if (downloadUrl) {
    try {
      filename = decodeURIComponent(new URL(downloadUrl).pathname.split('/').pop() ?? '') || undefined;
    } catch {
      filename = undefined;
    }
  }
  return {
    title: normalizeText($('h1, h2').first().text()) || `Ressource ${cmid}`,
    description: extractText($, '.activity-description, #intro', 2_000) || undefined,
    filename,
    downloadUrl,
  };
}
