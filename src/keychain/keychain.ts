/**
 * macOS-Keychain-Wrapper (Security-kritisch).
 *
 * Speichert/liest LearnWeb-Zugangsdaten AUSSCHLIESSLICH über das macOS
 * `security`-CLI. Aufrufe laufen über `execFile` mit einem Argument-ARRAY
 * (niemals `exec`/Shell-String) — damit ist Command-Injection ausgeschlossen.
 * Zusätzlich werden alle Bezeichner/Passwörter vor dem Aufruf validiert.
 *
 * ACL-Hinweis: Items werden mit `-T /usr/bin/security` angelegt, damit spätere
 * Hintergrund-Lesezugriffe durch genau dieses Binary NICHT zu interaktiven
 * macOS-Sicherheitsabfragen führen (analog bootstrap-keychain.sh im Connector).
 *
 * Es werden niemals Passwörter geloggt oder in Fehlermeldungen aufgenommen.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Pfad des macOS-`security`-Binaries — fest, nie aus Eingaben gebildet. */
const SECURITY_BIN = '/usr/bin/security';

/** Standard-Keychain-Service dieser App. */
export const KEYCHAIN_SERVICE = 'tbm-unicloudconnect';

/**
 * Prüft auf C0-Steuerzeichen (Code < 0x20) oder DEL (0x7f). Bewusst über
 * charCodeAt statt Regex-Literal, um keine Steuerzeichen im Quelltext zu haben.
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export class KeychainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeychainError';
  }
}

/**
 * Validiert einen Bezeichner (Service-/Account-Name). Verhindert u. a., dass ein
 * mit "-" beginnender Wert vom `security`-CLI als Option fehlinterpretiert wird,
 * sowie Steuerzeichen/NUL.
 */
export function assertSafeIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KeychainError(`${label} darf nicht leer sein.`);
  }
  if (value.length > 256) {
    throw new KeychainError(`${label} ist zu lang (max. 256 Zeichen).`);
  }
  if (hasControlChar(value)) {
    throw new KeychainError(`${label} enthält unzulässige Steuerzeichen.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9@._+-]*$/.test(value)) {
    throw new KeychainError(
      `${label} darf nur Buchstaben, Ziffern sowie @, Punkt, Unterstrich, Plus und Minus enthalten.`,
    );
  }
}

/** Validiert ein Passwort als reine Daten (nur NUL/Längen-Grenzen). */
export function assertSafePassword(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new KeychainError('Passwort darf nicht leer sein.');
  }
  if (password.length > 1024) {
    throw new KeychainError('Passwort ist zu lang (max. 1024 Zeichen).');
  }
  // NUL-Byte (Code 0) ausschließen, ohne ein Steuerzeichen-Literal zu schreiben.
  if (password.includes(String.fromCharCode(0))) {
    throw new KeychainError('Passwort darf kein NUL-Zeichen enthalten.');
  }
}

// ---------------------------------------------------------------------------
// Reine Argument-Builder (ohne Seiteneffekte) — separat testbar.
// ---------------------------------------------------------------------------

export function buildAddArgs(service: string, account: string, password: string): string[] {
  // -U: vorhandenes Item aktualisieren statt zu scheitern.
  // -T /usr/bin/security: nur das security-Binary in die ACL aufnehmen (Hintergrund-Lesen ohne Prompt).
  return ['add-generic-password', '-a', account, '-s', service, '-w', password, '-U', '-T', SECURITY_BIN];
}

export function buildFindArgs(service: string, account: string, withSecret: boolean): string[] {
  const args = ['find-generic-password', '-a', account, '-s', service];
  if (withSecret) args.push('-w'); // -w gibt NUR das Passwort auf stdout aus
  return args;
}

export function buildDeleteArgs(service: string, account: string): string[] {
  return ['delete-generic-password', '-a', account, '-s', service];
}

// ---------------------------------------------------------------------------
// Effektbehaftete Operationen
// ---------------------------------------------------------------------------

/** Legt ein Credential an oder aktualisiert es (Passwort nur in der Keychain). */
export async function setCredential(
  account: string,
  password: string,
  service: string = KEYCHAIN_SERVICE,
): Promise<void> {
  assertSafeIdentifier(service, 'Service');
  assertSafeIdentifier(account, 'Account');
  assertSafePassword(password);
  try {
    await execFileAsync(SECURITY_BIN, buildAddArgs(service, account, password));
  } catch {
    // Bewusst KEINE Original-Fehlermeldung durchreichen (könnte Argumente leaken).
    throw new KeychainError('Keychain-Eintrag konnte nicht gespeichert werden.');
  }
}

/** Liest das Passwort; gibt null zurück, wenn kein Eintrag existiert. */
export async function getPassword(
  account: string,
  service: string = KEYCHAIN_SERVICE,
): Promise<string | null> {
  assertSafeIdentifier(service, 'Service');
  assertSafeIdentifier(account, 'Account');
  try {
    const { stdout } = await execFileAsync(SECURITY_BIN, buildFindArgs(service, account, true));
    // `security -w` hängt genau einen abschließenden Zeilenumbruch an.
    return stdout.replace(/\n$/, '');
  } catch {
    return null;
  }
}

/** Prüft (ohne das Passwort zu lesen), ob ein Eintrag existiert. */
export async function hasCredential(
  account: string,
  service: string = KEYCHAIN_SERVICE,
): Promise<boolean> {
  assertSafeIdentifier(service, 'Service');
  assertSafeIdentifier(account, 'Account');
  try {
    await execFileAsync(SECURITY_BIN, buildFindArgs(service, account, false));
    return true;
  } catch {
    return false;
  }
}

/** Löscht einen Eintrag; ein fehlender Eintrag ist kein Fehler. */
export async function deleteCredential(
  account: string,
  service: string = KEYCHAIN_SERVICE,
): Promise<void> {
  assertSafeIdentifier(service, 'Service');
  assertSafeIdentifier(account, 'Account');
  try {
    await execFileAsync(SECURITY_BIN, buildDeleteArgs(service, account));
  } catch {
    // Nicht vorhanden -> ignorieren.
  }
}
