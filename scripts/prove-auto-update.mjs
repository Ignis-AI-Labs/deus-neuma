#!/usr/bin/env node
/**
 * prove-auto-update.mjs — the REAL end-to-end proof of the update pipeline's
 * client half (RULE 0: no mocks anywhere in the path being claimed).
 *
 * What it proves: a packaged NEUMA AppImage, pointed at a keyless feed,
 * discovers a newer build, downloads and verifies it, and replaces a scratch
 * copy of the old build on quit. The release artifacts passed to this script
 * are read-only inputs; the proof never mutates them.
 *
 * The rig:
 *   --old <path>   the running AppImage (older version, updater aboard)
 *   --new <path>   the newer AppImage the feed offers
 *   --yml <path>   the newer build's latest-linux.yml (emitted beside it)
 *
 * It creates an isolated keyless runtime, binds the packaged backend to
 * kernel-assigned port :0, serves the feed on loopback, and copies `--old`
 * into that runtime before launch. Artifact requests redirect to a second
 * loopback object server through an X-Amz-Credential URL, matching the
 * production site→R2 shape. The proof refuses any Authorization header at
 * either local server. A successful swap means the installed scratch artifact
 * has exactly the newer build's SHA-256 while both source artifacts remain
 * unchanged.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const oldArg = value('old');
const newArg = value('new');
const ymlArg = value('yml');
const EXPECT = value('expect') || 'swap'; // 'swap' (AppImage) or 'notify' (system package)
if (!oldArg || !newArg || !ymlArg || !['swap', 'notify'].includes(EXPECT)) {
  console.error('usage: node scripts/prove-auto-update.mjs --old <AppImage|unpacked-bin> --new <AppImage> --yml <latest-linux.yml> [--expect swap|notify]');
  process.exit(1);
}
const OLD_APPIMAGE = path.resolve(oldArg);
const NEW_APPIMAGE = path.resolve(newArg);
const NEW_YML = path.resolve(ymlArg);

const say = (line) => process.stderr.write(`[prove] ${line}\n`);
const sha256 = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const versionFromMetadata = (metadata) =>
  metadata.match(/^version:\s*['"]?([0-9A-Za-z.+-]+)['"]?\s*$/m)?.[1] ?? null;
const expectedVersion = versionFromMetadata(await fs.readFile(NEW_YML, 'utf8'));
if (!expectedVersion) {
  say(`FAIL: ${NEW_YML} has no parseable version`);
  process.exit(1);
}

// A proof is a one-shot probe: :0 is the port law. Every writable root lives
// under HOME, and operator mode intentionally bypasses agent-lane detection.
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-update-proof-'));
const RUNTIME_ROOT = path.join(HOME, 'runtime');
const RUNTIME_ENV = Object.freeze({
  NEUMA_PIPELINE_MODE: 'operator',
  NEUMA_PORT: '0',
  PORT: '0',
  XDG_CACHE_HOME: path.join(HOME, '.cache'),
  XDG_CONFIG_HOME: path.join(HOME, '.config'),
  NEUMA_ROOT_LOCK_PATH: path.join(RUNTIME_ROOT, 'root-lock.json'),
  NEUMA_DATA_ROOT: path.join(RUNTIME_ROOT, 'data'),
  NEUMA_REALM_ROOT: path.join(RUNTIME_ROOT, 'realm'),
  NEUMA_VAULT_ROOT: path.join(RUNTIME_ROOT, 'vault'),
  NEUMA_SECRETS_FILE: path.join(RUNTIME_ROOT, 'secrets.json'),
  NEUMA_BACKUPS_ROOT: path.join(RUNTIME_ROOT, 'backups'),
  WORKSPACES_ROOT: path.join(RUNTIME_ROOT, 'workspaces'),
  WITNESSES_ROOT: path.join(RUNTIME_ROOT, 'witnesses'),
  AI_WITNESSES_ROOT: path.join(RUNTIME_ROOT, 'ai-witnesses'),
  PLATFORM_DB_PATH: path.join(RUNTIME_ROOT, 'platform', 'platform.db'),
});

const RUNNING_APP = EXPECT === 'swap'
  ? path.join(HOME, path.basename(OLD_APPIMAGE))
  : OLD_APPIMAGE;
if (EXPECT === 'swap') {
  await fs.copyFile(OLD_APPIMAGE, RUNNING_APP);
  await fs.chmod(RUNNING_APP, 0o755);
}

// The feed requires the same Bearer credential as production. Artifact bytes
// live on a second server so the real redirect path can prove the key is gone.
const artifacts = new Map(Object.entries({
  [`/${path.basename(NEW_APPIMAGE)}`]: NEW_APPIMAGE,
}));
const objectAuthHeaders = [];
const objectServer = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://object').pathname;
  objectAuthHeaders.push(req.headers.authorization ?? null);
  const file = artifacts.get(pathname);
  if (!file) { res.writeHead(404); res.end('not here'); return; }
  try {
    const stat = await fs.stat(file);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end('missing');
  }
});
await new Promise((resolve) => objectServer.listen(0, '127.0.0.1', resolve));
const objectOrigin = `http://127.0.0.1:${objectServer.address().port}`;

const servedLog = [];
const ymlPath = `/${path.basename(NEW_YML)}`;
let firstFeedRequestAt = null;
const feedAuthHeaders = [];
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://feed').pathname;
  feedAuthHeaders.push(req.headers.authorization ?? null);
  if (req.headers.authorization) {
    res.writeHead(400); res.end('local proof must be license-free'); return;
  }
  servedLog.push(pathname);
  if (pathname === ymlPath && firstFeedRequestAt === null) firstFeedRequestAt = Date.now();
  if (pathname === ymlPath) {
    const stat = await fs.stat(NEW_YML);
    res.writeHead(200, { 'Content-Type': 'text/yaml', 'Content-Length': stat.size });
    createReadStream(NEW_YML).pipe(res);
    return;
  }
  if (!artifacts.has(pathname)) { res.writeHead(404); res.end('not here'); return; }
  res.writeHead(302, { Location: `${objectOrigin}${pathname}?X-Amz-Credential=proof` });
  res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const feedUrl = `http://127.0.0.1:${server.address().port}/`;
const closeServer = (target) => new Promise((resolve) => target.close(resolve));
const closeServers = () => Promise.all([closeServer(server), closeServer(objectServer)]);
say(`feed at ${feedUrl} · object store at ${objectOrigin} · packaged backend binds :0`);

const sourceSha = await sha256(OLD_APPIMAGE);
const newSha = await sha256(NEW_APPIMAGE);
say(`old sha256 ${sourceSha.slice(0, 16)}…  new sha256 ${newSha.slice(0, 16)}…`);
if (sourceSha === newSha) {
  say('FAIL: old and new are the same bytes — nothing to prove');
  await closeServers();
  process.exit(1);
}

// impure — the swap is proven by the completion marker electron-updater writes
// AFTER validation (update-info.json), never by the partial artifact's presence.
const cacheRoot = path.join(HOME, '.cache');
const swapReady = async () => {
  try {
    const dirs = await fs.readdir(cacheRoot);
    for (const dir of dirs) {
      if (!dir.toLowerCase().includes('updater')) continue;
      const pending = path.join(cacheRoot, dir, 'pending');
      const files = await fs.readdir(pending).catch(() => []);
      if (files.includes('update-info.json')) return true;
    }
  } catch { /* cache not created yet */ }
  return false;
};

const childEnv = {
  ...process.env,
  ...RUNTIME_ENV,
  HOME,
  NEUMA_UPDATE_FEED_URL: feedUrl,
};
delete childEnv.APPIMAGE;
const launchedAt = Date.now();
const child = spawn(RUNNING_APP, [], {
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const appLog = (await import('node:fs')).createWriteStream(path.join(HOME, 'proof-app.log'));
child.stdout.pipe(appLog);
child.stderr.pipe(appLog);
let childExited = false;
child.on('exit', (code) => { childExited = true; say(`app exited (code ${code})`); });

// The download lands in the electron-updater cache under the scratch HOME;
// update-info.json is written only after the bytes are verified and staged.
// Then quit does the swap. Timeout is generous: ~800 MB over loopback is
// seconds, but a cold Electron boot on a loaded box is not.
const deadline = Date.now() + 8 * 60 * 1000;

let ready = false;
if (EXPECT === 'notify') {
  // The notify form (deb/rpm under /opt): the check must RUN — the yml is
  // fetched and the version seen — and NOT ONE BYTE of the artifact may be
  // requested or staged, because the package manager owns the install.
  const quickCheckDeadlineMs = 20_000;
  const artifactPath = `/${path.basename(NEW_APPIMAGE)}`;
  const checkDeadline = launchedAt + quickCheckDeadlineMs;
  while (Date.now() < checkDeadline && !servedLog.includes(ymlPath) && !childExited) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!servedLog.includes(ymlPath)) {
    say('FAIL: the feed was never consulted — the check did not run');
    child.kill('SIGKILL');
    await closeServers();
    process.exit(1);
  }
  const checkDelayMs = firstFeedRequestAt - launchedAt;
  if (checkDelayMs > quickCheckDeadlineMs) {
    say(`FAIL: first update check took ${checkDelayMs} ms`);
    child.kill('SIGKILL');
    await closeServers();
    process.exit(1);
  }
  say(`first update check reached the feed in ${checkDelayMs} ms`);
  say('the check ran (the yml was fetched) — holding 75 s to prove no download follows');
  await new Promise((r) => setTimeout(r, 75000));
  const downloaded = servedLog.includes(artifactPath) || await swapReady();
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.on('exit', resolve)), new Promise((r) => setTimeout(r, 30000))]);
  await closeServers();
  const appOutput = await fs.readFile(path.join(HOME, 'proof-app.log'), 'utf8').catch(() => '');
  const versionSeen = appOutput.includes(`Found version ${expectedVersion} `);
  const sourceUntouched = await sha256(OLD_APPIMAGE) === sourceSha;
  const feedWasLicenseFree = feedAuthHeaders.length > 0
    && feedAuthHeaders.every((header) => header === null);
  const objectWasUntouched = objectAuthHeaders.length === 0;
  if (downloaded || !versionSeen || !sourceUntouched || !feedWasLicenseFree || !objectWasUntouched) {
    say(`FAIL: downloaded=${downloaded} versionSeen=${versionSeen} sourceUntouched=${sourceUntouched} feedLicenseFree=${feedWasLicenseFree} objectUntouched=${objectWasUntouched}`);
    process.exit(1);
  }
  say(`PASS: ${expectedVersion} was seen, zero artifact bytes were fetched, and both local servers stayed license-free`);
  process.exit(0);
}
while (Date.now() < deadline) {
  if (await swapReady()) { ready = true; break; }
  if (childExited) break; // a dead app stages nothing — report, don't wait
  await new Promise((r) => setTimeout(r, 2000));
}
if (!ready) {
  say(`FAIL: no staged update before the deadline (childExited=${childExited}; app log at ${path.join(HOME, 'proof-app.log')})`);
  child.kill('SIGKILL');
  await closeServers();
  process.exit(1);
}
const checkDelayMs = firstFeedRequestAt === null ? Infinity : firstFeedRequestAt - launchedAt;
const checkedQuickly = checkDelayMs <= 20_000;
say(`first update check reached the feed in ${checkDelayMs} ms`);
say('update downloaded and staged — sending SIGTERM (the app quits, the swap runs)');

const exited = new Promise((resolve) => child.on('exit', resolve));
child.kill('SIGTERM');
await Promise.race([exited, new Promise((r) => setTimeout(r, 60000))]);
await closeServers();

const runningName = path.basename(RUNNING_APP);
const installedApp = runningName === path.basename(NEW_APPIMAGE) || !/\d+\.\d+\.\d+/.test(runningName)
  ? RUNNING_APP
  : path.join(path.dirname(RUNNING_APP), path.basename(NEW_APPIMAGE));
const afterSha = await sha256(installedApp).catch(() => null);
const sourceAfterSha = await sha256(OLD_APPIMAGE);
const feedWasLicenseFree = feedAuthHeaders.length > 0 && feedAuthHeaders.every((header) => header === null);
const objectWasLicenseFree = objectAuthHeaders.length > 0 && objectAuthHeaders.every((header) => header === null);
if (afterSha === newSha && sourceAfterSha === sourceSha && feedWasLicenseFree && objectWasLicenseFree && checkedQuickly) {
  say(`PASS: ${path.basename(installedApp)} IS the new build (sha256 ${afterSha.slice(0, 16)}…)`);
  say('PASS: source artifacts were untouched and both local servers stayed license-free');
  say(`scratch HOME kept at ${HOME} for inspection`);
  process.exit(0);
}
say(`FAIL: installed=${afterSha?.slice(0, 16) || 'missing'} sourceUntouched=${sourceAfterSha === sourceSha} feedLicenseFree=${feedWasLicenseFree} objectLicenseFree=${objectWasLicenseFree} checkedQuickly=${checkedQuickly}`);
process.exit(1);
