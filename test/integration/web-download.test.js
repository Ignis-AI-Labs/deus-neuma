/** Real signed-wallet approval, public download, original bytes, and local file confinement. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace from '../../core/workspace/neuma-workspace.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { intentType } from '../../backend/services/intents/registry.js';
import { webSettings } from '../../backend/services/web-settings.js';
import { streamDownload, downloadByteGuard } from '../../backend/services/web-download.js';
import { fetchMediaBytes } from '../../backend/services/media-fetch.js';
import { screenWebEgress } from '../../backend/services/web-egress-screen.js';
import { saveDownload } from '../../backend/services/download-store.js';
import { readBounded, interpretBody } from '../../backend/services/web-fetch.js';

const SOURCE = 'https://defillama.com/defillama-press-kit.zip';
// A fill that writes known bytes, as streamDownload would: the store's own laws without the network.
const fillWith = (bytes, url, contentType) => async (file) => {
  await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  return { ok: true, url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), contentType };
};
// Independent native HTTPS reference: this origin returns 403 to undici's fetch.
const originalBytes = () => new Promise((resolve, reject) => {
  const request = https.get(SOURCE, { headers: { 'User-Agent': 'NeumaWeb/1.0 (local research tool)' } }, response => {
    if (response.statusCode !== 200) { response.destroy(); reject(new Error(`reference HTTP ${response.statusCode}`)); return; }
    const chunks = [];
    let total = 0;
    response.on('data', chunk => {
      total += chunk.length;
      if (total > 50 * 1024 * 1024) response.destroy(new Error('reference too large'));
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
    const fill = fillWith(bytes, 'https://example.com/logo.svg', 'image/svg+xml');
    const first = (await saveDownload(workspace.pathFor(kit.laneId), { name: 'logo.svg' }, fill)).receipt;
    const second = (await saveDownload(workspace.pathFor(kit.laneId), { name: 'logo.svg' }, fill)).receipt;
    expect(first.path).not.toBe(second.path);
    expect((await fs.readFile(first.path)).equals(bytes)).toBe(true);
    expect((await fs.readFile(second.path)).equals(bytes)).toBe(true);
    expect(first.bytes).toBe(bytes.length);
    expect((await fs.stat(first.path)).mode & 0o777).toBe(0o600);
  });

  test('a file past the old 10 MiB cap saves whole (Design note, 2026-11-02: no size cap; approval is the gate)', async () => {
    const bytes = Buffer.alloc(12 * 1024 * 1024, 7);
    const saved = await saveDownload(workspace.pathFor(kit.laneId), { name: 'model.bin' }, fillWith(bytes, 'https://example.com/model.bin', 'application/octet-stream'));
    expect(saved.ok).toBe(true);
    expect(saved.receipt.bytes).toBe(bytes.length);
    expect(saved.receipt.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  test('symlinked downloads cannot write outside the caller workspace', async () => {
    const outside = path.join(kit.root, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, downloads());
    await expect(saveDownload(workspace.pathFor(kit.laneId), { name: 'logo.svg' },
      fillWith(Buffer.from('<svg/>'), SOURCE, 'image/svg+xml'))).rejects.toThrow('real directory');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  test('failed and cancelled saves leave no asset directory', async () => {
    const failed = await saveDownload(workspace.pathFor(kit.laneId), { name: 'large.bin' }, async () => ({ ok: false, error: 'download interrupted' }));
    expect(failed).toMatchObject({ ok: false, error: 'download interrupted' });
    expect(await fs.readdir(downloads())).toEqual([]);
    await expect(saveDownload(workspace.pathFor(kit.laneId), { name: 'logo.svg' }, fillWith(Buffer.from('<svg/>'), SOURCE, 'image/svg+xml'), { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(await fs.readdir(downloads())).toEqual([]);
  });

  test('loopback, non-http URLs and cancelled network requests fail closed', async () => {
    const file = path.join(kit.root, 'never-written.bin');
    for (const url of ['http://127.0.0.1/', 'http://localhost/', 'file:///etc/passwd']) {
      expect(await streamDownload(url, file)).toMatchObject({ ok: false, error: expect.stringContaining('target refused') });
    }
    expect(await streamDownload(SOURCE, file, { signal: AbortSignal.abort() })).toMatchObject({ ok: false });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
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

describe('the streamed download resource guard (PR600 P6-74)', () => {
  const runGuard = async (chunks, { maxBytes = 64, reserveBytes = 0 } = {}) => {
    const file = path.join(kit.root, 'guarded.bin');
    const hash = createHash('sha256');
    let bytes = 0;
    const guard = downloadByteGuard({ directory: kit.root, hash, onBytes: (n) => { bytes = n; }, maxBytes, reserveBytes });
    await pipeline(Readable.from(chunks), guard, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    return { body: await fs.readFile(file), bytes, digest: hash.digest('hex') };
  };

  test('ordinary chunks land whole, counted and hashed, including the exact ceiling', async () => {
    const result = await runGuard([Buffer.from('abc'), Buffer.from('de')], { maxBytes: 5 });
    expect(result.body.toString()).toBe('abcde');
    expect(result.bytes).toBe(5);
    expect(result.digest).toBe(createHash('sha256').update('abcde').digest('hex'));
  });

  test('a chunk over the ceiling is refused instead of forwarded', async () => {
    await expect(runGuard([Buffer.from('abc'), Buffer.from('def')], { maxBytes: 5 }))
      .rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' });
    expect((await fs.readFile(path.join(kit.root, 'guarded.bin'))).toString()).toBe('abc');
  });

  test('actual free space is measured per chunk, not trusted from a declared length', async () => {
    await expect(runGuard([Buffer.from('abc')], { reserveBytes: Number.MAX_SAFE_INTEGER }))
      .rejects.toMatchObject({ code: 'DOWNLOAD_NO_SPACE' });
    expect((await fs.stat(path.join(kit.root, 'guarded.bin'))).size).toBe(0);
  });
});

// PR600 audit P6-04 (NEW-H3 reopened): a download and an image save are egress like a fetch. The
// keys are assembled at run time, so this file never trips the repo's own secret sweep.
describe('download and image-save egress is screened and carded (PR600 P6-04)', () => {
  const AWS_KEY = ['AKIA', 'Q'.repeat(16)].join('');
  const fileAs = (name, payload) => fs.writeFile(path.join(intents, `${name}.json`), JSON.stringify(payload));
  const cardFor = (tool) => untilHarness(() => kit.frames.find(frame => frame.type === 'tool:approval_request' && JSON.stringify(frame).includes(tool)));

  test('a key spelled into the address is refused before any card, in AUTO too, plain or encoded twice over', async () => {
    const nested = Buffer.from(Buffer.from(AWS_KEY).toString('base64')).toString('hex');
    const filings = [
      ['plain', { type: 'web/download', url: `https://collector.example/${AWS_KEY}.png`, name: 'a.png' }],
      ['nested', { type: 'web/download', url: `https://collector.example/a.png?k=${nested}`, name: 'a.png' }],
      ['image', { type: 'media/save', url: `https://collector.example/${AWS_KEY}.png` }],
      ['image-nested', { type: 'media/save', url: `https://collector.example/a.png?k=${nested}` }],
    ];
    for (const [name, payload] of filings) {
      await fileAs(name, payload);
      const results = await sweep('auto');
      expect(results, name).toHaveLength(1);
      expect(results[0].status, name).toBe('denied');
      expect(results[0].error, name).toMatch(/aws-access-key/);
      expect(results[0].error).not.toContain(AWS_KEY);
    }
    expect(kit.frames.some(frame => frame.type === 'tool:approval_request')).toBe(false);
    await expect(fs.stat(downloads())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('AUTO still raises the operator card for a download and for an image save', async () => {
    await fileAs('auto-download', { type: 'web/download', url: SOURCE, name: 'logo.zip' });
    const download = sweep('auto');
    kit.decide(await cardFor('web.download'), 'deny');
    expect((await download)[0]).toMatchObject({ tool: 'intents/web.download', status: 'denied' });
    await fileAs('auto-image', { type: 'media/save', url: 'https://cdn.example.com/x.png' });
    const image = sweep('auto');
    kit.decide(await cardFor('media.save'), 'deny');
    expect((await image)[0]).toMatchObject({ tool: 'intents/media.save', status: 'denied' });
    await expect(fs.stat(downloads())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('the fetch loops refuse a key-bearing address before any name lookup', async () => {
    const file = path.join(kit.root, 'never-written.bin');
    // .invalid never resolves: before the screen stood first this answered "unresolvable", after a lookup.
    const url = `https://${AWS_KEY.toLowerCase()}.collector.invalid/${AWS_KEY}`;
    expect(await streamDownload(url, file)).toMatchObject({ ok: false, error: expect.stringContaining('aws-access-key') });
    expect(await fetchMediaBytes(url)).toMatchObject({ ok: false, error: expect.stringContaining('aws-access-key') });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('a redirect is read for this machine\'s own values only: a server\'s signed token passes, a live value does not', async () => {
    const part = (text) => Buffer.from(text).toString('base64url');
    const token = [part('{"alg":"HS256","typ":"JWT"}'), part('{"sub":"release-asset"}'), 's'.repeat(43)].join('.');
    const signed = `https://assets.example.com/file.zip?jwt=${token}`;
    expect(screenWebEgress('the download address', signed).ok).toBe(false);
    expect(screenWebEgress('the download address', signed, { redirect: true }).ok).toBe(true);
    const live = ['live', 'Value', 'x7Qp2', 'Lm9Zk4', 'Rt6Wy1', 'Bn3'].join('');
    process.env.PROBE_EGRESS_API_KEY = live;
    try {
      const spelled = live.toUpperCase().match(/.{1,4}/g).join('-');
      const refused = screenWebEgress('the download address', `https://collector.example/${spelled}`, { redirect: true });
      expect(refused.ok).toBe(false);
      expect(refused.reason).toContain('PROBE_EGRESS_API_KEY');
      expect(refused.reason.toLowerCase()).not.toContain(live.toLowerCase());
    } finally {
      delete process.env.PROBE_EGRESS_API_KEY;
    }
  });
});
