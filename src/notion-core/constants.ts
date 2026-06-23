/**
 * Konstanten für den Notion API Client.
 */
export const NOTION_API_BASE = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2022-06-28';

/**
 * Minimaler Abstand zwischen API-Requests in Millisekunden (ca. 3 Requests/Sekunde).
 * Entspricht der Drosselung des Python-Referenzcodes.
 */
export const NOTION_MIN_REQUEST_INTERVAL_MS = 350;

/** Maximale Retry-Versuche bei HTTP 429 (Rate-Limit). */
export const NOTION_MAX_RETRY_ATTEMPTS = 3;

/** Maximale Dateigröße für Uploads in Bytes (20 MB, passend zum Python-Vorgänger). */
export const NOTION_MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;

/** Maximale Anzahl an Blocks pro Request beim Anhängen/Erstellen. */
export const NOTION_MAX_BLOCKS_PER_REQUEST = 100;

/** Maximale Anzahl an Zeichen in einem einzelnen Rich-Text-Block in Notion. */
export const NOTION_MAX_RICH_TEXT_CHARS = 2000;
