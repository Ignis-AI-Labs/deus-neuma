/* global setInterval, clearInterval, setTimeout, Buffer */
// The Ollama archive arrives whole, or is fetched again before anyone is told: obtainArchive
// against a REAL HTTP server on loopback that serves real bytes (with Range) and counts every
// request, in each of the ways a real download goes wrong. No mocks (RULE 0): the real fetch,
// stream, SHA-256 and filesystem path runs in every case.
//
// The cause behind the checksum message a person saw (2026-10-23): a second job resumed a .part
// the first was still writing (reproduced on the old code: […],
// and a corrupt archive left on disk). The job no longer allows two (managed-ollama-job.test.js);
// here the archive is judged on disk, and every bad download is fetched again by itself.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import { obtainArchive } from '../../backend/services/managed-ollama.js';
import { rangeStart } from '../../backend/services/managed-ollama-download.js';

const BYTES = randomBytes(3 * 1024 * 1024 + 17);
const SHA = createHash('sha256').update(BYTES).digest('hex');
let server; let requests = []; let dir; let asset;
// how the next requests are answered: a list of modes, used up one per request, then 'good'
let modes = [];

const answer = (req, res) => {
  const mode = modes.shift() || 'good';
  requests.push(req.headers.range || 'full');
  const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
  const from = m ? Number(m[1]) : 0;
  if (mode === 'page') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<html><body>Sign in to this network</body></html>');
  }
  if (mode === 'wrong-start') {
    res.writeHead(206, { 'Content-Length': BYTES.length, 'Content-Range': `bytes 0-${BYTES.length - 1}/${BYTES.length}` });
    return res.end(BYTES);
  }
  const body = BYTES.subarray(from);
  res.writeHead(m ? 206 : 200, { 'Content-Length': body.length, ...(m ? { 'Content-Range': `bytes ${from}-${BYTES.length - 1}/${BYTES.length}` } : {}) });
  if (mode === 'cut') { res.write(body.subarray(0, 1024 * 1024)); return setTimeout(() => res.destroy(), 50); }
  if (mode !== 'slow') return res.end(body);
  // ~12 MB/s: a download long enough for something to happen to it while it runs
  let at = 0;
  const tick = setInterval(() => {
    const end = Math.min(at + 64 * 1024, body.length);
    res.write(body.subarray(at, end)); at = end;
    if (at >= body.length) { clearInterval(tick); res.end(); }
  }, 5);
  req.on('close', () => clearInterval(tick));
  return undefined;
};

beforeAll(async () => {
  dir = await createTempDir('managed-ollama-archive');
  server = http.createServer(answer);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  asset = { name: 'ollama-test.tar.zst', url: `http://127.0.0.1:${server.address().port}/ollama-test.tar.zst`, size: BYTES.length, sha256: SHA };
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

const fresh = (name, next = []) => { requests = []; modes = [...next]; return path.join(dir, name, asset.name); };
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('the Ollama archive on disk', () => {
  it('a matching archive already on disk is used as it is — no request at all', async () => {
    const archive = fresh('kept');
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(archive, BYTES);
    expect(await obtainArchive(asset, archive)).toBe('kept');
    expect(requests).toEqual([]);
    expect(sha(archive)).toBe(SHA);
  });

  it('a corrupt archive on disk is removed and replaced by a whole download', async () => {
    const archive = fresh('corrupt');
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    const bad = Buffer.from(BYTES); bad[1000] ^= 0xff;
    fs.writeFileSync(archive, bad);
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests).toEqual(['full']);
    expect(sha(archive)).toBe(SHA);
  });

  it('a partial download resumes from where it stopped', async () => {
    const archive = fresh('partial');
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    const half = Math.floor(BYTES.length / 2);
    fs.writeFileSync(`${archive}.part`, BYTES.subarray(0, half));
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests).toEqual([`bytes=${half}-`]);
    expect(sha(archive)).toBe(SHA);
    expect(fs.existsSync(`${archive}.part`)).toBe(false);
  });

  it('nothing on disk: one whole download, verified, its folder made', async () => {
    const archive = fresh('none');
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests).toEqual(['full']);
    expect(sha(archive)).toBe(SHA);
  });
});

describe('a download that goes wrong is fetched again before anyone is told', () => {
  it('a .part left by another attempt that does not belong is discarded after its resume fails the hash, then fetched whole', async () => {
    const archive = fresh('foreign-part');
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(`${archive}.part`, randomBytes(1024 * 1024));
    const lines = [];
    expect(await obtainArchive(asset, archive, { onLine: (l) => lines.push(l) })).toBe('downloaded');
    expect(requests).toEqual([`bytes=${1024 * 1024}-`, 'full']);
    expect(sha(archive)).toBe(SHA);
    expect(lines).toEqual(['Downloading Ollama again (try 2 of 3)']);
  });

  it('a connection cut mid-download resumes on the next try, inside the same call', async () => {
    const archive = fresh('cut', ['cut']);
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests[0]).toBe('full');
    expect(requests[1]).toMatch(/^bytes=\d+-$/);
    expect(Number(/\d+/.exec(requests[1])[0])).toBeGreaterThan(0);
    expect(sha(archive)).toBe(SHA);
  });

  it('a web page in place of the archive is never saved as it: refused, then the real file fetched', async () => {
    const archive = fresh('page', ['page']);
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests).toEqual(['full', 'full']);
    expect(sha(archive)).toBe(SHA);
  });

  it('a resume answered from the wrong offset is never appended: the part is dropped and fetched whole', async () => {
    const archive = fresh('wrong-start', ['wrong-start']);
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(`${archive}.part`, BYTES.subarray(0, 4096));
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests).toEqual(['bytes=4096-', 'full']);
    expect(sha(archive)).toBe(SHA);
  });

  it('every try damaged: it says so by name after the last one, and leaves no damaged file behind', async () => {
    const archive = fresh('always-bad');
    const wrong = { ...asset, sha256: '0'.repeat(64) };
    const err = await obtainArchive(wrong, archive).catch((e) => e);
    expect(err.code).toBe('DOWNLOAD_DAMAGED');
    expect(requests).toEqual(['full', 'full', 'full']);
    expect(fs.existsSync(`${archive}.part`)).toBe(false);
    expect(fs.existsSync(archive)).toBe(false);
  });

  it('the folder deleted while the download runs: the next try makes it again and the archive lands whole', async () => {
    const archive = fresh('deleted', ['slow']);
    const running = obtainArchive(asset, archive);
    await new Promise((r) => setTimeout(r, 80));
    fs.rmSync(path.dirname(archive), { recursive: true, force: true });
    expect(await running).toBe('downloaded');
    expect(sha(archive)).toBe(SHA);
  });

  it('a 206 names where its bytes begin', () => {
    expect(rangeStart('bytes 4096-9999/10000')).toBe(4096);
    expect(rangeStart('bytes */10000')).toBeNull();
    expect(rangeStart(null)).toBeNull();
  });
});
