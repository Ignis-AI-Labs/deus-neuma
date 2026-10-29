/**
 * TikTok posting on the real wire (integration, RULE 0 — no mocks).
 *
 * WHAT THE LOCAL SERVER STANDS IN FOR (test/helpers/tiktok-stand-in.js): one
 * real HTTP server on 127.0.0.1 plays TikTok's Open API — creator info, the
 * Direct Post and inbox (drafts) init, the chunk PUTs at the upload URL
 * (206/201 with TikTok's Content-Range, the media transfer guide's chunk
 * rules enforced), and the status fetch. It can drop a connection
 * mid-chunk, keep a chunk and drop before answering, or answer 503. It is
 * NOT TikTok: that TikTok accepts these posts, keeps them private and shows
 * the […] tag is proven only by
 * `scripts/tiktok-post-verify.mjs` with Founder's own connected app.
 *
 * Everything else is real: the real poster streams a real MP4-shaped file
 * from disk (its moov/mvhd names its length), the bytes the stand-in
 * assembles are compared to the file's own hash, the token is read from the
 * house's real sealed store, and the queue path runs the real store and the
 * real scheduler tick on an isolated temp queue and realm with stand-in
 * credentials only. No entry is seeded `approved`: each is staged as a draft
 * and approved through the store's own decision, with the consent a card's
 * approval records (frontend/utils/tiktok-consent.js) — the post carries
 * those choices, never the draft's suggestion lines.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';
import { startTikTokStandIn, assembledUpload, mp4Bytes } from '../helpers/tiktok-stand-in.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { postToTikTok } from '../../backend/services/social/tiktok-poster.js';
import { setChannelCredential, resolveChannelCredential } from '../../backend/services/social/channel-credentials.js';
import { CHUNK_MIN_BYTES } from '../../backend/services/social/tiktok-metadata.js';
import { EMPTY_CHOICE, readChoice, creatorView, consentRecord } from '../../frontend/utils/tiktok-consent.js';

const HOUSE = SERVED_WALLET;
const SIZE = 11_500_000; // two chunks of TikTok's 5MB floor: 5MiB, then 6.25MB carrying the trailing bytes
const ENV = ['NEUMA_TIKTOK_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_ACCESS_EXPIRES_AT'];

let tiktok;
let saved;
let priorRealm;
let dir;
let videoPath;
let videoBytes;
let longPath;
let stillPath;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const legs = (leg) => tiktok.state.hits.filter((h) => h.leg === leg);
const connect = () => setChannelCredential(HOUSE, 'tiktok', {
  clientKey: 'awkey', clientSecret: 'stand-in-secret', refreshToken: 'refresh-1',
  accessToken: 'access-1', accessExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
});

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  tiktok = await startTikTokStandIn();
  process.env.NEUMA_TIKTOK_API_ROOT = tiktok.root;
  dir = await fs.realpath(await createTempDir('tiktok-upload'));
  priorRealm = getRealmRoot();
  setRealmRoot(path.join(dir, 'realm'));
  videoBytes = mp4Bytes(12, SIZE);
  videoPath = path.join(dir, 'clip.mp4');
  await fs.writeFile(videoPath, videoBytes);
  longPath = path.join(dir, 'long.mp4');
  await fs.writeFile(longPath, mp4Bytes(700, 2_000_000));
  stillPath = path.join(dir, 'still.mp4');
  await fs.writeFile(stillPath, Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), crypto.randomBytes(64)]));
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
  await connect();
});

const TEXT = 'Forge night #3 — a walk through the armillary #aiart\nallow: comments';
// What a card's approval records, for the stand-in's account as it stands now.
const consent = (patch = {}) => consentRecord(
  readChoice({ ...EMPTY_CHOICE, privacyLevel: 'SELF_ONLY', allow: { comment: true }, ...patch }), creatorView(tiktok.state.creator), new Date(),
);
const post = async (text = TEXT, opts = {}) => postToTikTok(await resolveChannelCredential(HOUSE, 'tiktok'), text, {
  media: [{ path: videoPath }], house: HOUSE, chunkBytes: CHUNK_MIN_BYTES, baseDelayMs: 5, pollMs: 5, tiktokConsent: consent(), ...opts,
});

describe('Direct Post by FILE_UPLOAD', () => {
  test('creator info first, then init (post_info with is_aigc), two declared chunks, status polled to PUBLISH_COMPLETE', async () => {
    const tickets = [];
    const out = await post(TEXT, { onTicket: async (t) => { tickets.push(t); } });
    const init = legs('init')[0];
    const [publishId] = tiktok.state.publishes.keys();
    expect(out).toEqual({
      ok: true, id: publishId, postedAs: { id: 'deusneuma', username: 'deusneuma' },
      url: 'https://www.tiktok.com/@deusneuma',
      text: 'published to TikTok (private: TikTok keeps posts private until the app passes its review); it may take a few minutes for the video to process and be visible on the profile',
    });
    expect(tiktok.state.hits.map((h) => h.leg)).toEqual(['creator', 'init', 'chunk', 'chunk', 'status', 'status']);
    expect(init).toMatchObject({ mode: 'post', auth: 'Bearer access-1', contentType: 'application/json; charset=UTF-8' });
    expect(init.body).toEqual({
      post_info: {
        title: 'Forge night #3 — a walk through the armillary #aiart', privacy_level: 'SELF_ONLY',
        disable_comment: false, disable_duet: true, disable_stitch: true,
        brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true,
      },
      source_info: { source: 'FILE_UPLOAD', video_size: SIZE, chunk_size: CHUNK_MIN_BYTES, total_chunk_count: 2 },
    });
    expect(legs('chunk').map((c) => c.range)).toEqual([`bytes 0-${CHUNK_MIN_BYTES - 1}/${SIZE}`, `bytes ${CHUNK_MIN_BYTES}-${SIZE - 1}/${SIZE}`]);
    expect(legs('chunk').every((c) => c.contentType === 'video/mp4')).toBe(true);
    expect(sha(assembledUpload(tiktok.state))).toBe(sha(videoBytes));
    // The ticket was handed over BEFORE the first byte.
    expect(tickets).toEqual([out.id]);
  });

  test('a public post names its 19-digit post id exactly and links the video', async () => {
    const out = await post('Out loud', { tiktokConsent: consent({ privacyLevel: 'PUBLIC_TO_EVERYONE' }) });
    expect(out).toMatchObject({
      ok: true, id: '7300000000000000001', url: 'https://www.tiktok.com/@deusneuma/video/7300000000000000001',
      text: expect.stringMatching(/^published to TikTok; it may take a few minutes/),
    });
  });

  test('a dropped chunk is sent again; a chunk TikTok kept before the line dropped is never sent twice', async () => {
    tiktok.state.faults[1] = 'drop';
    expect((await post()).ok).toBe(true);
    expect(legs('chunk').map((c) => c.range.split('/')[0])).toEqual([`bytes 0-${CHUNK_MIN_BYTES - 1}`, `bytes ${CHUNK_MIN_BYTES}-${SIZE - 1}`, `bytes ${CHUNK_MIN_BYTES}-${SIZE - 1}`]);
    expect(sha(assembledUpload(tiktok.state))).toBe(sha(videoBytes));

    tiktok.reset();
    tiktok.state.faults[0] = 'keep-then-drop';
    expect((await post()).ok).toBe(true);
    // The resend of chunk 0 is answered 416 + […], and the upload moves on.
    expect(legs('chunk').map((c) => c.range.split('/')[0])).toEqual([`bytes 0-${CHUNK_MIN_BYTES - 1}`, `bytes 0-${CHUNK_MIN_BYTES - 1}`, `bytes ${CHUNK_MIN_BYTES}-${SIZE - 1}`]);
    expect(sha(assembledUpload(tiktok.state))).toBe(sha(videoBytes));

    tiktok.reset();
    tiktok.state.faults[0] = '503';
    expect((await post()).ok).toBe(true);
    expect(sha(assembledUpload(tiktok.state))).toBe(sha(videoBytes));
  });

  test('still processing when the poll window closes: pending, never reported failed', async () => {
    tiktok.state.processingReads = 99;
    const out = await post(TEXT, { pollWindowMs: 0 });
    expect(out).toMatchObject({ ok: false, pending: true, detail: expect.stringMatching(/still processing it/) });
  });
});

describe('refusals in plain words, before anything is sent', () => {
  test('no approval, a privacy the account does not offer, an interaction it turned off, a video longer than it takes', async () => {
    expect((await post('x', { tiktokConsent: null })).detail).toMatch(/carries no approval of who can watch it/);
    // The draft's lines suggest; they never stand in for the approval.
    expect((await post('x\nprivacy: followers', { tiktokConsent: undefined })).detail).toMatch(/carries no approval/);
    expect((await post('x', { tiktokConsent: consent({ privacyLevel: 'MUTUAL_FOLLOW_FRIENDS' }) })).detail)
      .toMatch(/does not offer "Friends" right now, so the post cannot go out as approved/);
    expect((await post('x', { tiktokConsent: consent({ allow: { stitch: true } }) })).detail).toMatch(/has stitch turned off/);
    expect((await post('x', { media: [{ path: longPath }] })).detail).toMatch(/700 seconds long; this TikTok account takes at most 600/);
    expect(legs('init')).toEqual([]);
  });

  test('TikTok\'s own refusals: spam risk at creator info, unaudited app at init, an expired sign-in', async () => {
    tiktok.state.creatorCode = 'spam_risk_too_many_posts';
    expect((await post()).detail).toMatch(/posting limit for today/);
    tiktok.state.creatorCode = 'ok';
    tiktok.state.initCode = 'unaudited_client_can_only_post_to_private_accounts';
    expect((await post('x', { tiktokConsent: consent({ privacyLevel: 'PUBLIC_TO_EVERYONE' }) })).detail).toMatch(/^TikTok keeps posts private until the app passes its review/);
    expect(legs('chunk')).toEqual([]);

    await setChannelCredential(HOUSE, 'tiktok', { accessExpiresAt: new Date(Date.now() - 1000).toISOString() });
    tiktok.state.tokenMode = 'revoked';
    expect((await post()).detail).toMatch(/expired or was removed; reconnect TikTok/);
  });

  test('a photo, no video, no connection, an unrecordable ticket', async () => {
    expect((await post('x', { media: [{ path: stillPath }] })).detail).toBe('TikTok photo posts need a verified domain; coming later');
    expect((await post('x', { media: [] })).detail).toMatch(/TikTok takes videos/);
    expect((await postToTikTok(null, 'x', { media: [{ path: videoPath }], house: HOUSE })).detail).toMatch(/TikTok credentials are not configured/);
    const out = await post(TEXT, { onTicket: async () => { throw new Error('queue busy'); } });
    expect(out.detail).toMatch(/ticket could not be recorded \(queue busy\); nothing was published/);
    expect(legs('chunk')).toEqual([]);
  });
});

describe('send to TikTok drafts (the inbox upload)', () => {
  test('source_info only, the same chunks, settled at SEND_TO_USER_INBOX with the finish-in-app words', async () => {
    const out = await post('Finish me in the app\nsend: drafts');
    const init = legs('init')[0];
    expect(init.mode).toBe('drafts');
    expect(init.body).toEqual({ source_info: { source: 'FILE_UPLOAD', video_size: SIZE, chunk_size: CHUNK_MIN_BYTES, total_chunk_count: 2 } });
    expect(out).toMatchObject({ ok: true, url: 'https://www.tiktok.com/@deusneuma', text: expect.stringMatching(/^sent to TikTok drafts.*turn on the AI-generated content label/) });
    expect(sha(assembledUpload(tiktok.state))).toBe(sha(videoBytes));
  });
});

describe('through the real queue and the real scheduler (isolated temp queue + realm)', () => {
  const seat = async () => {
    const house = await useServedHouse({ lanes: ['tt-holder'] });
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(dir, `queue-${crypto.randomBytes(4).toString('hex')}.json`);
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(dir, 'bindings.json');
    await fs.writeFile(process.env.NEUMA_SOCIAL_BINDINGS_PATH, JSON.stringify({
      tiktok: { neumaId: 'tt-holder', boundBy: SERVED_WALLET, boundAt: new Date().toISOString() },
    }));
    const { postQueue } = await import('../../backend/services/social/post-queue.js');
    const { schedulerTick } = await import('../../backend/services/social/post-scheduler.js');
    tiktok.state.processingReads = 0;
    return { house, postQueue, schedulerTick };
  };
  const stage = (postQueue, text, extra = {}) => postQueue.add({
    channelId: 'tiktok', text, media: [{ path: videoPath, alt: '' }], queuedBy: 'tt-holder', authorNeumaId: 'tt-holder', ...extra,
  });

  test('a text-only TikTok draft never enters the queue', async () => {
    const { house, postQueue } = await seat();
    await expect(postQueue.add({ channelId: 'tiktok', text: 'Just words', queuedBy: 'tt-holder', authorNeumaId: 'tt-holder' }))
      .rejects.toThrow(/text-only post cannot go to TikTok/);
    house.restore();
  });

  test('draft → the operator\'s approval → the tick publishes it; the ticket and the outcome land on the record', async () => {
    const { house, postQueue, schedulerTick } = await seat();
    const e = await stage(postQueue, TEXT, { scheduledFor: new Date(Date.now() - 60_000).toISOString() });
    await schedulerTick(Date.now());
    expect(legs('init')).toEqual([]); // a draft is never sent
    await postQueue.approve(e.id, { decidedBy: SERVED_WALLET, tiktokConsent: consent(), textSeen: e.text });
    await schedulerTick(Date.now()).finally(house.restore);
    const [after] = await postQueue.load();
    const publishId = tiktok.state.publishes.keys().next().value;
    expect(after).toMatchObject({ status: 'sent', postId: publishId, sendTicket: publishId, postedAs: { id: 'deusneuma', username: 'deusneuma' } });
    expect(legs('init')[0].body.post_info.is_aigc).toBe(true);
    expect(sha(assembledUpload(tiktok.state))).toBe(sha(videoBytes));
  });

  test('sends lost mid-flight are settled from TikTok\'s publish record, never re-sent', async () => {
    const { house, postQueue, schedulerTick } = await seat();
    // A real publish that went out while "the process died": init + chunks on the stand-in.
    await post(TEXT, { pollWindowMs: 0 });
    const publishId = tiktok.state.publishes.keys().next().value;
    const claimed = async (text) => {
      const e = await stage(postQueue, text);
      await postQueue.approve(e.id, { decidedBy: SERVED_WALLET, tiktokConsent: consent(), textSeen: e.text });
      await postQueue.claimForSend(e.id);
      return e.id;
    };
    const wentOut = await claimed('It went out');
    await postQueue.recordSendTicket(wentOut, publishId);
    const neverOpened = await claimed('It never opened');
    // Both claims are three hours old: past TikTok's lease.
    const file = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const entries = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify(entries.map((x) => ({ ...x, sendingAt: old }))));
    const inits = legs('init').length;
    await schedulerTick(Date.now()).finally(house.restore);
    const byId = Object.fromEntries((await postQueue.load()).map((x) => [x.id, x]));
    expect(byId[wentOut]).toMatchObject({ status: 'sent', postId: publishId });
    expect(byId[neverOpened].status).toBe('failed');
    expect(byId[neverOpened].error).toMatch(/before TikTok received the video/);
    expect(legs('status').at(-1).publishId).toBe(publishId);
    expect(legs('init')).toHaveLength(inits); // settled, never re-sent
  });
});
