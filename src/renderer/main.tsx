/**
 * Renderer-Einstiegspunkt: mountet die React-App in #root.
 * Die eigentlichen Screens (Setup-Wizard + Dashboard) werden in Schritt F1
 * aus dem doc-composer-Design nach React/TSX portiert.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createDevApi } from './dev-api';

if (import.meta.env.DEV && typeof window.api === 'undefined') {
  window.api = createDevApi();
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer-Root-Element #root nicht gefunden.');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
