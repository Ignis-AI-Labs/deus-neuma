/**
 * THE MARKETING SEAT WORKS TIKTOK END TO END (integration, RULE 0 — no mocks).
 *
 * A being that holds the TikTok channel finds the draft shape on demand
 * (tool_search, never the standing prompt), stages one of its OWN forge videos
 * by id through the social/queue intent (the real sweep → the real queue,
 * landing a `draft`), is refused in words that name the way forward, follows
 * the entry with queue_get, and reads its house's own TikTok account with
 * read_tiktok behind the operator's card. The operator approves on the real
 * route with the card's choices; the real scheduler tick sends exactly them.
 *
 * Real: the intent sweep, the tool catalog + tool_search, the platform
 * dispatch and ACTS gate, the image store, the queue store, the social router
 * behind signed-wallet sessions, the scheduler, a WebSocket pair the cards
 * cross, two houses on temp ground. The ONE stand-in is TikTok's Open API
 * (test/helpers/tiktok-stand-in.js) — whether real TikTok accepts these
 * posts is proven by scripts/tiktok-post-verify.mjs, not here. No entry is
 * seeded `approved`; every TIKTOK_* key is cleared.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import request from 'supertest';
import { standTikTokHouses, legsOf, CMO, OTHER, B_HOLDER } from '../helpers/tiktok-being-kit.js';
import { mp4Bytes, assembledUpload } from '../helpers/tiktok-stand-in.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { stashBeingTurnCatalog, discloseTurnTools, TOOL_DOORS } from '../../backend/services/being-tool-surface.js';
import { dispatchPlatformTool } from '../../backend/services/portal-tool-dispatch.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { schedulerTick } from '../../backend/services/social/post-scheduler.js';

const CAPTION = 'Forge night — the armillary turns #aiart';
const TEXT = `${CAPTION}\nprivacy: everyone\nallow: comments`;
const CHOICE = Object.freeze({ privacyLevel: 'FOLLOWER_OF_CREATOR', allow: { comment: true, duet: false, stitch: false }, commercial: { on: false } });
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(64, 1)]);

let kit; let video; let longVideo; let still; let otherVideo; let staged;

const call = (connection, toolName, args = {}) => dispatchPlatformTool(
  { server: 'social', toolName, tool: `social/${toolName}` },
  { ws: connection.ws, connection, companion: connection.companion, policy: null, toolMode: 'ask', args },
);
const queued = async () => (await postQueue.load()).filter((e) => e.channelId === 'tiktok');

beforeAll(async () => {
  kit = await standTikTokHouses();
  video = await kit.render(CMO, 'clip.mp4', mp4Bytes(12, 2_000_000));
  longVideo = await kit.render(CMO, 'long.mp4', mp4Bytes(30, 200_000));
  still = await kit.render(CMO, 'still.png', PNG);
  otherVideo = await kit.render(OTHER, 'theirs.mp4', mp4Bytes(8, 200_000));
  kit.tiktok.state.processingReads = 0;
}, 60_000);

afterAll(async () => kit?.close());

describe('the TikTok draft shape is read on demand, by the lanes that can reach TikTok', () => {
  test('the standing prompt names the type only; tool_search "tiktok" answers the full contract and the account read', async () => {
    const cmo = kit.connectionFor(CMO);
    const section = await intentSectionFor(cmo);
    expect(section).toContain('social/queue (channels: tiktok)');
    expect(section).not.toContain('2200');
    const { tools } = await platformToolsFor(cmo);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['read_tiktok', 'queue_update_to_tiktok']));
    await stashBeingTurnCatalog(cmo, [...TOOL_DOORS, ...tools], []);
    const found = JSON.parse(discloseTurnTools(cmo, { query: 'tiktok' }).content);
    const contract = found.intents.find((i) => i.name === 'social/queue');
    expect(contract.channels).toEqual(['tiktok']);
    expect(contract.fields).toContain('media?: [{image|path, alt}]');
    for (const rule of ['exactly ONE video', 'at most 2200 characters', '"privacy: only me|friends|followers|everyone"',
      'SUGGESTIONS only', '"send: drafts"', 'video.ltx.i2v', 'aspect "portrait"', 'queue_get {id}', 'read_tiktok']) {
      expect(contract.description).toContain(rule);
    }
    expect(found.tools.map((t) => t.id)).toContain('social/read_tiktok');
  });

  test('a housemate off the TikTok crew is offered neither the TikTok rules nor the account read', async () => {
    const other = kit.connectionFor(OTHER);
    expect(await intentSectionFor(other)).not.toContain('tiktok');
    expect((await platformToolsFor(other)).tools.map((t) => t.name)).not.toContain('read_tiktok');
  });
});

describe('a video from the being\'s own store is staged as a draft — never approved', () => {
  test('by the id the forge gave it: the draft holds that file, names the account, and says what happens next', async () => {
    const receipt = await kit.file(kit.connectionFor(CMO), 'tiktok-forge-night', {
      type: 'social/queue', channel: 'tiktok', text: TEXT, media: [{ image: video.id, alt: 'the armillary turning' }],
    });
    expect(receipt.status).toBe('ok');
    for (const words of ['Staged TikTok draft', 'to post as @deusneuma', 'Nothing is published yet',
      'chooses who can watch, the interactions and the disclosure themself', 'suggestions only',
      'at the scheduler\'s next pass', 'Follow it with queue_get']) {
      expect(receipt.content).toContain(words);
    }
    const [entry] = await queued();
    staged = entry;
    expect(entry).toMatchObject({ status: 'draft', text: TEXT, authorNeumaId: CMO, media: [{ path: video.path, alt: 'the armillary turning' }] });
    expect(kit.cards).toEqual([]); // staging is no card: the post's one decision is its card on the board
    expect(legsOf(kit, 'creator').map((h) => h.auth)).toEqual(['Bearer access-A']);
    expect(legsOf(kit, 'init')).toEqual([]);
  });

  test('what cannot stand is refused in words that name the way forward, and nothing is staged', async () => {
    const cmo = kit.connectionFor(CMO);
    kit.tiktok.state.creator.max_video_post_duration_sec = 20;
    const cases = [
      [{ text: CAPTION }, /TikTok takes videos: a text-only post cannot go to TikTok.*Attach one video: media: \[\{image: .*image\/generate/],
      [{ text: CAPTION, media: [{ image: still.id }] }, /TikTok photo posts need a verified domain.*Attach one video.*video\.ltx\.i2v/],
      [{ text: 'x'.repeat(2300), media: [{ image: video.id }] }, /the caption is 2300 characters; TikTok allows at most 2200/],
      [{ text: CAPTION, media: [{ image: longVideo.id }] }, /the video is 30 seconds long; this TikTok account posts at most 20 seconds\. Attach a shorter video/],
      [{ text: CAPTION, media: [{ image: otherVideo.id }] }, /no such image in this lane/],
      [{ text: `${CAPTION}\nprivacy: secret`, media: [{ image: video.id }] }, /privacy must be only me, friends, followers or everyone, not "secret"/],
    ];
    for (const [i, [fields, words]] of cases.entries()) {
      const receipt = await kit.file(cmo, `refused-${i}`, { type: 'social/queue', channel: 'tiktok', ...fields });
      expect(receipt.status).not.toBe('ok');
      expect(receipt.error).toMatch(words);
    }
    kit.tiktok.state.creator.max_video_post_duration_sec = 600;
    expect((await queued()).map((e) => e.id)).toEqual([staged.id]);
  });

  test('a lane off the TikTok crew is refused at staging, and its account read is refused before any card', async () => {
    const other = kit.connectionFor(OTHER);
    const receipt = await kit.file(other, 'not-mine', { type: 'social/queue', channel: 'tiktok', text: CAPTION, media: [{ image: otherVideo.id }] });
    expect(receipt.status).toBe('denied');
    expect(receipt.error).toMatch(/you are not on the TikTok crew/);
    const userLegs = legsOf(kit, 'user').length;
    const read = await call(other, 'read_tiktok');
    expect(read.status).toBe('denied');
    expect(read.error).toMatch(/you do not hold TikTok in your house/);
    expect(kit.cards).toEqual([]);
    expect(legsOf(kit, 'user')).toHaveLength(userLegs);
    expect((await queued()).map((e) => e.id)).toEqual([staged.id]);
  });
});

describe('the operator decides on the card; the scheduler sends exactly that; the being follows it', () => {
  test('approved with the card\'s choices, sent by a real tick, read back by queue_get', async () => {
    const before = await call(kit.connectionFor(CMO), 'queue_get', { id: staged.id });
    expect(before.content).toContain('awaits its card: your operator chooses who can watch');
    expect(before.content).toContain('1 video:');
    expect(before.content).toContain('the caption publishes; privacy, allow, promotion and send lines are read, never published');

    const res = await request(kit.app).put(`/api/v1/social-channels/queue/${staged.id}/approve`)
      .set(kit.operator.header).send({ textSeen: staged.text, tiktok: CHOICE });
    expect(res.status).toBe(200);
    const approved = await call(kit.connectionFor(CMO), 'queue_get', { id: staged.id });
    expect(approved.content).toContain('your operator chose on the card: who can watch Followers; comments on, duet off, stitch off; disclosure none; posting as @deusneuma');
    expect(approved.content).toContain('approved: goes out at the scheduler\'s next pass');
    expect(approved.content).not.toContain('X holds no schedule');

    await schedulerTick(Date.now());
    expect(legsOf(kit, 'init')).toHaveLength(1);
    expect(legsOf(kit, 'init')[0].body.post_info).toEqual({
      title: CAPTION, privacy_level: 'FOLLOWER_OF_CREATOR',
      disable_comment: false, disable_duet: true, disable_stitch: true,
      brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true,
    });
    expect(assembledUpload(kit.tiktok.state).equals(await fs.readFile(video.path))).toBe(true);
    const sent = await call(kit.connectionFor(CMO), 'queue_get', { id: staged.id });
    expect(sent.content).toContain(`[${staged.id}] tiktok — sent`);
    expect(sent.content).toContain('PUBLISHED as @deusneuma: TikTok gives this post no public link yet; the account is https://www.tiktok.com/@deusneuma');
    expect(sent.content).not.toContain('LIVE null');
  });
});

describe('the holder reads its own house\'s TikTok account, behind the operator\'s card', () => {
  test('allowed: the profile, the counts and the newest videos — captions and bio framed as outside words', async () => {
    kit.decide = () => 'allow';
    const read = await call(kit.connectionFor(CMO), 'read_tiktok');
    expect(kit.cards.map((c) => c.tool)).toEqual(['social/read_tiktok']);
    expect(read.status).toBe('ok');
    for (const words of ['@deusneuma · (Deus Neuma) · verified · https://www.tiktok.com/@deusneuma',
      'followers 12345 · following 12 · likes 1500000 · videos 3', '3 of the 3 newest public video(s)',
      'video 7300000000000000003 · posted', 'views 2000 · likes 150 · comments 12 · shares 3', 'BEGIN EXTERNAL CONTENT',
      'Sovereign relationships with AI.']) {
      expect(read.content).toContain(words);
    }
    expect(legsOf(kit, 'user').at(-1).auth).toBe('Bearer access-A');
  });

  test('declined: nothing is read', async () => {
    kit.decide = () => 'deny';
    const userLegs = legsOf(kit, 'user').length;
    const read = await call(kit.connectionFor(CMO), 'read_tiktok');
    expect(read.status).toBe('denied');
    expect(legsOf(kit, 'user')).toHaveLength(userLegs);
  });

  test('another house\'s holder reads ITS house\'s account, with its own sign-in — never this one', async () => {
    kit.decide = () => 'allow';
    const read = await call(kit.connectionFor(B_HOLDER, kit.operatorB.address), 'read_tiktok');
    expect(read.status).toBe('ok');
    expect(legsOf(kit, 'user').at(-1).auth).toBe('Bearer access-B');
    expect(legsOf(kit, 'user').filter((h) => h.auth === 'Bearer access-B')).toHaveLength(1);
  });
});
