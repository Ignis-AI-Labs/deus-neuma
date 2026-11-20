// An X post carries a video: the chunked upload over a real connection, and the stage-time rules.
//
// 2026-11-14: a 39.6MB launch video could not ride an X post, because the only X upload was the
// single-request one for stills (5MB). A real loopback HTTP server stands in for X behind the
// NEUMA_X_API_ROOT door and speaks the chunked protocol as docs.x.com gives it (initialize, append,
// finalize, STATUS); it keeps every byte it is sent, so the test checks the file arrived whole.
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { createTempDir } from '../helpers/temp-fs.js';
import { uploadVideo, X_VIDEO_SEGMENT_BYTES } from '../../backend/services/social/x-video.js';
import { readXMedia, uploadXMedia, xMediaMixRefusal } from '../../backend/services/social/x-post-media.js';
import { readVideoHead } from '../../backend/services/social/video-media.js';
import { resolvePostMedia } from '../../backend/services/social/post-media.js';

const credentials = { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'ts' };
const FAST = { retryWaitsMs: [10, 10], pollFloorMs: 5 };
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(20)]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// the file part of a multipart body, and its text fields
const parts = (body, type) => {
  const boundary = Buffer.from(`--${/boundary=(.+)$/.exec(type)[1]}`);
  const fields = {}; let file = null;
  for (let at = body.indexOf(boundary); at >= 0;) {
    const next = body.indexOf(boundary, at + boundary.length);
    if (next < 0) break;
    const part = body.subarray(at + boundary.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('latin1');
    const name = /name="([^"]+)"/.exec(head)[1];
    if (/filename=/.test(head)) file = part.subarray(split + 4); else fields[name] = part.subarray(split + 4).toString();
    at = next;
  }
  return { fields, file };
};

let server, ground, video, bytes;
let x; // the stand-in's state for one upload

beforeAll(async () => {
  ground = await createTempDir('x-video');
  // two full segments and a part of a third, so the pieces and their order are really exercised
  bytes = Buffer.concat([MP4_HEAD, crypto.randomBytes(X_VIDEO_SEGMENT_BYTES * 2 + 12345)]);
  video = path.join(ground, 'launch.mp4');
  await fs.writeFile(video, bytes);
  await fs.writeFile(path.join(ground, 'second.mp4'), MP4_HEAD);
  await fs.writeFile(path.join(ground, 'card.png'), PNG);
  await fs.writeFile(path.join(ground, 'notes.mp4'), 'words wearing a video name');

  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks); const url = new URL(req.url, 'http://x');
      const plan = x.plan[x.requests.length] ?? 'ok';
      x.requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization });
      if (plan === 'drop') { req.socket.destroy(); return; }
      const send = (status, json) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(json)); };
      if (typeof plan === 'number') return send(plan, { detail: plan === 400 ? 'media type unrecognized' : 'Service Unavailable' });
      if (req.method === 'POST' && url.pathname === '/2/media/upload/initialize') { x.init = JSON.parse(body); return send(200, { data: { id: '777', expires_after_secs: 86400 } }); }
      if (req.method === 'POST' && url.pathname === '/2/media/upload/777/append') {
        const { fields, file } = parts(body, req.headers['content-type']);
        x.segments[Number(fields.segment_index)] = file;
        return send(200, { data: { expires_at: 1 } });
      }
      const processing = () => { const state = x.states.shift(); return state ? { processing_info: { state, check_after_secs: 0, ...(state === 'failed' ? { error: { message: 'unsupported codec' } } : {}) } } : {}; };
      if (req.method === 'POST' && url.pathname === '/2/media/upload/777/finalize') return send(200, { data: { id: '777', ...processing() } });
      if (req.method === 'GET' && url.pathname === '/2/media/upload' && url.searchParams.get('command') === 'STATUS' && url.searchParams.get('media_id') === '777') return send(200, { data: { id: '777', ...processing() } });
      return send(404, { detail: `no such door: ${req.method} ${url.pathname}` });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${server.address().port}/2`;
});

afterAll(async () => {
  delete process.env.NEUMA_X_API_ROOT;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => { x = { plan: [], requests: [], segments: [], states: [], init: null }; });

const send = async () => uploadVideo(credentials, await readVideoHead(video), FAST);

describe('a video goes to X in pieces and arrives whole', () => {
  test('initialize names it, the parts arrive in order, and the bytes X holds are the file', async () => {
    x.states = ['pending', 'in_progress', 'succeeded'];
    expect(await send()).toEqual({ ok: true, mediaId: '777' });
    expect(x.init).toEqual({ media_type: 'video/mp4', total_bytes: bytes.length, media_category: 'tweet_video' });
    expect(x.segments.map((s) => s.length)).toEqual([X_VIDEO_SEGMENT_BYTES, X_VIDEO_SEGMENT_BYTES, bytes.length - 2 * X_VIDEO_SEGMENT_BYTES]);
    expect(sha(Buffer.concat(x.segments))).toBe(sha(bytes));
    // one initialize, three parts, one finalize, then asked until processing succeeded
    expect(x.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /2/media/upload/initialize', 'POST /2/media/upload/777/append', 'POST /2/media/upload/777/append',
      'POST /2/media/upload/777/append', 'POST /2/media/upload/777/finalize', 'GET /2/media/upload', 'GET /2/media/upload',
    ]);
    expect(x.requests.every((r) => /^OAuth .*oauth_signature="/.test(r.auth))).toBe(true);
  });

  test('a video X needs no time to process is ready at finalize', async () => {
    expect(await send()).toEqual({ ok: true, mediaId: '777' });
    expect(x.requests).toHaveLength(5);
  });

  test('a connection dropped mid-part is asked again, and the file still arrives whole', async () => {
    x.plan = ['ok', 'ok', 'drop', 503];
    expect(await send()).toEqual({ ok: true, mediaId: '777' });
    expect(sha(Buffer.concat(x.segments))).toBe(sha(bytes));
  });

  test("X's refusal is final and keeps its words", async () => {
    x.plan = [400];
    expect(await send()).toEqual({ ok: false, status: 400, detail: 'X did not open the upload: media type unrecognized' });
    expect(x.requests).toHaveLength(1);
  });

  test('a video X cannot process is reported with its reason, never named on a post', async () => {
    x.states = ['pending', 'failed'];
    expect(await send()).toEqual({ ok: false, detail: 'X could not process the video: unsupported codec' });
  });

  test('processing that never ends is given up at the limit', async () => {
    x.states = Array(50).fill('in_progress');
    const result = await uploadVideo(credentials, await readVideoHead(video), { ...FAST, processingMaxMs: 40 });
    expect(result).toEqual({ ok: false, detail: 'X was still processing the video after 0 minutes' });
  });
});

describe('one door for a post\'s file: a still or a video, by its bytes', () => {
  test('a video is known by its head and a still by its own', async () => {
    expect(await readXMedia(video)).toMatchObject({ ok: true, kind: 'video', contentType: 'video/mp4', size: bytes.length });
    expect(await readXMedia(path.join(ground, 'card.png'))).toMatchObject({ ok: true, kind: 'image', contentType: 'image/png' });
    expect((await readXMedia(path.join(ground, 'notes.mp4'))).ok).toBe(false);
  });

  test('the same door uploads either kind', async () => {
    expect(await uploadXMedia(credentials, path.join(ground, 'second.mp4'))).toEqual({ ok: true, mediaId: '777', kind: 'video' });
    expect(await uploadXMedia(credentials, path.join(ground, 'notes.mp4'))).toMatchObject({ ok: false, refused: true });
  });

  test('up to four stills, or one video on its own', () => {
    expect(xMediaMixRefusal(['image', 'image', 'image', 'image'])).toBeNull();
    expect(xMediaMixRefusal(['video'])).toBeNull();
    expect(xMediaMixRefusal(['video', 'image'])).toBe('an X post carries a video on its own, not beside images');
    expect(xMediaMixRefusal(['video', 'video'])).toBe('an X post carries one video at most');
  });
});

describe('staging: an X post may carry one video', () => {
  const connection = () => ({ _grantedReadRoots: [ground] });

  test('a video stages for X', async () => {
    expect(await resolvePostMedia(connection(), [{ path: video, alt: 'the launch film' }], { channelId: 'x' }))
      .toEqual({ ok: true, media: [{ path: video, alt: 'the launch film' }] });
  });

  test('a video beside an image, or two videos, is refused at stage time', async () => {
    const mixed = await resolvePostMedia(connection(), [{ path: video }, { path: path.join(ground, 'card.png') }], { channelId: 'x' });
    expect(mixed).toEqual({ ok: false, detail: 'an X post carries a video on its own, not beside images' });
    const two = await resolvePostMedia(connection(), [{ path: video }, { path: path.join(ground, 'second.mp4') }], { channelId: 'x' });
    expect(two).toEqual({ ok: false, detail: 'an X post carries one video at most' });
  });

  test('a channel that takes stills only still refuses a video', async () => {
    expect((await resolvePostMedia(connection(), [{ path: video }], { channelId: 'telegram' })).ok).toBe(false);
  });
});
