import type { CheerioAPI } from 'cheerio';

export const MAX_TEXT_LENGTH = 5_000;

export function normalizeText(text: string | null | undefined): string {
  return text?.replace(/\s+/g, ' ').trim() ?? '';
}

export function truncate(text: string, max = MAX_TEXT_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function absoluteUrl(baseUrl: string, href: string): string {
  if (!href) return href;
  try {
    return new URL(href, `${baseUrl}/`).toString();
  } catch {
    return href;
  }
}

export function extractText(
  $: CheerioAPI,
  selector: string,
  max = MAX_TEXT_LENGTH,
): string {
  return truncate(normalizeText($(selector).first().text()), max);
}
