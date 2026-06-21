/// <reference types="vite/client" />

/**
 * Macht die vom Preload exponierte Brücke `window.api` im Renderer typsicher
 * verfügbar (siehe src/preload/index.ts und src/shared/ipc.ts).
 */
import type { UniCloudApi } from '../shared/ipc';

declare global {
  interface Window {
    api: UniCloudApi;
  }
}

export {};
