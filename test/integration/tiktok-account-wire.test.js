/**
 * The TIKTOK window's account view on the real wire (integration, RULE 0 —
 * no mocks).
 *
 * WHAT THE LOCAL SERVER STANDS IN FOR (test/helpers/tiktok-stand-in.js): one
 * real HTTP server on 127.0.0.1 plays TikTok's Open API host — the token
 * endpoint, `/v2/user/info/` (answering only the fields asked for, and
 * refusing a field whose scope was not granted, as TikTok does) and
 * `/v2/video/list/` (one raw 19-digit id) — and TikTok's picture CDN (plus
 * the ways a CDN must not answer: SVG, a page, an oversized body, a redirect
 * off the CDN). It is NOT TikTok: whether TikTok grants these permissions to
 * the company's app and answers these fields is proven only by
 * `scripts/tiktok-profile-verify.mjs` with the operator's own connected app.
 *
 * Everything else is real: the routes behind a real signed-wallet session,
 * the house's real AES-256-GCM credential store on temp disk (realm
 * isolated, no real keys anywhere), the real refresh, the real loopback
 * CONNECT, the real relay fetching real bytes over HTTP.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { startTikTokStandIn, CDN_PICTURES } from '../helpers/tiktok-stand-in.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setChannelCredential, resolveChannelCredential, removeChannelCredential } from '../../backend/services/social/channel-credentials.js';
import { startTikTokConnect, pollTikTokConnect } from '../../backend/services/social/tiktok-connect.js';
import { runFlightTests } from '../../backend/services/social/flight-test.js';
import { VIDEO_FIELDS } from '../../backend/services/social/tiktok-profile-view.js';
import { relayedImage } from '../../frontend/utils/tiktok-account-view.js';
import router from '../../backend/routes/social-channel-routes.js';

const ENV = ['NEUMA_TIKTOK_API_ROOT', 'NEUMA_TIKTOK_CDN_ROOT', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_ACCESS_EXPIRES_AT', 'TIKTOK_GRANTED_SCOPE'];
const POSTING = 'user.info.basic,video.publish,video.upload';
const ALL = 'user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload';
const CLIENT = Object.freeze({ clientKey: 'awkey', clientSecret: 'stand-in-secret' });
const OLD_WORDS = 'Posting works. To see the profile details, the counts and the recent videos, TikTok needs new permissions: '
  + 'press RECONNECT in Settings → API → Channel keys → TikTok and allow every permission';

let tiktok; let saved; let priorRealm; let app; let operator; let stranger;

const legs = (leg) => tiktok.state.hits.filter((h) => h.leg === leg);
const profile = (who = operator) => request(app).get('/api/v1/social-channels/tiktok/profile').set(who.header);
const image = (src, who = operator) => request(app).get(`/api/v1/social-channels/tiktok/image?src=${encodeURIComponent(src)}`).set(who.header);
const connection = (extra = {}) => setChannelCredential(operator.address, 'tiktok', {
  ...CLIENT, refreshToken: 'refresh-1', accessToken: 'access-1',
  accessExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(), ...extra,
});

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  tiktok = await startTikTokStandIn();
  process.env.NEUMA_TIKTOK_API_ROOT = tiktok.root;
  process.env.NEUMA_TIKTOK_CDN_ROOT = tiktok.root;
  const dir = await fs.realpath(await createTempDir('tiktok-account'));
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(dir, 'legacy-credentials.json');
  priorRealm = getRealmRoot();
  setRealmRoot(path.join(dir, 'realm'));
  const a = await fullAuth();
  const b = await fullAuth();
  operator = { address: a.address, header: { Authorization: `Bearer ${a.token}` } };
  stranger = { address: b.address, header: { Authorization: `Bearer ${b.token}` } };
  app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', router);
});

afterAll(async () => {
  setRealmRoot(priorRealm);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await tiktok.close();
});

beforeEach(async () => {
  tiktok.reset();
  await removeChannelCredential(operator.address, 'tiktok');
});

describe('the account view reads the house\'s own TikTok account, fresh on every read', () => {
  test('every permission granted: the profile, the four counts, the recent videos (ids exact), behind the session only', async () => {
    await connection({ grantedScope: ALL });
    expect((await request(app).get('/api/v1/social-channels/tiktok/profile')).status).toBe(401);
    const res = await profile();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toMatchObject({
      ok: true, missing: [], reconnect: null, hasMore: false, videosError: null,
      account: {
        id: 'open-1', displayName: 'Deus Neuma', username: 'deusneuma', bio: 'Sovereign relationships with AI.', verified: true,
        avatarUrl: `${tiktok.root}/cdn/avatar.jpg`, profileUrl: 'https://www.tiktok.com/@deusneuma',
        counts: { followers: 12345, following: 12, likes: 1500000, videos: 3 },
      },
    });
    expect(res.body.videos.map((v) => v.id)).toEqual(['7300000000000000003', '7300000000000000002', '7300000000000000001']);
    expect(res.body.videos[0]).toEqual({
      id: '7300000000000000003', caption: 'Forge night', postedAt: '2025-10-23T06:13:20.000Z', durationSec: 15,
      coverUrl: `${tiktok.root}/cdn/cover-3.webp`, shareUrl: 'https://www.tiktok.com/@deusneuma/video/7300000000000000003',
      counts: { views: 2000, likes: 150, comments: 12, shares: 3 },
    });
    expect(res.body.videos[1].caption).toBe('Second light');

    const [user] = legs('user');
    expect(user.auth).toBe('Bearer access-1');
    expect(user.fields.split(',')).toEqual(expect.arrayContaining(['username', 'bio_description', 'is_verified', 'profile_web_link', 'follower_count', 'video_count']));
    const [videos] = legs('videos');
    expect(videos).toMatchObject({ auth: 'Bearer access-1', fields: VIDEO_FIELDS.join(','), body: { max_count: 20 } });
    expect(JSON.stringify(res.body)).not.toMatch(/access-1|refresh-1|stand-in-secret/);

    // A REFRESH is a new read, never a cached answer.
    await profile();
    expect(legs('user')).toHaveLength(2);
  });

  test('a house with no TikTok connection is told so; another house never reads this one', async () => {
    await connection({ grantedScope: ALL });
    const res = await profile(stranger);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/^TikTok is not connected/);
    expect(legs('user')).toHaveLength(0);
  });

  test('a connection made before the view: posting\'s grant only — the basics shown, nothing guessed, RECONNECT said plainly', async () => {
    await connection(); // no grantedScope recorded, as every connection before this view
    const res = await profile();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      missing: ['user.info.profile', 'user.info.stats', 'video.list'], reconnect: OLD_WORDS, videos: null,
      account: { displayName: 'Deus Neuma', username: null, bio: null, verified: null, profileUrl: null,
        counts: { followers: null, following: null, likes: null, videos: null } },
    });
    expect(legs('user')[0].fields).toBe('open_id,display_name,avatar_url');
    expect(legs('videos')).toHaveLength(0);

    const flight = await runFlightTests({ fresh: true, wallet: operator.address, channels: ['tiktok'] });
    expect(flight.tiktok).toMatchObject({ ok: true, account: { name: 'Deus Neuma' }, profileNeeds: OLD_WORDS });
  });

  test('a refresh records the grant TikTok names, and the view follows it', async () => {
    await connection({ accessExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const res = await profile();
    expect(res.body).toMatchObject({ missing: [], reconnect: null, account: { username: 'deusneuma' } });
    expect(legs('token')).toHaveLength(1);
    expect(await resolveChannelCredential(operator.address, 'tiktok')).toMatchObject({ accessToken: 'access-r1', grantedScope: ALL });
    const flight = await runFlightTests({ fresh: true, wallet: operator.address, channels: ['tiktok'] });
    expect(flight.tiktok.profileNeeds).toBeNull();
  });

  test('TikTok refuses a field the record says was granted (taken back in the app): RECONNECT in words, never a post refusal', async () => {
    await connection({ grantedScope: ALL });
    tiktok.state.grantedScope = POSTING;
    const res = await profile();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(OLD_WORDS);
  });

  test('the video list refused while the profile reads: the profile stands, the videos say why', async () => {
    await connection({ grantedScope: ALL });
    tiktok.state.videoCode = 'rate_limit_exceeded';
    const res = await profile();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ account: { username: 'deusneuma' }, videos: null, videosError: 'TikTok asked to slow down; press REFRESH in a minute' });
  });
});

describe('CONNECT asks for all six; a person may allow only some', () => {
  test('posting and the profile allowed, counts and videos declined: connected, the grant recorded, the view says what is missing', async () => {
    await setChannelCredential(operator.address, 'tiktok', CLIENT);
    tiktok.state.grantedScope = `${POSTING},user.info.profile`;
    const started = await startTikTokConnect(operator.address);
    const auth = new URL(started.authUrl);
    expect(auth.searchParams.get('scope').split(',').sort()).toEqual(ALL.split(',').sort());
    await fetch(`${auth.searchParams.get('redirect_uri')}?${new URLSearchParams({ code: 'c', state: auth.searchParams.get('state') })}`);
    let done = pollTikTokConnect(operator.address);
    for (let i = 0; i < 100 && done.status === 'pending'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      done = pollTikTokConnect(operator.address);
    }
    expect(done).toEqual({ status: 'complete', channel: { id: 'open-1', title: 'Deus Neuma' } });
    expect((await resolveChannelCredential(operator.address, 'tiktok')).grantedScope).toBe(`${POSTING},user.info.profile`);

    const res = await profile();
    expect(res.body).toMatchObject({
      missing: ['user.info.stats', 'video.list'], videos: null,
      account: { username: 'deusneuma', verified: true, counts: { followers: null } },
    });
    expect(res.body.reconnect).toMatch(/^Posting works\. To see the counts and the recent videos, TikTok needs new permissions/);
  });
});

describe('the picture relay: TikTok\'s pictures and nothing else', () => {
  test('the avatar the view names travels the relay: the exact bytes, its type, nothing of the person sent on', async () => {
    await connection({ grantedScope: ALL });
    const { body } = await profile();
    expect((await request(app).get(relayedImage(body.account.avatarUrl))).status).toBe(401);
    const res = await request(app).get(relayedImage(body.account.avatarUrl)).set(operator.header).set('Cookie', 'session=secret-cookie')
      .buffer(true).parse((r, cb) => { const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => cb(null, Buffer.concat(parts))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(Buffer.compare(res.body, CDN_PICTURES['avatar.jpg'].bytes)).toBe(0);
    expect(legs('cdn')).toEqual([{ leg: 'cdn', name: 'avatar.jpg', cookie: null, authorization: null, referer: null }]);

    const cover = await image(body.videos[0].coverUrl);
    expect(cover.status).toBe(200);
    expect(cover.headers['content-type']).toBe('image/webp');
  });

  test('refused before any fetch: a host off TikTok\'s CDN, plain http elsewhere, another port, no source', async () => {
    const otherPort = `http://127.0.0.1:${Number(new URL(tiktok.root).port) + 1}/cdn/avatar.jpg`;
    for (const src of ['https://example.com/a.jpg', 'http://p16-sign-va.tiktokcdn.com/a.jpeg', otherPort, 'file:///etc/passwd', '']) {
      const res = await image(src);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('not a TikTok picture');
    }
    expect(legs('cdn')).toHaveLength(0);
  });

  test('refused after the answer: SVG, a page, a body past 4 MB, a redirect off the CDN; a redirect on it is followed', async () => {
    expect(await image(`${tiktok.root}/cdn/evil.svg`).then((r) => [r.status, r.body.error])).toEqual([502, 'TikTok answered something other than a picture']);
    expect(await image(`${tiktok.root}/cdn/page.html`).then((r) => [r.status, r.body.error])).toEqual([502, 'TikTok answered something other than a picture']);
    expect(await image(`${tiktok.root}/cdn/big.jpg`).then((r) => [r.status, r.body.error])).toEqual([502, 'the picture is larger than 4 MB']);
    expect(await image(`${tiktok.root}/cdn/nowhere.jpg`).then((r) => r.status)).toBe(502);
    expect(await image(`${tiktok.root}/cdn/away`).then((r) => [r.status, r.body.error])).toEqual([400, 'not a TikTok picture']);
    const moved = await image(`${tiktok.root}/cdn/moved`);
    expect(moved.status).toBe(200);
    expect(moved.headers['content-type']).toBe('image/jpeg');
    expect(legs('cdn').map((h) => h.name)).toEqual(['evil.svg', 'page.html', 'big.jpg', 'nowhere.jpg', 'away', 'moved', 'avatar.jpg']);
  });
});
