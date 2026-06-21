/**
 * Bibliotheks-Barrel der gemeinsamen Domänen-/IPC-Typen.
 *
 * Der frühere ts-service-HTTP-Stub wurde durch das Electron-App-Modell ersetzt;
 * der echte App-Einstiegspunkt ist jetzt src/main/index.ts. Diese Datei
 * re-exportiert nur die geteilten Typen für externe Konsumenten/Tests.
 */
export * from './shared/domain';
export * from './shared/ipc';
