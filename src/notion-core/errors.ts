/**
 * Fehlerklassen für die Notion API-Kommunikation.
 */

/** Wird geworfen, wenn die Authentifizierung fehlschlägt (z. B. HTTP 401). */
export class NotionAuthError extends Error {
  constructor(message = 'Notion-Token ist ungültig oder abgelaufen.') {
    super(message);
    this.name = 'NotionAuthError';
  }
}

/** Wird geworfen, wenn das Rate-Limit nach mehreren Retries überschritten wurde. */
export class NotionRateLimitExceededError extends Error {
  constructor(message = 'Notion Rate-Limit nach maximalen Versuchen überschritten.') {
    super(message);
    this.name = 'NotionRateLimitExceededError';
  }
}

/** Generischer Fehler für alle sonstigen fehlerhaften Notion-API-Antworten. */
export class NotionApiError extends Error {
  public readonly status?: number;
  public readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'NotionApiError';
    this.status = status;
    this.code = code;
  }
}
