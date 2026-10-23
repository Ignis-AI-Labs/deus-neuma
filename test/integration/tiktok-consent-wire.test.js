/**
 * A TikTok Direct Post is approved with the person's own choices, and the
 * scheduler sends EXACTLY those (integration, RULE 0 — no mocks). TikTok's
 * Content Sharing Guidelines (read 2026-10-23): the card reads creator info
 * as it renders, privacy has no default, interactions start off and an
 * account-disabled one cannot be turned on, a disclosure names its kind,
 * branded content is never private, and content is sent only after express
 * consent.
 *
 * WHAT THE LOCAL SERVER STANDS IN FOR (test/helpers/tiktok-stand-in.js): one
 * real HTTP server on 127.0.0.1 playing TikTok's Open API (creator info, the
 * Direct Post and inbox init, the chunk PUTs, the status fetch). It is NOT
 * TikTok: that TikTok accepts these settings and shows them on the post is
 * proven only by `scripts/tiktok-post-verify.mjs` with Founder's own app.
 *
 * Everything else is the real thing: the real social router behind a real
 * signed-wallet session, the real post queue and the real scheduler tick on
 * an isolated temp queue, realm and house (stand-in credentials only, every
 * TIKTOK_* env key cleared), a real MP4-shaped file on disk. No entry is
 * seeded `approved`: each is staged a draft and approved through the route.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { useServedHouse } from '../helpers/served-house.js';
import { startTikTokStandIn, mp4Bytes } from '../helpers/tiktok-stand-in.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setChannelCredential } from '../../backend/services/social/channel-credentials.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { schedulerTick } from '../../backend/services/social/post-scheduler.js';
import router from '../../backend/routes/social-channel-routes.js';

const ENV = ['NEUMA_TIKTOK_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_ACCESS_EXPIRES_AT'];
const TEXT = 'Forge night — the armillary #aiart\nprivacy: everyone\nallow: comments';

let tiktok; let saved; let priorRealm; let dir; let videoPath; let app;
let operator; let stranger; let house;

const legs = (leg) => tiktok.state.hits.filter((h) => h.leg === leg);
const stage = (text = TEXT) => postQueue.add({
  channelId: 'tiktok', text, media: [{ path: videoPath, alt: '' }], queuedBy: 'tt-holder', authorNeumaId: 'tt-holder',
});
const approve = (entry, body, who = operator) => request(app)
  .put(`/api/v1/social-channels/queue/${entry.id}/approve`).set(who.header).send({ textSeen: entry.text, ...body });
const statusOf = async (id) => (await postQueue.load()).find((e) => e.id === id);
const CHOICE = Object.freeze({
  privacyLevel: 'FOLLOWER_OF_CREATOR',
  allow: { comment: true, duet: true, stitch: false },
  commercial: { on: true, yourBrand: true, branded: true },
});

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  tiktok = await startTikTokStandIn();
  process.env.NEUMA_TIKTOK_API_ROOT = tiktok.root;
  dir = await fs.realpath(await createTempDir('tiktok-consent'));
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(dir, 'legacy-credentials.json');
  priorRealm = getRealmRoot();
  setRealmRoot(path.join(dir, 'realm'));
  videoPath = path.join(dir, 'clip.mp4');
  await fs.writeFile(videoPath, mp4Bytes(12, 2_000_000));
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
  tiktok.state.processingReads = 0;
  house = await useServedHouse({ wallet: operator.address, lanes: ['tt-holder'] });
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(dir, `queue-${crypto.randomBytes(4).toString('hex')}.json`);
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(dir, 'bindings.json');
  await fs.writeFile(process.env.NEUMA_SOCIAL_BINDINGS_PATH, JSON.stringify({
    tiktok: { neumaId: 'tt-holder', boundBy: operator.address, boundAt: new Date().toISOString() },
  }));
  await setChannelCredential(operator.address, 'tiktok', {
    clientKey: 'awkey', clientSecret: 'stand-in-secret', refreshToken: 'refresh-1',
    accessToken: 'access-1', accessExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
  });
});

afterEach(() => house.restore());

describe('the card renders from creator info read now', () => {
  test('the account named, the privacy it offers, what it turned off, and the author\'s lines as suggestions only', async () => {
    const entry = await stage();
    expect((await request(app).get(`/api/v1/social-channels/queue/${entry.id}/tiktok`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/social-channels/queue/${entry.id}/tiktok`).set(stranger.header)).status).toBe(404);
    const res = await request(app).get(`/api/v1/social-channels/queue/${entry.id}/tiktok`).set(operator.header);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({
      ok: true, mode: 'post',
      creator: {
        nickname: 'Deus Neuma', username: 'deusneuma', privacyOptions: ['SELF_ONLY', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'],
        commentDisabled: false, duetDisabled: false, stitchDisabled: true, maxVideoSec: 600,
      },
      suggested: {
        privacyLevel: 'PUBLIC_TO_EVERYONE', allow: { comment: true, duet: false, stitch: false }, promotion: { ownBrand: false, paid: false },
      },
    });
    expect(legs('creator')).toEqual([{ leg: 'creator', auth: 'Bearer access-1' }]);
    expect(JSON.stringify(res.body)).not.toMatch(/access-1|refresh-1|stand-in-secret/);
  });

  test('when TikTok says the account cannot post now, the card says so, and nothing can be approved', async () => {
    const entry = await stage();
    tiktok.state.creatorCode = 'spam_risk_too_many_posts';
    const card = await request(app).get(`/api/v1/social-channels/queue/${entry.id}/tiktok`).set(operator.header);
    expect(card.status).toBe(409);
    expect(card.body.error).toMatch(/posting limit for today.*Try again tomorrow/);
    const res = await approve(entry, { tiktok: CHOICE });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/posting limit for today.*nothing was approved$/);
    expect((await statusOf(entry.id)).status).toBe('draft');
  });
});

describe('approval is impossible until the person has chosen, within what the account allows', () => {
  test('no choice, no privacy, a turned-off interaction, an empty disclosure, private branded content, a stale read: each refused, nothing approved or sent', async () => {
    const entry = await stage();
    const refusals = [
      [{}, /Choose who can watch this video: TikTok asks you to pick it yourself; nothing was approved/],
      [{ tiktok: { ...CHOICE, privacyLevel: '' } }, /Choose who can watch this video/],
      [{ tiktok: { ...CHOICE, allow: { stitch: true } } }, /This TikTok account has stitch turned off; nothing was approved/],
      [{ tiktok: { ...CHOICE, commercial: { on: true } } }, /You need to indicate if your content promotes yourself, a third party, or both\./],
      [{ tiktok: { ...CHOICE, privacyLevel: 'SELF_ONLY' } }, /Branded content visibility cannot be set to private\./],
      [{ tiktok: CHOICE, textSeen: 'an older copy' }, /changed since its card was read/],
    ];
    for (const [body, words] of refusals) {
      const res = await approve(entry, body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(words);
    }
    expect((await statusOf(entry.id)).status).toBe('draft');
    // The approve-thread door is closed to a TikTok post too.
    const thread = await request(app).put(`/api/v1/social-channels/queue/${entry.id}/approve-thread`)
      .set(operator.header).send({ textsSeen: { [entry.id]: entry.text } });
    expect(thread.status).toBe(409);
    expect(thread.body.error).toMatch(/TikTok post is no thread/);
    // And the store itself refuses a TikTok approval that carries no choices.
    expect((await postQueue.approve(entry.id, { decidedBy: operator.address, textSeen: entry.text })).error)
      .toMatch(/approved from its card/);
    await schedulerTick(Date.now());
    expect(legs('init')).toEqual([]);
  });
});

describe('the scheduler sends exactly what was approved', () => {
  test('the choices on the card reach post_info — never the draft\'s suggestion lines — with is_aigc always on', async () => {
    const entry = await stage();
    const res = await approve(entry, { tiktok: CHOICE });
    expect(res.status).toBe(200);
    expect(res.body.schedule.firesAt).toBe('next pass');
    const approved = await statusOf(entry.id);
    expect(approved.status).toBe('approved');
    expect(approved.tiktokConsent).toMatchObject({
      privacyLevel: 'FOLLOWER_OF_CREATOR',
      allow: { comment: true, duet: true, stitch: false },
      commercial: { on: true, yourBrand: true, branded: true },
      account: { username: 'deusneuma', nickname: 'Deus Neuma' },
      declaration: 'By posting, you agree to TikTok\'s Branded Content Policy and Music Usage Confirmation.',
    });
    expect(legs('init')).toEqual([]); // consent armed it; nothing left before the tick
    await schedulerTick(Date.now());
    expect(legs('init')).toHaveLength(1);
    expect(legs('init')[0].body.post_info).toEqual({
      title: 'Forge night — the armillary #aiart',
      privacy_level: 'FOLLOWER_OF_CREATOR',
      disable_comment: false, disable_duet: false, disable_stitch: true,
      brand_content_toggle: true, brand_organic_toggle: true,
      is_aigc: true,
    });
    expect((await statusOf(entry.id)).status).toBe('sent');
  });

  test('the world moved after approval — another account, a privacy no longer offered: refused at send, never adjusted', async () => {
    const one = await stage('Moved account');
    expect((await approve(one, { tiktok: { ...CHOICE, commercial: { on: false } } })).status).toBe(200);
    tiktok.state.creator.creator_username = 'someone-else';
    await schedulerTick(Date.now());
    expect(await statusOf(one.id)).toMatchObject({
      status: 'failed', error: expect.stringMatching(/now posts as @someone-else; this post was approved for @deusneuma\. Approve it again/),
    });

    tiktok.reset();
    tiktok.state.processingReads = 0;
    const two = await stage('Moved privacy');
    expect((await approve(two, { tiktok: { ...CHOICE, commercial: { on: false } } })).status).toBe(200);
    tiktok.state.creator.privacy_level_options = ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'];
    await schedulerTick(Date.now());
    expect(await statusOf(two.id)).toMatchObject({
      status: 'failed', error: expect.stringMatching(/does not offer "Followers" right now, so the post cannot go out as approved/),
    });
    expect(legs('init')).toEqual([]);
  });

  test('a draft for the TikTok inbox is approved without choices (they are made in the TikTok app) and goes as source_info only', async () => {
    const entry = await stage('Finish me in the app\nsend: drafts');
    const card = await request(app).get(`/api/v1/social-channels/queue/${entry.id}/tiktok`).set(operator.header);
    expect(card.body).toEqual({ ok: true, mode: 'drafts' });
    expect((await approve(entry, {})).status).toBe(200);
    expect((await statusOf(entry.id)).tiktokConsent).toBeNull();
    await schedulerTick(Date.now());
    expect(legs('init')[0]).toMatchObject({ mode: 'drafts', body: { source_info: { source: 'FILE_UPLOAD' } } });
    expect(legs('init')[0].body).not.toHaveProperty('post_info');
    expect((await statusOf(entry.id)).status).toBe('sent');
  });
});
