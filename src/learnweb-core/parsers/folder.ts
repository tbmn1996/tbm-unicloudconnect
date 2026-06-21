import * as cheerio from 'cheerio';
import { absoluteUrl, extractText, normalizeText, truncate } from './common';

export interface ParsedFolderEntry {
  name: string;
  downloadUrl: string;
  size?: string;
}

export interface ParsedFolder {
  title: string;
  description?: string;
  entries: ParsedFolderEntry[];
}

export function parseFolderHtml(html: string, cmid: number, baseUrl: string): ParsedFolder {
  const $ = cheerio.load(html);
  const entries: ParsedFolderEntry[] = [];
  const seen = new Set<string>();

  $('a[href*="pluginfile.php"]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || seen.has(href)) return;
    seen.add(href);
    const rawName = normalizeText($(element).find('.fp-filename, .filename').first().text())
      || normalizeText($(element).text());
    const fallback = decodeURIComponent(href.split('/').pop()?.split('?')[0] ?? 'Datei');
    const size = normalizeText(
      $(element).closest('li, tr').find('.fp-size, .filesize').first().text(),
    );
    entries.push({
      name: truncate(rawName || fallback, 300),
      downloadUrl: absoluteUrl(baseUrl, href),
      size: size || undefined,
    });
  });

  return {
    title: normalizeText($('h1, h2').first().text()) || `Ordner ${cmid}`,
    description: extractText($, '.activity-description, #intro', 2_000) || undefined,
    entries,
  };
}
