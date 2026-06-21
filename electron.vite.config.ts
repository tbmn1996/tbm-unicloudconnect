/**
 * electron-vite-Konfiguration.
 *
 * Drei Build-Targets in einem: main (Node), preload (Node, isoliert) und
 * renderer (DOM/React via @vitejs/plugin-react). Da package.json `type: module`
 * ist, werden main/preload als ESM gebaut — im Code `import.meta.dirname`
 * statt `__dirname` verwenden. `externalizeDepsPlugin` hält native/Node-Deps
 * (better-sqlite3, axios, cheerio …) aus dem Bundle heraus.
 */
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // axios-cookiejar-support zieht eine CJS→ESM-Kante über http-cookie-agent
    // und agent-base ein, die Electron extern nicht zuverlässig auflösen kann.
    // Der reine JS-Adapter wird deshalb gebündelt; native Dependencies bleiben extern.
    plugins: [externalizeDepsPlugin({ exclude: ['axios-cookiejar-support', 'tough-cookie'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
        output: { format: 'es' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        output: { format: 'es' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(import.meta.dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
      },
    },
    plugins: [react()],
  },
});
