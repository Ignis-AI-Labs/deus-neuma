#!/usr/bin/env node
/**
 * Local web launch (WEB-001 / #126) — the no-Electron way to run NEUMA.
 *
 * Starts the local NEUMA backend (which already serves the built SPA + API + WS)
 * and opens it in the user's default browser. Same local engine — the LLM and the
 * sovereign workspace never leave this machine — with a browser as the window
 * instead of the Electron shell. The browser's own wallet (Rabby/MetaMask via
 * EIP-6963) works natively here, alongside the embedded wallet.
 *
 * Usage:
 *   npm run build            # produce dist/ (the SPA the backend serves)
 *   node scripts/launch-web.mjs
 * or simply:
 *   npm run web              # build + launch in one step
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '3333';
const ORIGIN = `http://localhost:${PORT}`;

const openInBrowser = (url) => {
  const platform = process.platform;
  const [cmd, args] =
    platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    console.log(`Open this in your browser: ${url}`);
  }
};

const waitForHealth = async (timeoutMs = 30000) => {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${ORIGIN}/api/v1/health`);
      if (res.ok) return true;
    } catch { /* backend not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error('backend did not become ready in time');
    await new Promise((r) => setTimeout(r, 400));
  }
};

// Serve the built SPA: production mode makes the backend mount dist/ + the SPA
// history fallback (dev mode leaves the frontend to Vite instead).
const backend = spawn(process.execPath, [path.join(ROOT, 'backend', 'server.js')], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
  stdio: 'inherit',
});
backend.on('exit', (code) => process.exit(code ?? 0));

const shutdown = () => { try { backend.kill(); } catch { /* already gone */ } };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await waitForHealth();
  console.log(`\n  NEUMA is running at ${ORIGIN} — opening your browser…\n  (Ctrl+C here stops the local server.)\n`);
  openInBrowser(ORIGIN);
} catch (err) {
  console.error(`Could not start NEUMA: ${err.message}`);
  shutdown();
  process.exit(1);
}
