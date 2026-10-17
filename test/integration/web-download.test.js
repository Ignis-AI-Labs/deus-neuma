/** Real signed-wallet approval, public download, original bytes, and local file confinement. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace from '../../core/workspace/neuma-workspace.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { intentType } from '../../backend/services/intents/registry.js';
import { webSettings } from '../../backend/services/web-settings.js';
import { fetchDownloadBytes, DOWNLOAD_MAX_BYTES } from '../../backend/services/web-download.js';
import { saveDownload } from '../../backend/services/download-store.js';
import { readBounded, interpretBody } from '../../backend/services/web-fetch.js';

const SOURCE = 'https://defillama.com/defillama-press-kit.zip';
// Independent native HTTPS reference: this origin returns 403 to undici's fetch.
const originalBytes = () => new Promise((resolve, reject) => {
  const request = https.get(SOURCE, { headers: { 'User-Agent': 'NeumaWeb/1.0 (local research tool)' } }, response => {
    if (response.statusCode !== 200) { response.destroy(); reject(new Error(`reference HTTP ${response.statusCode}`)); return; }
    const chunks = [];
    let total = 0;
    response.on('data', chunk => {
      total += chunk.length;
      if (total > DOWNLOAD_MAX_BYTES) response.destroy(new Error('reference too large'));
      else chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => resolve(Buffer.concat(chunks)));
  });
  request.setTimeout(30_000, () => request.destroy(new Error('reference timed out')));
  request.on('error', reject);
});
let kit;
let previous;
let intents;
beforeEach(async () => {
  previous = { path: process.env.NEUMA_WEB_ACCESS_PATH, enabled: process.env.NEUMA_WEB_ACCESS };
  kit = await createHarnessTurnKit();
  process.env.NEUMA_WEB_ACCESS_PATH = path.join(kit.root, 'web-access.json');
  delete process.env.NEUMA_WEB_ACCESS;
  await webSettings.setEnabled(true);
  intents = path.join(workspace.pathFor(kit.laneId), 'intents');
  await fs.mkdir(intents, { recursive: true });
});
afterEach(async () => {
  if (previous.path === undefined) delete process.env.NEUMA_WEB_ACCESS_PATH;
  else process.env.NEUMA_WEB_ACCESS_PATH = previous.path;
  if (previous.enabled === undefined) delete process.env.NEUMA_WEB_ACCESS;
  else process.env.NEUMA_WEB_ACCESS = previous.enabled;
  await kit?.close();
});
const fileIntent = async (payload) => fs.writeFile(path.join(intents, 'asset.json'), JSON.stringify({ type: 'web/download', ...payload }));
const sweep = (mode = 'ask') => sweepIntents(kit.connection, { mode, lanePolicy: null, emit: kit.emit });
const card = () => untilHarness(() => kit.frames.find(frame => frame.type === 'tool:approval_request'));
const downloads = () => path.join(workspace.pathFor(kit.laneId), 'downloads');

describe('download intent through real approval transport', () => {
  test('approved official press kit lands intact with a compact receipt and settles only once', async () => {
    await fileIntent({ url: SOURCE, name: 'defillama-press-kit.zip' });
    const run = sweep();
    const request = await card();
    await expect(fs.stat(downloads())).rejects.toMatchObject({ code: 'ENOENT' });
    kit.decide(request, 'allow');
    const results = await run;
    expect(results[0], JSON.stringify(results)).toMatchObject({ tool: 'intents/web.download', status: 'ok' });
    const receipt = JSON.parse(results[0].content.split('\n')[1]);
    expect(results[0].content.length).toBeLessThan(1000);
    expect(receipt.sourceUrl).toBe(SOURCE);
    expect(receipt.bytes).toBeGreaterThan(20_000);
    const saved = await fs.readFile(receipt.path);
    expect(saved.subarray(0, 2).toString()).toBe('PK');
    // Independently retrieve the same official file; equality proves no extraction or slicing.
    expect(saved.equals(await originalBytes())).toBe(true);
    expect(receipt.sha256).toBe(createHash('sha256').update(saved).digest('hex'));
    expect(JSON.parse(await fs.readFile(path.join(path.dirname(receipt.path), '.receipt.json'), 'utf8'))).toEqual(receipt);
    expect((await workspace.readJournal(kit.laneId)).some(entry => entry.metadata?.tool === 'web.download')).toBe(true);
    expect(await sweep()).toEqual([]);
    expect(await fs.readdir(downloads())).toHaveLength(1);
  }, 60_000);

  test('deny and observe never write a download', async () => {
    await fileIntent({ url: SOURCE, name: 'logo.zip' });
    expect(await sweep('observe')).toEqual([]);
    const run = sweep();
    kit.decide(await card(), 'deny');
    expect((await run)[0].status).toBe('denied');
    await expect(fs.stat(downloads())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('turning web access off during approval prevents the download', async () => {
    await fileIntent({ url: SOURCE, name: 'logo.zip' });
    const run = sweep();
    const request = await card();
    await webSettings.setEnabled(false);
    kit.decide(request, 'allow');
    expect((await run)[0]).toMatchObject({ status: 'error', error: 'web access is off; no file saved' });
    await expect(fs.stat(downloads())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('invalid paths and URL credentials are refused before approval', async () => {
    const type = intentType('web/download');
    for (const payload of [
      { url: SOURCE, name: '../escape.svg' }, { url: SOURCE, name: '/tmp/escape.svg' },
      { url: 'https://user:password@example.com/a.svg', name: 'a.svg' },
      { url: 'file:///etc/passwd', name: 'a.svg' },
    ]) expect((await type.validate(payload, { connection: kit.connection })).status).toBe('invalid');
    await fileIntent({ url: SOURCE, name: '../escape.svg' });
    expect((await sweep())[0].status).toBe('error');
    expect(kit.frames.some(frame => frame.type === 'tool:approval_request')).toBe(false);
  });
});

describe('original files and refusal boundaries', () => {
  test('an SVG beyond the preview cap stays byte-identical and existing files never get overwritten', async () => {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><!--${'original artwork '.repeat(12000)}--><path d="M0 0L10 10"/></svg>`);
    expect(interpretBody(bytes.toString(), 'image/svg+xml', 200).overflowed).toBe(true);
    const input = { name: 'logo.svg', bytes, url: 'https://example.com/logo.svg', contentType: 'image/svg+xml' };
    const first = await saveDownload(workspace.pathFor(kit.laneId), input);
    const second = await saveDownload(workspace.pathFor(kit.laneId), input);
    expect(first.path).not.toBe(second.path);
    expect((await fs.readFile(first.path)).equals(bytes)).toBe(true);
    expect((await fs.readFile(second.path)).equals(bytes)).toBe(true);
    expect(first.bytes).toBe(bytes.length);
    expect((await fs.stat(first.path)).mode & 0o777).toBe(0o600);
  });

  test('symlinked downloads cannot write outside the caller workspace', async () => {
    const outside = path.join(kit.root, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, downloads());
    await expect(saveDownload(workspace.pathFor(kit.laneId), {
      name: 'logo.svg', bytes: Buffer.from('<svg/>'), url: SOURCE, contentType: 'image/svg+xml',
    })).rejects.toThrow('real directory');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  test('oversized and cancelled saves leave no asset directory', async () => {
    const input = { name: 'large.svg', bytes: Buffer.alloc(DOWNLOAD_MAX_BYTES + 1), url: SOURCE, contentType: 'image/svg+xml' };
    await expect(saveDownload(workspace.pathFor(kit.laneId), input)).rejects.toThrow('10 MiB');
    await expect(saveDownload(workspace.pathFor(kit.laneId), { ...input, bytes: Buffer.from('<svg/>') }, { signal: AbortSignal.abort() })).rejects.toThrow();
    await expect(fs.stat(downloads())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('loopback, non-http URLs and cancelled network requests fail closed', async () => {
    for (const url of ['http://127.0.0.1/', 'http://localhost/', 'file:///etc/passwd']) {
      expect(await fetchDownloadBytes(url)).toMatchObject({ ok: false, error: expect.stringContaining('target refused') });
    }
    expect(await fetchDownloadBytes(SOURCE, { signal: AbortSignal.abort() })).toMatchObject({ ok: false });
  });

  test('the shared counted reader detects a real cut socket and overflow', async () => {
    // An owned HTTP server transmits actual bytes; the public-target guard stays unchanged.
    const server = http.createServer((req, res) => {
      if (req.url === '/cut') {
        res.writeHead(200, { 'Content-Length': '50000' });
        res.write('partial SVG');
        setTimeout(() => res.destroy(), 20);
      } else res.end(Buffer.alloc(100));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const read = (route, max) => new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${server.address().port}${route}`, res => readBounded(res, max).then(resolve, reject)).on('error', reject);
    });
    try {
      expect(await read('/cut', 50000)).toMatchObject({ truncated: true });
      const overflow = await read('/overflow', 50);
      expect(overflow.truncated).toBe(true);
      expect(overflow.buf.length).toBe(50);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
