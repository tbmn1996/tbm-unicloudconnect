import * as cheerio from 'cheerio';
import { normalizeText, truncate } from './common';

export interface ParsedPage {
  title: string;
  text: string;
}

export function parsePageHtml(html: string, cmid: number): ParsedPage {
  const $ = cheerio.load(html);
  const content = $('#region-main .box.generalbox, [role="main"] .box.generalbox, main').first();
  return {
    title: normalizeText($('h1, h2').first().text()) || `Seite ${cmid}`,
    text: truncate(normalizeText(content.text())),
  };
}
