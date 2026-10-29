/**
 * THE UPDATE CHECK ASKS NOTHING UNTIL THE PERSON TURNS IT ON (CONNECTIONS, Design note, 2026-10-25: […]). The app's own
 * auto-update init in REAL Electron — the real electron-updater, the real timers — against a real
 * loopback feed that records every request. Electron calls itself packaged by its binary's name, so
 * the proof runs a hard-linked copy under another name (no flag, nothing faked). Its HOME is a temp
 * dir, so the operator's login entry and profile are never touched. Nothing is mocked.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import electronPath from 'electron';
import { afterAll, beforeAll, expect, test } from 'vitest';

const FIXTURE = fileURLToPath(new URL('../fixtures/update-switch-main.cjs', import.meta.url));
// The copy must share a filesystem with node_modules for hard links, so it lives beside it.
const WORK = path.join(path.dirname(path.dirname(path.dirname(electronPath))), '.cache', `update-switch-${process.pid}`);
let feed; let requests = []; let binary;

beforeAll(async () => {
  await fs.mkdir(WORK, { recursive: true });
  execFileSync('cp', ['-al', path.dirname(electronPath), path.join(WORK, 'dist')]);
  binary = path.join(WORK, 'dist', 'neuma-proof');
  await fs.rename(path.join(WORK, 'dist', path.basename(electronPath)), binary);
  feed = http.createServer((req, res) => {
    requests.push(req.url);
    if (!req.url.startsWith('/latest-linux.yml')) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/yaml' });
    // older than any build: the check completes as "up to date" and downloads nothing
    res.end('version: 0.0.1\nfiles:\n  - url: none.AppImage\n    sha512: none\n    size: 1\npath: none.AppImage\nsha512: none\nreleaseDate: 2026-01-01T00:00:00.000Z\n');
  });
  await new Promise((resolve) => feed.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise((resolve) => feed.close(resolve));
  await fs.rm(WORK, { recursive: true, force: true });
});

/** One launch of the real init; resolves with what it printed. */
const launch = async ({ switches, ask = false, feedUrl = `http://127.0.0.1:${feed.address().port}/` }) => {
  const run = path.join(WORK, `run-${Date.now()}`);
  await fs.mkdir(path.join(run, 'home'), { recursive: true });
  await fs.writeFile(path.join(run, 'connections.json'), JSON.stringify(switches));
  const env = {
    ...process.env, HOME: path.join(run, 'home'), XDG_CONFIG_HOME: path.join(run, 'home', '.config'),
    UPDATE_SWITCH_PROFILE: path.join(run, 'profile'), NEUMA_CONNECTIONS_PATH: path.join(run, 'connections.json'),
    NEUMA_UPDATE_FEED_URL: feedUrl, UPDATE_SWITCH_ASK: ask ? '1' : '0',
  };
  delete env.APPIMAGE;
  requests = [];
  const child = spawn(binary, ['--disable-gpu', FIXTURE], { env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  return { code, out, asked: [...requests] };
};

test('switched off, the timers ask the site nothing', async () => {
  const { code, out, asked } = await launch({ switches: {} });
  expect(out).toContain('FORM notify');
  expect(code).toBe(0);
  expect(asked).toEqual([]);
}, 60_000);

test('switched off, the person\'s Check now still asks — once, because they asked', async () => {
  const { out, asked } = await launch({ switches: {}, ask: true });
  expect(out).toMatch(/ASKED \{"ok":true,"version":null\}/);
  expect(asked.filter((u) => u.startsWith('/latest-linux.yml'))).toHaveLength(1);
}, 60_000);

test('switched on, the first scheduled tick asks the feed', async () => {
  const { asked } = await launch({ switches: { 'update-check': true } });
  expect(asked.some((u) => u.startsWith('/latest-linux.yml'))).toBe(true);
}, 60_000);

test('a malformed feed address no longer quits the app: no checks, the app runs on', async () => {
  const { code, out } = await launch({ switches: { 'update-check': true }, feedUrl: 'http://[bad' });
  expect(out).toContain('update feed unusable');
  expect(out).toContain('FORM notify');
  expect(code).toBe(0);
}, 60_000);
