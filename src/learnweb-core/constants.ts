/**
 * Feste LearnWeb-Konfiguration (MVP 1: nur Münster, keine frei wählbare Instanz).
 *
 * Basis-URL = Moodle-wwwroot der WWU Münster. Login-/View-/pluginfile-Pfade
 * werden relativ dazu aufgelöst (siehe session.ts). Bestätigt aus dem
 * produktiven LearnWeb-Connector.
 */
export const LEARNWEB_BASE_URL = 'https://www.uni-muenster.de/LearnWeb/learnweb2';

/** Keychain-Provider-/Account-Kennung für LearnWeb-Credentials. */
export const LEARNWEB_PROVIDER = 'learnweb';
