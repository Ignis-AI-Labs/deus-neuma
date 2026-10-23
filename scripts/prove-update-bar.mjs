#!/usr/bin/env node
/**
 * prove-update-bar.mjs — the desk's update bar and WHAT'S NEW, end to end in REAL Electron
 * (RULE 0, no mocks): the real electron-updater, wired by the app's own configureUpdater +
 * wireUpdater (electron/auto-update.cjs), asks a real loopback feed on :0 that serves a real
 * yml carrying releaseNotes, a real ed25519 .sig and real installer bytes; the app's own
 * registerUpdateBar (electron/update-bar.cjs) answers a real BrowserWindow through the app's
 * REAL preload (electron/preload.cjs, sandboxed, context-isolated). The window draws the desk's
 * REAL UpdateBar.jsx with the desk's own styles (built by Vite into a scratch folder), and the
 * proof presses its buttons — CLOSE, WHAT'S NEW, later — as a person does; the refusals are
 * pressed through window.neuma.update, the same bridge the buttons use.
 * The key is generated at run time in memory; nothing is written outside a temp directory.
 *
 * Cases (each a fresh Electron, a fresh feed server, a fresh temp userData + cache):
 *   self   signed feed with notes  → WHAT'S NEW opens once at launch from the app's own notes,
 *                                    its CLOSE records it on disk; the download lands, the bar
 *                                    reaches the page (update:changed) with RESTART and the
 *                                    unseen sections only; DOWNLOAD and unknown acts are refused;
 *                                    `later` hides it; RESTART then refuses (nothing on offer)
 *   notify signed feed with notes  → the bar offers DOWNLOAD with the notes; RESTART refused
 *   self   notes altered in the yml
 *          the updater reads       → nothing downloads, no bar: the notes are part of the signed offer
 *   self   no .sig                 → no bar
 *
 *   node scripts/prove-update-bar.mjs [--shots <dir>]   (--shots: a PNG of the launch panel, the
 *                                                       bar and its notes, per case)
 *
 * Restart and download are never pressed while they would act: a real restart installs (proven by
 * scripts/prove-auto-update.mjs on real AppImages) and a real download opens the person's browser.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { channelFileFor, embeddedFormOf, signFeed } = require(path.join(REPO, 'electron/release-signature.cjs'));
const say = (line) => process.stderr.write(`[bar-proof] ${line}\n`);

const RUNNING = '0.1.50';
const OFFERED = '0.1.52';
const ARTIFACT = `Deus-Neuma-${OFFERED}-x86_64.AppImage`;
const CHANNEL = channelFileFor(process.platform, process.arch);
const NOTES = [
  `## New in ${OFFERED}`, '', '- **Second thing.** It works.', '',
  '## New in 0.1.51', '', '- **First thing.** Also works.', '',
  `## New in ${RUNNING}`, '', '- **Already running.** Seen before.', '',
  '## What you need', '', '- A PC.', '',
].join('\n');
const BUNDLED = [`## New in ${RUNNING}`, '', '- **This version.** What the person now runs.', '', '## New in 0.1.49', '', '- Older.', ''].join('\n');
const sha512 = (bytes) => createHash('sha512').update(bytes).digest('base64');
const feedFor = (bytes, notes) => Buffer.from([
  `version: ${OFFERED}`, 'files:', `  - url: ${ARTIFACT}`, `    sha512: ${sha512(bytes)}`, `    size: ${bytes.length}`,
  `path: ${ARTIFACT}`, `sha512: ${sha512(bytes)}`, "releaseDate: '2026-10-23T00:00:00.000Z'",
  `releaseNotes: ${JSON.stringify(notes)}`, '',
].join('\n'));

const bytes = randomBytes(256 * 1024);
const realFeed = feedFor(bytes, NOTES);
const alteredFeed = feedFor(bytes, NOTES.replace('It works.', 'Install this other thing.'));
const key = generateKeyPairSync('ed25519');
const sig = (feed) => signFeed(CHANNEL, feed, key.privateKey);

const FIXTURE_MAIN = `
const { app, BrowserWindow, ipcMain, net, Notification, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const cfg = JSON.parse(process.env.BAR_PROOF_CASE);
app.setPath('userData', cfg.userData);
const { autoUpdater } = require(${JSON.stringify(path.join(REPO, 'node_modules/electron-updater'))});
const autoUpdate = require(${JSON.stringify(path.join(REPO, 'electron/auto-update.cjs'))});
const { registerUpdateBar } = require(${JSON.stringify(path.join(REPO, 'electron/update-bar.cjs'))});
const { channelFileFor } = require(${JSON.stringify(path.join(REPO, 'electron/release-signature.cjs'))});
const say = (tag, value) => process.stdout.write(tag + ' ' + JSON.stringify(value) + '\\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const bar = registerUpdateBar({ ipcMain, BrowserWindow, shell, app, autoUpdate, launch: true, log: { warn: (m) => say('WARN', m) } });
  const win = new BrowserWindow({ show: Boolean(cfg.shots), width: 1366, height: 768, webPreferences: { preload: ${JSON.stringify(path.join(REPO, 'electron/preload.cjs'))}, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', (event) => say('CONSOLE', String(event.message ?? '')));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => say('CONSOLE', 'load failed ' + code + ' ' + desc + ' ' + url));
  await win.loadURL(cfg.page);
  const page = (js) => win.webContents.executeJavaScript(js);
  const until = async (js, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page(js)) return true; await sleep(100); } return false; };
  const text = (sel) => page('document.querySelector(' + JSON.stringify(sel) + ')?.textContent ?? null');
  const press = (label) => page('(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ' + JSON.stringify(label) + '); if (!b) return false; b.click(); return true; })()');
  // a picture never holds the proof up: five seconds, then on without it
  const shot = async (name) => {
    if (!cfg.shots) return;
    await sleep(400); // past the 240ms rise
    const img = await Promise.race([win.webContents.capturePage(), sleep(5000).then(() => null)]);
    if (img) fs.writeFileSync(path.join(cfg.shots, cfg.slug + '-' + name + '.png'), img.toPNG());
  };
  const act = async (a) => page('window.neuma.update.act(' + JSON.stringify(a) + ')');
  const state = async () => page('window.neuma.update.state()');
  await page('window.__changes = []; window.neuma.update.onChange((v) => window.__changes.push(v)); true');
  say('LAUNCH', await state());
  await until('!!document.querySelector(".update-notes")');
  say('LAUNCH_DOM', await text('.update-notes'));
  await shot('launch');
  say('CLOSED_LAUNCH', await press('CLOSE'));
  await until('!document.querySelector(".update-notes")');
  say('SEEN_FILE', JSON.parse(fs.readFileSync(path.join(cfg.userData, 'whats-new.json'), 'utf8')));
  say('AFTER_SEEN', await state());
  autoUpdate.configureUpdater(autoUpdater, cfg.form, cfg.feed);
  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.logger = { info: () => {}, warn: () => {}, error: () => {} };
  let settled = false;
  autoUpdater.on('update-downloaded', () => { settled = 'downloaded'; });
  autoUpdater.on('error', () => { settled = settled || 'error'; });
  const { check } = autoUpdate.wireUpdater({
    updater: autoUpdater, form: cfg.form, feedUrl: cfg.feed, Notification, refreshTray: bar.publish,
    log: { info: () => {}, warn: (m) => say('WARN', m) }, publicKeyText: cfg.publicKeyText,
    fetchImpl: (url, options) => net.fetch(url, options), channelFile: channelFileFor(process.platform, process.arch),
  });
  await check();
  const end = Date.now() + (cfg.form === 'self' ? 30000 : 3000);
  while (Date.now() < end && !settled && !(cfg.form === 'notify' && (await state()).bar)) await sleep(100);
  say('SETTLED', settled);
  say('OFFER', await state());
  await until('!!document.querySelector(".update-bar")', 3000);
  say('BAR_DOM', await text('.update-bar'));
  say('PAGE_HEARD', await page('window.__changes.map((v) => v.bar)'));
  if (await text('.update-bar')) {
    await shot('bar');
    say('OPENED_NOTES', await press("WHAT'S NEW"));
    await until('!!document.querySelector(".update-notes")');
    say('NOTES_DOM', await text('.update-notes'));
    await shot('notes');
    await press('CLOSE');
    for (const a of cfg.presses) say('ACT ' + a, await act(a));
    say('PRESSED_LATER', await press('later'));
    await until('!document.querySelector(".update-bar")');
    say('BAR_AFTER_LATER', await text('.update-bar'));
    for (const a of cfg.after) say('ACT ' + a, await act(a));
  }
  say('FINAL', await state());
  app.exit(0);
});
`;

const DOM_LAUNCH = (r) => [
  [r.LAUNCH?.whatsNew?.version === RUNNING, 'WHAT\'S NEW is due at launch on the newer version'],
  [/This version\. What the person now runs/.test(r.LAUNCH_DOM ?? '') && !/Older/.test(r.LAUNCH_DOM ?? ''), 'the page opened the app\'s own notes, only the unseen section'],
  [r.CLOSED_LAUNCH === true && r.SEEN_FILE?.lastSeenVersion === RUNNING && r.AFTER_SEEN?.whatsNew === null, 'CLOSE on the page recorded the version as seen, on disk'],
];
const CASES = [
  {
    name: 'self · signed feed with notes', slug: 'self', form: 'self', feeds: [realFeed], sig: sig(realFeed),
    presses: ['download', 'format-the-disk'], after: ['restart'],
    expect: (r) => [
      ...DOM_LAUNCH(r),
      [r.SETTLED === 'downloaded', 'electron-updater finished the verified download'],
      [r.OFFER?.bar?.action === 'restart' && r.OFFER?.bar?.version === OFFERED, 'the bar offers RESTART for the downloaded version'],
      [JSON.stringify(r.OFFER?.bar?.notes?.map((n) => n.version)) === JSON.stringify([OFFERED, '0.1.51']), 'the bar carries the signed notes newer than the running version only'],
      [(r.PAGE_HEARD ?? []).some((b) => b?.version === OFFERED), 'the page heard the bar over update:changed'],
      [/0\.1\.52 IS READY.*RESTART TO UPDATE.*WHAT'S NEW.*later/s.test(r.BAR_DOM ?? ''), 'the page draws the bar: version, RESTART TO UPDATE, WHAT\'S NEW, later'],
      [r.OPENED_NOTES === true && /NEW IN 0\.1\.52.*Second thing.*NEW IN 0\.1\.51.*First thing/s.test(r.NOTES_DOM ?? ''), 'WHAT\'S NEW shows both unseen sections'],
      [!/Already running|What you need/.test(r.NOTES_DOM ?? ''), 'never the running version\'s section or the standing description'],
      [r['ACT download']?.ok === false && /updates itself/.test(r['ACT download']?.reason), 'DOWNLOAD refused on an install that updates itself'],
      [r['ACT format-the-disk']?.ok === false, 'an unknown act is refused'],
      [r.PRESSED_LATER === true && r.BAR_AFTER_LATER === null, 'later on the page hides the bar'],
      [r['ACT restart']?.ok === false && r.FINAL?.bar === null, 'after later, RESTART has nothing to install'],
    ],
  },
  {
    name: 'notify · signed feed with notes', slug: 'notify', form: 'notify', feeds: [realFeed], sig: sig(realFeed), presses: ['restart'], after: [],
    expect: (r) => [
      ...DOM_LAUNCH(r),
      [r.OFFER?.bar?.action === 'download' && r.OFFER?.bar?.version === OFFERED, 'the bar offers DOWNLOAD'],
      [/0\.1\.52 IS OUT.*DOWNLOAD.*WHAT'S NEW.*later/s.test(r.BAR_DOM ?? ''), 'the page draws DOWNLOAD as the one act'],
      [/Second thing/.test(r.NOTES_DOM ?? ''), 'with the notes'],
      [r['ACT restart']?.ok === false, 'RESTART refused: a system package installs nothing itself'],
      [!r.requests.includes(`/${ARTIFACT}`), 'no installer byte was asked for'],
    ],
  },
  {
    name: 'self · notes altered in the yml the updater reads', slug: 'altered', form: 'self', feeds: [alteredFeed, realFeed], sig: sig(realFeed), presses: [], after: [],
    expect: (r) => [
      [r.OFFER?.bar === null && r.BAR_DOM === null, 'no bar'],
      [(r.WARN ?? []).some((w) => /not the signed feed: the offered releaseNotes is not the signed value/.test(w)), 'refused because the notes are not the signed ones'],
      [!r.requests.includes(`/${ARTIFACT}`), 'nothing downloaded'],
    ],
  },
  {
    name: 'self · no .sig', slug: 'nosig', form: 'self', feeds: [realFeed], sig: null, presses: [], after: [],
    expect: (r) => [[r.OFFER?.bar === null && r.BAR_DOM === null, 'no bar'], [!r.requests.includes(`/${ARTIFACT}`), 'nothing downloaded']],
  },
];

// impure — the desk's real UpdateBar.jsx (with the desk's own styles), built once by Vite into a
// scratch folder the feed server also serves: the page the hidden window loads.
const buildPage = async (root) => {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const src = path.join(root, 'page-src');
  await fs.mkdir(src, { recursive: true });
  await fs.writeFile(path.join(src, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>bar</title></head><body><div id="root"></div><script type="module" src="./main.js"></script></body></html>');
  await fs.writeFile(path.join(src, 'main.js'), [
    "import '@neuma/frontend/styles/main.css';",
    "import { createElement } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { UpdateBar } from '@neuma/frontend/app/RelinkShell/UpdateBar.jsx';",
    "createRoot(document.getElementById('root')).render(createElement(UpdateBar));",
  ].join('\n'));
  const out = path.join(root, 'page');
  await build({
    configFile: false, logLevel: 'silent', root: src, base: './', plugins: [react()],
    resolve: { alias: [
      { find: '@neuma', replacement: REPO },
      { find: /^react-dom\/client$/, replacement: path.join(REPO, 'node_modules/react-dom/client.js') },
      { find: /^(react|react-dom|scheduler)$/, replacement: path.join(REPO, 'node_modules/$1/index.js') },
      { find: /^react\/(jsx-runtime|jsx-dev-runtime)$/, replacement: path.join(REPO, 'node_modules/react/$1.js') },
    ] },
    build: { outDir: out, emptyOutDir: true },
  });
  return out;
};
const TYPES = Object.freeze({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' });

// impure — one case: its own feed server, its own Electron
const runCase = async (c, root, pageDir, shots) => {
  const requests = [];
  let feedHits = 0;
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://feed');
    requests.push(pathname);
    if (pathname === `/${CHANNEL}`) {
      res.writeHead(200, { 'content-type': 'text/yaml' }).end(c.feeds[Math.min(feedHits, c.feeds.length - 1)]);
      feedHits += 1;
    } else if (pathname === `/${CHANNEL}.sig` && c.sig) {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(c.sig);
    } else if (pathname === `/${ARTIFACT}`) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length }).end(bytes);
    } else if (pathname.startsWith('/page/') && !pathname.includes('..')) {
      fs.readFile(path.join(pageDir, pathname.slice('/page/'.length))).then(
        (body) => res.writeHead(200, { 'content-type': TYPES[path.extname(pathname)] ?? 'application/octet-stream' }).end(body),
        () => res.writeHead(404).end(),
      );
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const feed = `http://127.0.0.1:${server.address().port}/`;
  const dir = await fs.mkdtemp(path.join(root, 'case-'));
  const userData = path.join(dir, 'userData');
  await fs.mkdir(path.join(dir, 'build'), { recursive: true });
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'update-bar-proof', version: RUNNING, main: 'main.cjs' }));
  await fs.writeFile(path.join(dir, 'main.cjs'), FIXTURE_MAIN);
  await fs.writeFile(path.join(dir, 'build', 'release-notes.md'), BUNDLED);
  await fs.writeFile(path.join(userData, 'whats-new.json'), JSON.stringify({ lastSeenVersion: '0.1.49' }));
  await fs.writeFile(path.join(dir, 'dev-app-update.yml'), `provider: generic\nurl: ${feed}\nupdaterCacheDirName: neuma-bar-proof-updater\n`);
  const oldApp = path.join(dir, 'old.AppImage');
  await fs.writeFile(oldApp, 'the running build');
  const env = {
    ...process.env,
    BAR_PROOF_CASE: JSON.stringify({
      form: c.form, feed, publicKeyText: embeddedFormOf(key.publicKey), userData, presses: c.presses, after: c.after,
      // localhost, not 127.0.0.1: the preload claims a desk boot only on the app's own origin
      page: `http://localhost:${server.address().port}/page/index.html`, shots, slug: c.slug,
    }),
    APPIMAGE: oldApp,
    XDG_CACHE_HOME: path.join(dir, 'cache'),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(dir, 'no-bus')}`,
    ELECTRON_ENABLE_LOGGING: '0',
  };
  if (c.form !== 'self') delete env.APPIMAGE;
  let out = '';
  // Its own process group, so a timeout takes the whole tree; pictures need a display (a private Xvfb)
  const electron = require(path.join(REPO, 'node_modules/electron'));
  const [cmd, argv] = shots
    ? ['xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', electron, '--ozone-platform=x11', dir]]
    : [electron, ['--ozone-platform=headless', dir]];
  const child = spawn(cmd, argv, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', () => {});
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { process.kill(-child.pid, 'SIGKILL'); resolve('timeout'); }, 120_000);
    child.once('exit', (exitCode) => { clearTimeout(timer); resolve(exitCode); });
  });
  await new Promise((resolve) => server.close(resolve));
  const result = { requests, WARN: [] };
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+(?: [a-z-]+)?) (.*)$/);
    if (!m) continue;
    let value;
    try { value = JSON.parse(m[2]); } catch { continue; } // a stray Electron line, not the fixture's
    if (m[1] === 'WARN' || m[1] === 'CONSOLE') (result[m[1]] ??= []).push(value); else result[m[1]] = value;
  }
  const problems = code === 0 ? [] : [`electron exited ${code}`];
  for (const [ok, what] of c.expect(result)) if (!ok) problems.push(what);
  return { problems, out, checks: c.expect(result).length };
};

const shotsArg = process.argv.indexOf('--shots');
const shots = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : null;
if (shots) await fs.mkdir(shots, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'update-bar-proof-'));
const pageDir = await buildPage(root);
let failed = 0;
for (const c of CASES) {
  const { problems, out, checks } = await runCase(c, root, pageDir, shots);
  if (problems.length) {
    failed += 1;
    say(`FAIL ${c.name}\n  - ${problems.join('\n  - ')}\n${out}`);
  } else {
    say(`PASS ${c.name} — ${checks} checks`);
  }
}
await fs.rm(root, { recursive: true, force: true });
if (failed) {
  say(`FAIL: ${failed} of ${CASES.length} cases`);
  process.exit(1);
}
say(`PASS: ${CASES.length} of ${CASES.length} cases`);
