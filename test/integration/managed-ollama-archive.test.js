// The Ollama archive is never downloaded twice: obtainArchive against a REAL HTTP server on
// loopback that serves real bytes (with Range) and counts every request. No mocks (RULE 0):
// the real fetch, stream, SHA-256 and filesystem path runs in every case.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import { obtainArchive } from '../../backend/services/managed-ollama.js';

const BYTES = randomBytes(3 * 1024 * 1024 + 17);
const SHA = createHash('sha256').update(BYTES).digest('hex');
let server; let requests = []; let dir; let asset;

beforeAll(async () => {
  dir = await createTempDir('managed-ollama-archive');
  server = http.createServer((req, res) => {
    requests.push(req.headers.range || 'full');
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    if (m) {
      const from = Number(m[1]);
      res.writeHead(206, { 'Content-Length': BYTES.length - from, 'Content-Range': `bytes ${from}-${BYTES.length - 1}/${BYTES.length}` });
      res.end(BYTES.subarray(from));
    } else {
      res.writeHead(200, { 'Content-Length': BYTES.length });
      res.end(BYTES);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  asset = { name: 'ollama-test.tar.zst', url: `http://127.0.0.1:${server.address().port}/ollama-test.tar.zst`, size: BYTES.length, sha256: SHA };
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

const fresh = (name) => { requests = []; return path.join(dir, name); };
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('the Ollama archive on disk', () => {
  it('a matching archive already on disk is used as it is — no request at all', async () => {
    const archive = fresh('kept.tar.zst');
    fs.writeFileSync(archive, BYTES);
    expect(await obtainArchive(asset, archive)).toBe('kept');
    expect(requests).toEqual([]);
    expect(sha(archive)).toBe(SHA);
  });

  it('an archive that does not match the pin is replaced by a whole download', async () => {
    const archive = fresh('corrupt.tar.zst');
    const bad = Buffer.from(BYTES); bad[1000] ^= 0xff;
    fs.writeFileSync(archive, bad);
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests).toEqual(['full']);
    expect(sha(archive)).toBe(SHA);
  });

  it('a partial download resumes from where it stopped', async () => {
    const archive = fresh('partial.tar.zst');
    const half = Math.floor(BYTES.length / 2);
    fs.writeFileSync(`${archive}.part`, BYTES.subarray(0, half));
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests).toEqual([`bytes=${half}-`]);
    expect(sha(archive)).toBe(SHA);
    expect(fs.existsSync(`${archive}.part`)).toBe(false);
  });

  it('nothing on disk: one whole download, verified', async () => {
    const archive = fresh('none.tar.zst');
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(requests).toEqual(['full']);
    expect(sha(archive)).toBe(SHA);
  });
});
