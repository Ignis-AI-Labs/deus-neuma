// vite-specimen.js — boots a private Vite dev server for the dev-only
// look-dev specimen pages (frontend/*.html outside the build input) on a
// free port, and tears it down by the recorded process only.
// PROCESS-SAFETY LAW: an occupied port means pick another, never touch it.
import { test } from '@playwright/test';
import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});

/**
 * Register the suite lifecycle; returns a getter for the server's base URL.
 * @param {string} probePage a page that must answer before tests run
 */
export const setupSpecimenServer = (probePage) => {
  let vite;
  let base;
  test.beforeAll(async () => {
    let port = 7900 + (process.pid % 97);
    while (!(await canBind(port))) port += 1;
    base = `http://localhost:${port}`;
    vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: REPO, stdio: 'ignore' });
    for (let i = 0; i < 120; i += 1) {
      try { if ((await fetch(`${base}/${probePage}`)).ok) return; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('vite never answered');
  });
  test.afterAll(() => { vite?.kill('SIGTERM'); });
  return () => base;
};
