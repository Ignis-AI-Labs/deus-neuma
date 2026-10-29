#!/usr/bin/env node
/**
 * prove-update-signature.mjs — the app downloads an update ONLY when the offline release key signed
 * its feed (security seat G2). RULE 0: real Electron, the real electron-updater, wired by the app's
 * own configureUpdater + wireUpdater (electron/auto-update.cjs), asking a real loopback feed on :0
 * that serves a real yml, a real ed25519 .sig and real installer bytes. Keys are generated at run
 * time in memory; none is written anywhere.
 *
 * Cases (each a fresh Electron, a fresh feed server, a fresh temp userData + cache):
 *   self   valid signature                    → downloadUpdate runs: the bytes are fetched and
 *                                               electron-updater's sha512 check passes (update-downloaded)
 *   self   yml + installer swapped (sha512)   → no byte requested; reason logged; quiet notice
 *   self   split view (updater sees the swap,
 *          the signature check sees the real) → no byte requested; […]
 *   self   signed by another key              → no byte requested
 *   self   no .sig on the feed                → no byte requested
 *   self   empty embedded key                 → no byte requested, the .sig never even asked for
 *   self   cross-channel: a validly signed
 *          Windows latest.yml + its .sig served
 *          as this platform's feed            → no byte requested: the signature is bound to its name
 *   self   an .exe feed signed for THIS
 *          channel (a signing mistake)        → no byte requested: Linux self-updates only from an
 *                                               AppImage; […] notice
 *   self   stale cached .sig, fresh on a
 *          cache-busted re-read              → downloads: the second read verified
 *   notify valid signature                    → "is available" notice, no byte requested
 *   notify no .sig                            → […] notice only
 *
 *   node scripts/prove-update-signature.mjs
 *
 * Opens no window. Notifications go to a D-Bus address that does not exist, so the operator's
 * desktop never sees a proof notice; the app's notice path still runs and logs its title.
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
const say = (line) => process.stderr.write(`[sig-proof] ${line}\n`);

const VERSION = '9.9.9';
const ARTIFACT = `Deus-Neuma-${VERSION}-x86_64.AppImage`;
const EXE = `Deus-Neuma-${VERSION}-x64.exe`;
const CHANNEL = channelFileFor(process.platform, process.arch);
const OTHER_CHANNEL = CHANNEL === 'latest.yml' ? 'latest-linux.yml' : 'latest.yml';
const sha512 = (bytes) => createHash('sha512').update(bytes).digest('base64');
const feedFor = (bytes, artifact = ARTIFACT) => Buffer.from([
  `version: ${VERSION}`,
  'files:',
  `  - url: ${artifact}`,
  `    sha512: ${sha512(bytes)}`,
  `    size: ${bytes.length}`,
  `path: ${artifact}`,
  `sha512: ${sha512(bytes)}`,
  "releaseDate: '2026-10-20T00:00:00.000Z'",
  '',
].join('\n'));

const real = randomBytes(512 * 1024);
const evil = randomBytes(512 * 1024);
const realFeed = feedFor(real);
const evilFeed = feedFor(evil);
const exeFeed = feedFor(real, EXE);
const staleFeed = feedFor(evil); // the release before: its .sig is what a cache still holds
const keyA = generateKeyPairSync('ed25519');
const keyB = generateKeyPairSync('ed25519');
const KEY_A = embeddedFormOf(keyA.publicKey);
const sigA = (feed, name = CHANNEL) => signFeed(name, feed, keyA.privateKey);
const NO_MATCH = new RegExp(`signature does not match ${CHANNEL.replace(/\./g, '\\.')}`);
const NO_SIG = new RegExp(`no signature for ${CHANNEL.replace(/\./g, '\\.')}`);
const UNVERIFIED = /notice — Deus Neuma .* could not be verified/;
const UNFIT = /notice — Deus Neuma .* not as an update for this install/;

const CASES = [
  { name: 'self · valid signature', form: 'self', key: KEY_A, feeds: [realFeed], sig: sigA(realFeed), bytes: real, expectDownload: true },
  { name: 'self · yml + installer swapped', form: 'self', key: KEY_A, feeds: [evilFeed], sig: sigA(realFeed), bytes: evil, reason: NO_MATCH },
  { name: 'self · split view', form: 'self', key: KEY_A, feeds: [evilFeed, realFeed], sig: sigA(realFeed), bytes: evil, reason: /is not the signed feed: the offered files or their sha512/ },
  { name: 'self · another key', form: 'self', key: KEY_A, feeds: [realFeed], sig: signFeed(CHANNEL, realFeed, keyB.privateKey), bytes: real, reason: NO_MATCH },
  { name: 'self · no .sig', form: 'self', key: KEY_A, feeds: [realFeed], sig: null, bytes: real, reason: NO_SIG },
  { name: 'self · empty embedded key', form: 'self', key: '', feeds: [realFeed], sig: sigA(realFeed), bytes: real, reason: /no release public key is embedded/, sigNeverAsked: true },
  { name: `self · cross-channel: a signed ${OTHER_CHANNEL} served as ${CHANNEL}`, form: 'self', key: KEY_A, feeds: [exeFeed], sig: sigA(exeFeed, OTHER_CHANNEL), bytes: real, artifact: EXE, reason: NO_MATCH },
  { name: `self · an .exe feed signed for ${CHANNEL}`, form: 'self', key: KEY_A, feeds: [exeFeed], sig: sigA(exeFeed), bytes: real, artifact: EXE, reason: /is not an \.AppImage/, notice: UNFIT, noUnverifiedNotice: true },
  { name: 'self · stale cached .sig, fresh on re-read', form: 'self', key: KEY_A, feeds: [realFeed], sig: sigA(realFeed), staleSig: sigA(staleFeed), bytes: real, expectDownload: true, log: /the first read was stale .*; the fresh read verified/ },
  { name: 'notify · valid signature', form: 'notify', key: KEY_A, feeds: [realFeed], sig: sigA(realFeed), bytes: real, notice: new RegExp(`notice — Deus Neuma ${VERSION} is available$`, 'm') },
  { name: 'notify · no .sig', form: 'notify', key: KEY_A, feeds: [realFeed], sig: null, bytes: real, reason: NO_SIG },
];

const FIXTURE_MAIN = `
const { app, net, Notification } = require('electron');
const cfg = JSON.parse(process.env.SIG_PROOF_CASE);
app.setPath('userData', cfg.userData);
const { autoUpdater } = require(${JSON.stringify(path.join(REPO, 'node_modules/electron-updater'))});
const { configureUpdater, wireUpdater } = require(${JSON.stringify(path.join(REPO, 'electron/auto-update.cjs'))});
const { channelFileFor } = require(${JSON.stringify(path.join(REPO, 'electron/release-signature.cjs'))});
const say = (line) => process.stdout.write(line + '\\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  configureUpdater(autoUpdater, cfg.form, cfg.feed);
  autoUpdater.forceDevUpdateConfig = true; // the rig's Electron is unpacked; packaged deb/rpm set this too
  let started = false;
  let settled = false;
  autoUpdater.logger = {
    info: (m) => { if (String(m).startsWith('Downloading update from')) started = true; say('[updater] ' + m); },
    warn: (m) => say('[updater] ' + m),
    error: (m) => say('[updater] ' + m),
  };
  autoUpdater.on('update-downloaded', () => { settled = 'downloaded'; });
  autoUpdater.on('error', () => { settled = settled || 'error'; });
  const { check } = wireUpdater({
    updater: autoUpdater,
    form: cfg.form,
    feedUrl: cfg.feed,
    Notification,
    refreshTray: () => {},
    log: { info: say, warn: say },
    publicKeyText: cfg.publicKeyText,
    fetchImpl: (url, options) => net.fetch(url, options),
    channelFile: channelFileFor(process.platform, process.arch),
  });
  await check();
  const until = Date.now() + (started ? 60000 : 2000);
  while (Date.now() < until && !settled) await sleep(100);
  say('RESULT ' + JSON.stringify({ started, settled }));
  app.exit(0);
});
`;

// impure — one case: its own feed server, its own Electron
const runCase = async (c, root) => {
  const requests = [];
  const artifact = c.artifact ?? ARTIFACT;
  let feedHits = 0;
  const server = createServer((req, res) => {
    const { pathname, search } = new URL(req.url, 'http://feed');
    requests.push(pathname);
    if (pathname === `/${CHANNEL}`) {
      const body = c.feeds[Math.min(feedHits, c.feeds.length - 1)];
      feedHits += 1;
      res.writeHead(200, { 'content-type': 'text/yaml' }).end(body);
    } else if (pathname === `/${CHANNEL}.sig` && c.sig) {
      // a cache keyed by URL: only a query it has never seen reaches the fresh signature
      res.writeHead(200, { 'content-type': 'text/plain' }).end(c.staleSig && search === '' ? c.staleSig : c.sig);
    } else if (pathname === `/${artifact}`) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': c.bytes.length }).end(c.bytes);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const feed = `http://127.0.0.1:${server.address().port}/`;

  const dir = await fs.mkdtemp(path.join(root, 'case-'));
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'update-signature-proof', version: '0.0.1', main: 'main.cjs' }));
  await fs.writeFile(path.join(dir, 'main.cjs'), FIXTURE_MAIN);
  // what electron-builder writes as app-update.yml; electron-updater names its cache folder from it
  await fs.writeFile(path.join(dir, 'dev-app-update.yml'), `provider: generic\nurl: ${feed}\nupdaterCacheDirName: neuma-sig-proof-updater\n`);
  const oldApp = path.join(dir, 'old.AppImage');
  await fs.writeFile(oldApp, 'the running build');

  const env = {
    ...process.env,
    SIG_PROOF_CASE: JSON.stringify({ form: c.form, feed, publicKeyText: c.key, userData: path.join(dir, 'userData') }),
    APPIMAGE: oldApp, // the self form's marker: the file a swap would replace
    XDG_CACHE_HOME: path.join(dir, 'cache'),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(dir, 'no-bus')}`,
    ELECTRON_ENABLE_LOGGING: '0',
  };
  if (c.form !== 'self') delete env.APPIMAGE;
  let out = '';
  const child = spawn(path.join(REPO, 'node_modules/.bin/electron'), ['--ozone-platform=headless', dir], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', () => {});
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 120_000);
    child.once('exit', (exitCode) => { clearTimeout(timer); resolve(exitCode); });
  });
  await new Promise((resolve) => server.close(resolve));

  const result = JSON.parse(out.match(/^RESULT (.*)$/m)?.[1] ?? '{}');
  const artifactAsked = requests.includes(`/${artifact}`);
  const problems = [];
  if (code !== 0) problems.push(`electron exited ${code}`);
  if (!requests.includes(`/${CHANNEL}`)) problems.push('the feed was never asked');
  if (c.expectDownload) {
    if (!artifactAsked) problems.push('downloadUpdate never fetched the installer');
    if (result.settled !== 'downloaded') problems.push(`electron-updater did not finish the verified download (${result.settled})`);
  } else {
    if (artifactAsked) problems.push('the installer was requested — a download began');
    if (result.started) problems.push('electron-updater began a download');
  }
  if (c.reason) {
    if (!new RegExp(`update ${VERSION} not downloaded — .*${c.reason.source}`).test(out)) problems.push(`no logged reason matching ${c.reason}`);
    if (!c.noUnverifiedNotice && !UNVERIFIED.test(out)) problems.push('no "could not be verified" notice');
    if (c.noUnverifiedNotice && UNVERIFIED.test(out)) problems.push('a validly signed feed was called unverified');
  }
  if (c.notice && !c.notice.test(out)) problems.push(`no notice matching ${c.notice}`);
  if (c.log && !c.log.test(out)) problems.push(`no log line matching ${c.log}`);
  if (c.form === 'notify' && c.reason && /notice — Deus Neuma \S+ is available$/m.test(out)) problems.push('an unverified update was announced as available');
  if (c.sigNeverAsked && requests.includes(`/${CHANNEL}.sig`)) problems.push('the .sig was fetched with no key to check it');
  const reasonLine = out.match(/not downloaded — (.*)$/m)?.[1];
  return { problems, requests, reasonLine, out };
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'update-signature-proof-'));
let failed = 0;
for (const c of CASES) {
  const { problems, requests, reasonLine, out } = await runCase(c, root);
  if (problems.length) {
    failed += 1;
    say(`FAIL ${c.name}\n  - ${problems.join('\n  - ')}\n  requests: ${requests.join(' ')}\n${out}`);
  } else {
    say(`PASS ${c.name} — requests: ${requests.join(' ')}${reasonLine ? ` — reason: ${reasonLine}` : ''}`);
  }
}
await fs.rm(root, { recursive: true, force: true });
if (failed) {
  say(`FAIL: ${failed} of ${CASES.length} cases`);
  process.exit(1);
}
say(`PASS: ${CASES.length} of ${CASES.length} cases`);
