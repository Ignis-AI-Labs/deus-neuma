#!/usr/bin/env node
/**
 * prove-update-privacy.mjs — what an update check actually tells the site (RULE 0: the real
 * electron-updater, in real Electron, set up by the app's own configureUpdater, asking a real
 * loopback feed that records every request).
 *
 * Passes when every feed request carries no per-install identifier: electron-updater's
 * x-user-staging-id must arrive empty (electron/auto-update.cjs UPDATE_REQUEST_HEADERS), and no
 * Authorization or cookie rides along. Prints each request's headers for the record.
 *
 *   node scripts/prove-update-privacy.mjs
 *
 * Opens no window; Electron's userData is a temp dir, so the desk's own profile is never touched.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const say = (line) => process.stderr.write(`[privacy] ${line}\n`);

const requests = [];
const server = createServer((req, res) => {
  requests.push({ method: req.method, url: req.url, headers: req.headers });
  if (req.url.startsWith('/latest-linux.yml')) {
    res.writeHead(200, { 'content-type': 'text/yaml' });
    // An older version than any build: the check completes as "up to date", downloading nothing.
    res.end('version: 0.0.1\nfiles:\n  - url: none.AppImage\n    sha512: none\n    size: 1\npath: none.AppImage\nsha512: none\nreleaseDate: 2026-01-01T00:00:00.000Z\n');
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const feed = `http://127.0.0.1:${server.address().port}/`;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'update-privacy-'));
await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'update-privacy-proof', version: '0.0.0', main: 'main.cjs' }));
await fs.writeFile(path.join(dir, 'main.cjs'), `
const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(dir, 'userData'))});
const { autoUpdater } = require(${JSON.stringify(path.join(REPO, 'node_modules/electron-updater'))});
const { configureUpdater } = require(${JSON.stringify(path.join(REPO, 'electron/auto-update.cjs'))});
app.whenReady().then(async () => {
  configureUpdater(autoUpdater, 'notify', ${JSON.stringify(feed)});
  autoUpdater.logger = null;
  try { await autoUpdater.checkForUpdates(); } catch (e) { console.error('check failed: ' + e.message); }
  app.exit(0);
});
`);

const electron = path.join(REPO, 'node_modules/.bin/electron');
const child = spawn(electron, [dir], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
const code = await new Promise((resolve) => {
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 60_000);
  child.once('exit', (c) => { clearTimeout(timer); resolve(c); });
});
server.close();
const idFile = await fs.readFile(path.join(dir, 'userData', '.updaterId'), 'utf8').catch(() => null);
await fs.rm(dir, { recursive: true, force: true });

for (const r of requests) say(`${r.method} ${r.url}\n${JSON.stringify(r.headers, null, 2)}`);
const feedRequests = requests.filter((r) => r.url.startsWith('/latest-linux.yml'));
const problems = [];
if (code !== 0) problems.push(`electron exited ${code}`);
if (feedRequests.length === 0) problems.push('the updater never asked the feed');
for (const r of feedRequests) {
  const staging = r.headers['x-user-staging-id'];
  if (staging) problems.push(`x-user-staging-id carried "${staging}"`);
  if (idFile && JSON.stringify(r.headers).includes(idFile.trim())) problems.push('the .updaterId value appears in the request');
  for (const h of ['authorization', 'cookie']) if (r.headers[h]) problems.push(`${h} header sent`);
}
if (problems.length) {
  say(`FAIL:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
say(`PASS: ${feedRequests.length} feed request(s), no per-install id (the local .updaterId ${idFile ? 'exists but never left the machine' : 'was never read'})`);
