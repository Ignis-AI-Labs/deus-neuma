import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dotenv from 'dotenv';
import { textScaleCss } from './scripts/text-scale-css.mjs';

dotenv.config();

// Dev ports — env-driven so multiple checkouts can run side by side without
// colliding. Canonical defaults stay 7777 (frontend) / 3333 (backend); a local
// (gitignored) .env overrides them when another stack already holds the defaults.
const BACKEND_PORT = process.env.PORT || 3333;
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 7777;
const backendHttp = `http://localhost:${BACKEND_PORT}`;
const backendWs = `ws://localhost:${BACKEND_PORT}`;

export default defineConfig({
  root: './frontend',
  publicDir: './assets',
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  css: { postcss: { plugins: [textScaleCss()] } },
  // Pre-bundle the heavy 3D deps so the vessel window doesn't stall on first open.
  optimizeDeps: {
    include: ['three', '@pixiv/three-vrm'],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // The AudioWorklet processor must ship as a REAL same-origin FILE.
    // Vite inlines assets under 4 KB as `data:` URLs, and the desk's CSP
    // (`script-src 'self'`, backend/services/security-headers.js) refuses a
    // data: script exactly as it refused the blob: URL this replaced — an
    // AudioWorklet module IS a script. Inlined, the mic opens for an instant
    // and the addModule throws AbortError, which use-live-voice catches by
    // tearing the mic down: a voice sitting that listens to nothing.
    // Returning false forces this one asset out to its own file.
    // Fonts likewise: the CSP's `font-src 'self'` refuses a data: font, and the
    // CJK subsets (Noto Sans SC) under 4 KB were inlined and refused — Chinese
    // and Japanese text fell back to the system face (found 2026-10-03, once
    // the built-page CSP proof reached the gateway instead of the licence gate).
    assetsInlineLimit: (filePath) => (
      filePath.includes('voice-mic-worklet-processor') || /\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined
    ),
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'frontend/index.html'),
      }
    }
  },
  server: {
    port: FRONTEND_PORT,
    // Neuma Remote in development: Tailscale Serve fronts THIS port, so the
    // phone's Host is the machine's MagicDNS name (Vite refuses unknown hosts
    // by default) and the enrolment road must reach the backend like the API.
    // The backend's own gate decides who is trusted; this only lets the
    // request through to it (docs/security/remote-surface.md).
    allowedHosts: ['.ts.net'],
    // The phone gets NO dev-client socket. Vite's client reloads the page
    // after any unclean socket loss (Vite 5.4: client.mjs […] → location.reload()), and a screen lock
    // is exactly that loss — the moment Neuma Remote has to survive. Pinned
    // to localhost the desk keeps HMR; a tailnet page fails to open the
    // socket, says so once in its console, and is otherwise left alone.
    hmr: { host: 'localhost' },
    // changeOrigin stays FALSE (Vite's string form turns it on): the backend's
    // gate reads the Host the phone actually sent, and a rewritten Host on a
    // tailnet hop reads as a rebinding attempt and is refused.
    proxy: {
      '/api': { target: backendHttp, changeOrigin: false },
      '^/r/': { target: backendHttp, changeOrigin: false },
      '/model': { target: backendHttp, changeOrigin: false },
      '/animation': { target: backendHttp, changeOrigin: false },
      '/ws': {
        target: backendWs,
        ws: true
      },
      '/terminal-ws': {
        target: backendWs,
        ws: true
      },
      '/dictate-ws': {
        target: backendWs,
        ws: true
      }
    }
  },
  resolve: {
    alias: {
      '/@kotodama': resolve(__dirname, './core/kotodama'),
      '@': resolve(__dirname, './frontend'),
      '@components': resolve(__dirname, './frontend/components'),
      '@styles': resolve(__dirname, './frontend/styles'),
      '@lib': resolve(__dirname, './frontend/lib'),
      '@services': resolve(__dirname, './frontend/services')
    }
  }
});
