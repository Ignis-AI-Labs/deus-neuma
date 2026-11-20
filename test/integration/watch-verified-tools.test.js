import { afterEach, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { obtainArchive } from '../../backend/services/managed-ollama-download.js';
import { fileSha256, gzipMatchesFile, matchesSha256 } from '../../backend/services/watch/verified-tool.js';

const roots = [];
const servers = [];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-watch-pin-'));
  roots.push(dir);
  return dir;
};

const serve = async (handler) => {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

afterEach(async () => {
  while (servers.length) await new Promise((resolve) => servers.pop().close(resolve));
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe('managed media tool integrity', () => {
  test('real raw and gzip bytes pass, while altered executables and archives fail', async () => {
    const dir = root();
    const payload = Buffer.from('a real small executable fixture\n');
    const raw = path.join(dir, 'yt-dlp');
    fs.writeFileSync(raw, payload);
    expect(await fileSha256(raw)).toBe(sha256(payload));
    expect(await matchesSha256(raw, sha256(payload))).toBe(true);
    fs.appendFileSync(raw, 'x');
    expect(await matchesSha256(raw, sha256(payload))).toBe(false);

    const gz = path.join(dir, 'ffmpeg.gz');
    const bin = path.join(dir, 'ffmpeg');
    fs.writeFileSync(gz, zlib.gzipSync(payload));
    fs.writeFileSync(bin, payload);
    expect(await matchesSha256(gz, sha256(fs.readFileSync(gz)))).toBe(true);
    expect(await gzipMatchesFile(gz, bin)).toBe(true);
    fs.writeFileSync(bin, Buffer.from('a different executable\n'));
    expect(await gzipMatchesFile(gz, bin)).toBe(false);
    fs.writeFileSync(bin, payload);
    fs.writeFileSync(gz, zlib.gzipSync(Buffer.from('a different gzip payload\n')));
    expect(await gzipMatchesFile(gz, bin)).toBe(false);
  });

  test('a real local HTTP download is kept, repaired, and rejected on a wrong digest', async () => {
    const dir = root();
    const payload = Buffer.from('pinned bytes served over real HTTP\n');
    let requests = 0;
    const origin = await serve((req, res) => {
      requests += 1;
      const bytes = req.url === '/hostile' ? Buffer.alloc(payload.length, 0x58) : payload;
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
      res.end(bytes);
    });
    const asset = { name: 'tool', label: 'tool', url: `${origin}/valid`, size: payload.length, sha256: sha256(payload) };
    const archive = path.join(dir, 'tool');
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(fs.readFileSync(archive)).toEqual(payload);
    expect(await obtainArchive(asset, archive)).toBe('kept');
    expect(requests).toBe(1);
    fs.writeFileSync(archive, Buffer.alloc(payload.length, 0x41));
    expect(await obtainArchive(asset, archive)).toBe('downloaded');
    expect(fs.readFileSync(archive)).toEqual(payload);
    expect(requests).toBe(2);
    const hostileArchive = path.join(dir, 'hostile-tool');
    await expect(obtainArchive({ ...asset, url: `${origin}/hostile` }, hostileArchive, { tries: 1 })).rejects.toThrow('pinned SHA-256');
    expect(fs.existsSync(hostileArchive)).toBe(false);
    expect(fs.readFileSync(archive)).toEqual(payload);
  });

  test('production reuse checks pins and contains no self-update channel', () => {
    const tools = fs.readFileSync(path.resolve(import.meta.dirname, '../../backend/services/watch/watch-tools.js'), 'utf8');
    const fetch = fs.readFileSync(path.resolve(import.meta.dirname, '../../backend/services/watch/watch-fetch.js'), 'utf8');
    const plan = fs.readFileSync(path.resolve(import.meta.dirname, '../../backend/services/watch/watch-plan.js'), 'utf8');
    expect(tools).toContain('record?.version === YT_DLP_VERSION && await matchesSha256(bin, pin.sha256)');
    expect(tools).toContain('await matchesSha256(gz, asset.sha256) && await gzipMatchesFile(gz, bin)');
    expect(tools).toContain('await obtainArchive(asset, gz);\n    await gunzipTo(gz, bin);');
    for (const source of [tools, fetch, plan]) {
      expect(source).not.toContain('updateYtDlp');
      expect(source).not.toContain('ytDlpUpdateArgs');
      expect(source).not.toContain('fetchWithUpdate');
    }
  });
});
