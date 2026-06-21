import * as cheerio from 'cheerio';
import { absoluteUrl, extractText, normalizeText } from './common';

export interface ParsedUrlActivity {
  title: string;
  description?: string;
  externalUrl?: string;
}

export function parseUrlResponse(
  html: string,
  cmid: number,
  baseUrl: string,
  redirectLocation?: string,
): ParsedUrlActivity {
  if (redirectLocation) {
    return { title: `URL ${cmid}`, externalUrl: absoluteUrl(baseUrl, redirectLocation) };
  }
  const $ = cheerio.load(html);
  let externalUrl = $('.urlworkaround a').first().attr('href');
  if (!externalUrl) {
    $('.box.generalbox a, #intro a, main a').each((_, element) => {
      if (externalUrl) return;
      const href = $(element).attr('href');
      if (!href || href.includes('/mod/url/view.php') || href.startsWith(baseUrl)) return;
      externalUrl = href;
    });
  }
  return {
    title: normalizeText($('h1, h2').first().text()) || `URL ${cmid}`,
    description: extractText($, '.activity-description, .box.generalbox, #intro', 2_000) || undefined,
    externalUrl: externalUrl ? absoluteUrl(baseUrl, externalUrl) : undefined,
  };
}
