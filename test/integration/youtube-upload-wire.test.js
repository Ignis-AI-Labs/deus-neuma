/**
 * YouTube upload on the real wire (integration, RULE 0 — no mocks).
 *
 * WHAT THE LOCAL SERVER STANDS IN FOR: one real HTTP server on 127.0.0.1
 * plays Google's token endpoint (refresh grant), the resumable upload
 * endpoint `www.googleapis.com/upload/youtube/v3/videos` (session start and
 * the session's chunk PUTs, answering 308 + Range exactly as the resumable
 * protocol documents), and the Data API reads the reconciler uses
 * (`channels`, `playlistItems`). It can also misbehave the ways a real
 * upload does: drop the connection mid-chunk, answer 503, or keep only part
 * of a chunk. It is NOT YouTube: that YouTube accepts this resource and
 * flags the video as altered/synthetic is proven only by
 * `scripts/youtube-post-verify.mjs` with the operator's own connection.
 *
 * Everything else is real: the real poster streams a real file from disk,
 * the bytes the stand-in assembles are compared to the file's own hash, and
 * the queue path runs the real store and the real scheduler tick on an
 * isolated temp queue and realm, with stand-in credentials only.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { postToYouTube } from '../../backend/services/social/youtube-poster.js';
import { setChannelCredential } from '../../backend/services/social/channel-credentials.js';

const CREDS = Object.freeze({ clientId: 'cid', clientSecret: 'stand-in-secret', refreshToken: 'refresh-1' });
const CHUNK = 256 * 1024;
const ENV = ['NEUMA_GOOGLE_TOKEN_URL', 'NEUMA_YOUTUBE_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH',
  'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'];

let server;
let root;
let saved;
let priorRealm;
let dir;
let videoPath;
let videoBytes;
let hits;
let faults; // chunk index → 'drop' | '503' | 'partial'
let initMode; // 'ok' | 'quota'
let tokenMode; // 'ok' | 'revoked'
let sessions;
let uploads; // what playlistItems answers

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
};

// The session's half of the resumable protocol.
const onSessionPut = async (req, res, session) => {
  const range = String(req.headers['content-range'] || '');
  const probe = /^bytes \*\/(\d+)$/.exec(range);
  if (probe) {
    const body = await readBody(req);
    hits.push({ leg: 'probe', range, contentLength: req.headers['content-length'], bodyBytes: body.length });
    if (session.done) return json(res, 200, session.video);
    return session.bytes
      ? (res.writeHead(308, { Range: `bytes=0-${session.bytes - 1}` }), res.end())
      : (res.writeHead(308), res.end());
  }
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
  const index = session.chunks;
  const fault = faults[index];
  if (fault === 'drop') {
    delete faults[index];
    hits.push({ leg: 'chunk', range, fault });
    // The connection dies with the chunk half-sent: YouTube keeps none of it.
    req.once('data', () => req.socket.destroy());
    return undefined;
  }
  const body = await readBody(req);
  hits.push({ leg: 'chunk', range, contentType: req.headers['content-type'], bytes: body.length, fault: fault || null });
  if (!m || Number(m[1]) !== session.bytes || Number(m[2]) - Number(m[1]) + 1 !== body.length || Number(m[3]) !== session.total) {
    return json(res, 400, { error: { message: `bad Content-Range ${range} at ${session.bytes}` } });
  }
  if (fault === '503') { delete faults[index]; return json(res, 503, { error: { message: 'Backend Error' } }); }
  const kept = fault === 'partial' ? body.subarray(0, Math.floor(body.length / 2)) : body;
  if (fault === 'partial') delete faults[index];
  session.parts.push(kept);
  session.bytes += kept.length;
  session.chunks += 1;
  if (session.bytes === session.total) {
    session.done = true;
    session.video = {
      id: 'vid-001',
      snippet: { ...session.resource.snippet, channelId: 'UC-house', channelTitle: 'Deus Neuma' },
      status: { ...session.resource.status, uploadStatus: 'uploaded' },
    };
    return json(res, 200, session.video);
  }
  res.writeHead(308, { Range: `bytes=0-${session.bytes - 1}` });
  return res.end();
};

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://stand-in');
    if (url.pathname === '/token') {
      const form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString('utf8')));
      hits.push({ leg: 'token', form });
      return tokenMode === 'revoked'
        ? json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
        : json(res, 200, { access_token: 'access-refreshed', expires_in: 3599, token_type: 'Bearer' });
    }
    if (url.pathname === '/upload/youtube/v3/videos' && req.method === 'POST') {
      const raw = (await readBody(req)).toString('utf8');
      hits.push({
        leg: 'init',
        query: Object.fromEntries(url.searchParams),
        auth: req.headers.authorization,
        contentType: req.headers['content-type'],
        uploadLength: req.headers['x-upload-content-length'],
        uploadType: req.headers['x-upload-content-type'],
        resource: JSON.parse(raw),
      });
      if (initMode === 'quota') {
        return json(res, 403, { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } });
      }
      const id = crypto.randomBytes(6).toString('hex');
      sessions.set(id, {
        total: Number(req.headers['x-upload-content-length']), resource: JSON.parse(raw), parts: [], bytes: 0, chunks: 0, done: false,
      });
      res.writeHead(200, { Location: `${root}/upload/youtube/v3/videos?uploadType=resumable&upload_id=${id}` });
      return res.end();
    }
    if (url.pathname === '/upload/youtube/v3/videos' && req.method === 'PUT') {
      const session = sessions.get(url.searchParams.get('upload_id'));
      if (!session) return json(res, 404, { error: { message: 'no such session' } });
      return onSessionPut(req, res, session);
    }
    if (url.pathname === '/youtube/v3/channels') {
      return json(res, 200, { items: [{ id: 'UC-house', contentDetails: { relatedPlaylists: { uploads: 'UU-house' } } }] });
    }
    if (url.pathname === '/youtube/v3/playlistItems') {
      hits.push({ leg: 'playlistItems', query: Object.fromEntries(url.searchParams) });
      return json(res, 200, { items: uploads });
    }
    return json(res, 404, { error: { message: 'not found' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  root = `http://127.0.0.1:${server.address().port}`;
  process.env.NEUMA_GOOGLE_TOKEN_URL = `${root}/token`;
  process.env.NEUMA_YOUTUBE_API_ROOT = root;

  dir = await fs.realpath(await createTempDir('youtube-upload'));
  priorRealm = getRealmRoot();
  setRealmRoot(path.join(dir, 'realm'));
  // A real file whose head says MP4: ~700KB, three 256KiB chunks.
  videoBytes = Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom', 'latin1'), crypto.randomBytes(700_000 - 12),
  ]);
  videoPath = path.join(dir, 'clip.mp4');
  await fs.writeFile(videoPath, videoBytes);
});

afterAll(async () => {
  setRealmRoot(priorRealm);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  hits = [];
  faults = {};
  initMode = 'ok';
  tokenMode = 'ok';
  sessions = new Map();
  uploads = [];
});

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const assembled = () => sha(Buffer.concat([...sessions.values()][0].parts));
const TEXT = 'Forge night #3\nA walk through the armillary.\nprivacy: private\ntags: armillary, ai art';
const post = (opts = {}) => postToYouTube(CREDS, TEXT, { media: [{ path: videoPath }], chunkBytes: CHUNK, baseDelayMs: 5, ...opts });

describe('the resumable upload protocol', () => {
  test('a clean upload: refresh → session (metadata + disclosure) → three chunks → the video', async () => {
    const out = await post();
    expect(out).toEqual({
      ok: true, id: 'vid-001', text: 'Forge night #3', url: 'https://www.youtube.com/watch?v=vid-001',
      postedAs: { id: 'UC-house', username: 'Deus Neuma' },
    });
    const [token, init, ...chunks] = hits;
    expect(token.form).toEqual({ client_id: 'cid', client_secret: 'stand-in-secret', refresh_token: 'refresh-1', grant_type: 'refresh_token' });
    expect(init).toMatchObject({
      query: { uploadType: 'resumable', part: 'snippet,status' },
      auth: 'Bearer access-refreshed',
      contentType: 'application/json; charset=UTF-8',
      uploadLength: String(videoBytes.length),
      uploadType: 'video/mp4',
    });
    expect(init.resource).toEqual({
      snippet: { title: 'Forge night #3', description: 'A walk through the armillary.', tags: ['armillary', 'ai art'] },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    });
    expect(chunks.map((c) => c.range)).toEqual([
      `bytes 0-${CHUNK - 1}/700000`, `bytes ${CHUNK}-${2 * CHUNK - 1}/700000`, `bytes ${2 * CHUNK}-699999/700000`,
    ]);
    expect(chunks.every((c) => c.contentType === 'video/mp4')).toBe(true);
    expect(assembled()).toBe(sha(videoBytes));
  });

  test('a connection dropped mid-chunk: the poster asks where the upload stands and resumes — no byte twice', async () => {
    faults[1] = 'drop';
    const out = await post();
    expect(out.ok).toBe(true);
    const legs = hits.filter((h) => h.leg === 'chunk' || h.leg === 'probe');
    expect(legs.map((h) => (h.leg === 'probe' ? 'probe' : h.range))).toEqual([
      `bytes 0-${CHUNK - 1}/700000`,
      `bytes ${CHUNK}-${2 * CHUNK - 1}/700000`, // dropped
      'probe',
      `bytes ${CHUNK}-${2 * CHUNK - 1}/700000`, // resent from the byte YouTube lacked
      `bytes ${2 * CHUNK}-699999/700000`,
    ]);
    const probe = hits.find((h) => h.leg === 'probe');
    expect(probe).toMatchObject({ range: 'bytes */700000', contentLength: '0', bodyBytes: 0 });
    expect(assembled()).toBe(sha(videoBytes));
  });

  test('a 503 mid-upload and a chunk only half kept: both resume from the Range YouTube names', async () => {
    faults[0] = 'partial';
    faults[2] = '503';
    const out = await post();
    expect(out.ok).toBe(true);
    const ranges = hits.filter((h) => h.leg === 'chunk').map((h) => h.range);
    expect(ranges[1]).toBe(`bytes ${CHUNK / 2}-${CHUNK / 2 + CHUNK - 1}/700000`);
    expect(hits.some((h) => h.leg === 'probe')).toBe(true);
    expect(assembled()).toBe(sha(videoBytes));
  });

  test('refusals in plain words: quota spent, token revoked, no video, not a video', async () => {
    initMode = 'quota';
    const quota = await post();
    expect(quota.ok).toBe(false);
    expect(quota.detail).toMatch(/daily quota.*nothing was published/);
    expect(sessions.size).toBe(0);

    tokenMode = 'revoked';
    hits = [];
    const revoked = await post();
    expect(revoked.detail).toMatch(/revoked or has expired; reconnect YouTube/);
    expect(hits.map((h) => h.leg)).toEqual(['token']);

    hits = [];
    expect((await postToYouTube(CREDS, TEXT, { media: [] })).detail).toMatch(/videos only/);
    const png = path.join(dir, 'still.mp4');
    await fs.writeFile(png, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6]));
    expect((await postToYouTube(CREDS, TEXT, { media: [{ path: png }] })).detail).toMatch(/not an MP4, MOV or WebM video, whatever the name says/);
    expect((await postToYouTube(null, TEXT, { media: [{ path: videoPath }] })).detail).toMatch(/YouTube credentials are not configured/);
    expect(hits).toEqual([]);
  });
});

describe('through the real queue and the real scheduler (isolated temp queue + realm)', () => {
  const seat = async () => {
    const house = await useServedHouse({ lanes: ['yt-holder'] });
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(dir, `queue-${crypto.randomBytes(4).toString('hex')}.json`);
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(dir, 'bindings.json');
    await fs.writeFile(process.env.NEUMA_SOCIAL_BINDINGS_PATH, JSON.stringify({
      youtube: { neumaId: 'yt-holder', boundBy: SERVED_WALLET, boundAt: new Date().toISOString() },
    }));
    await setChannelCredential(SERVED_WALLET, 'youtube', CREDS);
    const { postQueue } = await import('../../backend/services/social/post-queue.js');
    const { schedulerTick } = await import('../../backend/services/social/post-scheduler.js');
    return { house, postQueue, schedulerTick };
  };

  test('a text-only YouTube draft never enters the queue', async () => {
    const { house, postQueue } = await seat();
    await expect(postQueue.add({ channelId: 'youtube', text: 'Just words', queuedBy: 'yt-holder', authorNeumaId: 'yt-holder' }))
      .rejects.toThrow(/text-only post cannot go to YouTube/);
    house.restore();
  });

  test('draft → the operator\'s approval → the tick uploads it and the record names the video', async () => {
    const { house, postQueue, schedulerTick } = await seat();
    const e = await postQueue.add({
      channelId: 'youtube', text: TEXT, media: [{ path: videoPath, alt: '' }],
      scheduledFor: new Date(Date.now() - 60_000).toISOString(), queuedBy: 'yt-holder', authorNeumaId: 'yt-holder',
    });
    // A draft is never sent: nothing moves before the operator decides.
    await schedulerTick(Date.now());
    expect(hits.some((h) => h.leg === 'init')).toBe(false);
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });
    await schedulerTick(Date.now()).finally(house.restore);
    const [after] = await postQueue.load();
    expect(after).toMatchObject({ status: 'sent', postId: 'vid-001', postedAs: { id: 'UC-house', username: 'Deus Neuma' } });
    expect(hits.find((h) => h.leg === 'init').resource.status.containsSyntheticMedia).toBe(true);
    expect(assembled()).toBe(sha(videoBytes));
  });

  test('a send lost mid-flight is settled against the CHANNEL\'s own uploads, never another platform\'s', async () => {
    const { house, postQueue, schedulerTick } = await seat();
    const staged = async (text) => {
      const e = await postQueue.add({ channelId: 'youtube', text, media: [{ path: videoPath }], queuedBy: 'yt-holder', authorNeumaId: 'yt-holder' });
      await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });
      await postQueue.claimForSend(e.id);
      return e.id;
    };
    const wentOut = await staged('It went out\nbody');
    const neverDid = await staged('It never did\nbody');
    // Both claims are seven hours old: past the YouTube lease, the process "died".
    const file = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const entries = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify(entries.map((x) => ({ ...x, sendingAt: old }))));
    uploads = [{ snippet: { title: 'It went out', publishedAt: new Date().toISOString(), resourceId: { videoId: 'vid-live' } } }];
    await schedulerTick(Date.now()).finally(house.restore);
    const byId = Object.fromEntries((await postQueue.load()).map((x) => [x.id, x]));
    expect(byId[wentOut]).toMatchObject({ status: 'sent', postId: 'vid-live' });
    expect(byId[neverDid].status).toBe('failed');
    expect(byId[neverDid].error).toMatch(/NOT on the channel/);
    expect(hits.find((h) => h.leg === 'playlistItems').query.playlistId).toBe('UU-house');
    expect(hits.some((h) => h.leg === 'init')).toBe(false); // settled, never re-sent
  });
});
