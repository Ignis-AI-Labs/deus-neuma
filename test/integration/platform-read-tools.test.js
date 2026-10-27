/**
 * EVERY PLATFORM HAS ITS OWN READ, EQUALLY (integration, RULE 0 — no mocks).
 * Facebook, YouTube, TikTok… each has its own tool calls, so every agent can
 * pull what it needs.
 *
 * Each lane of a house where a platform is connected is offered read_<platform>
 * — the holder and a housemate alike — and the read runs behind the
 * operator's card: the house's account, its counts and its newest posts with
 * their numbers, the platform's words inside the untrusted frame. A refusal
 * comes back in words that name the cure; a declined card reads nothing.
 *
 * Real: the tool catalog + tool_search, the platform dispatch and ACTS gate,
 * the account store, the token refresh, a WebSocket pair the cards cross, two
 * houses on temp ground. The ONE stand-in is each platform's API
 * (test/helpers/social-stats-stand-ins.js + social-account-stand-ins.js).
 * Every real social key is pinned empty.
 */
import process from 'node:process';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { standTikTokHouses, CMO, OTHER, B_HOLDER } from '../helpers/tiktok-being-kit.js';
import { startStatsStandIns } from '../helpers/social-stats-stand-ins.js';
import { pinSocialKeysEmpty, SOCIAL_KEY } from '../helpers/no-social-keys.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { stashBeingTurnCatalog, discloseTurnTools, TOOL_DOORS } from '../../backend/services/being-tool-surface.js';
import { dispatchPlatformTool } from '../../backend/services/portal-tool-dispatch.js';
import { setChannelCredential } from '../../backend/services/social/channel-credentials.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { readPlatformForBeing } from '../../backend/services/portal-tools/platform-read-tools.js';

const READS = ['read_youtube', 'read_facebook', 'read_bluesky', 'read_mastodon', 'read_tiktok'];
const DOORS = ['NEUMA_YOUTUBE_API_ROOT', 'NEUMA_GOOGLE_TOKEN_URL', 'NEUMA_FACEBOOK_API_ROOT', 'NEUMA_MASTODON_API_ROOT', 'NEUMA_BLUESKY_API_ROOT'];

let kit; let api; let saved;

const call = (connection, toolName, args = {}) => dispatchPlatformTool(
  { server: 'social', toolName, tool: `social/${toolName}` },
  { ws: connection.ws, connection, companion: connection.companion, policy: null, toolMode: 'ask', args },
);
const hitsSince = (n) => api.state.hits.slice(n);

beforeAll(async () => {
  saved = Object.fromEntries([...DOORS, ...Object.keys(process.env).filter((k) => SOCIAL_KEY.test(k))].map((k) => [k, process.env[k]]));
  pinSocialKeysEmpty(process.env, '/nonexistent');
  api = await startStatsStandIns();
  Object.assign(process.env, {
    NEUMA_YOUTUBE_API_ROOT: api.root, NEUMA_GOOGLE_TOKEN_URL: `${api.root}/token`, NEUMA_FACEBOOK_API_ROOT: api.root,
    NEUMA_MASTODON_API_ROOT: api.root, NEUMA_BLUESKY_API_ROOT: api.root,
  });
  kit = await standTikTokHouses();
  const house = kit.operator.address;
  await setChannelCredential(house, 'youtube', { clientId: 'ph-google-client', clientSecret: 'ph-google-secret', refreshToken: 'ph-refresh' });
  await setChannelCredential(house, 'facebook', { pageId: '555', accessToken: 'ph-page-token' });
  await setChannelCredential(house, 'mastodon', { instanceUrl: 'social.example', accessToken: 'ph-mastodon' });
  await setChannelCredential(house, 'bluesky', { identifier: 'northwind.bsky.social', appPassword: 'ph-app-password' });
  await channelBindings.bind(house, 'youtube', { neumaId: CMO });
}, 60_000);

afterAll(async () => {
  await kit?.close();
  await api?.close();
  for (const [k, v] of Object.entries(saved || {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('each connected platform is offered to every lane of the house', () => {
  test('the holder and a housemate off every crew are both offered all five reads', async () => {
    for (const lane of [CMO, OTHER]) {
      const names = (await platformToolsFor(kit.connectionFor(lane))).tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(READS));
    }
    // Posting tools stay with the crews: the housemate edits no YouTube calendar.
    expect((await platformToolsFor(kit.connectionFor(OTHER))).tools.map((t) => t.name)).not.toContain('queue_update_to_youtube');
  });

  test('another house is offered only what it has connected', async () => {
    const names = (await platformToolsFor(kit.connectionFor(B_HOLDER, kit.operatorB.address))).tools.map((t) => t.name);
    expect(names).toContain('read_tiktok');
    for (const absent of ['read_youtube', 'read_facebook', 'read_bluesky', 'read_mastodon']) expect(names).not.toContain(absent);
  });

  test('tool_search "youtube" answers the YouTube draft shape and the channel read', async () => {
    const cmo = kit.connectionFor(CMO);
    expect(await intentSectionFor(cmo)).toContain('social/queue (channels: youtube, tiktok)');
    const { tools } = await platformToolsFor(cmo);
    await stashBeingTurnCatalog(cmo, [...TOOL_DOORS, ...tools], []);
    const found = JSON.parse(discloseTurnTools(cmo, { query: 'youtube' }).content);
    const contract = found.intents.find((i) => i.name === 'social/queue');
    for (const rule of ['exactly ONE video', 'the FIRST line is the title (at most 100 characters)', '"privacy: public|unlisted|private"',
      'unlisted when absent', '"tags: one, two"', 'aspect "landscape"', 'queue_get {id}', 'read_youtube']) {
      expect(contract.description).toContain(rule);
    }
    expect(found.tools.map((t) => t.id)).toContain('social/read_youtube');
  });
});

describe('a housemate reads each platform behind the operator\'s card', () => {
  test('YouTube: the channel, its counts and the uploads with their numbers, read with the house\'s own sign-in', async () => {
    kit.decide = () => 'allow';
    const cards = kit.cards.length;
    const hits = api.state.hits.length;
    const read = await call(kit.connectionFor(OTHER), 'read_youtube');
    expect(kit.cards.slice(cards).map((c) => c.tool)).toEqual(['social/read_youtube']);
    expect(read.status).toBe('ok');
    for (const words of ['@northwind · (Northwind) · https://www.youtube.com/@northwind', 'subscribers 321 · views 5400 · videos 2',
      '2 of the 2 newest video(s)', 'video vid-new · posted 2026-10-20T10:00:00Z · 58s · public · views 1200 · likes 88 · comments 7 · https://www.youtube.com/watch?v=vid-new',
      'video vid-old · posted 2026-10-01T10:00:00Z · 125s · unlisted · views 40 · likes not shared · comments 0',
      'BEGIN EXTERNAL CONTENT', 'Wind over water\nA short about the sea.', 'Films about the north wind.']) {
      expect(read.content).toContain(words);
    }
    expect(hitsSince(hits)).toEqual(['POST /token', 'GET /youtube/v3/channels', 'GET /youtube/v3/playlistItems', 'GET /youtube/v3/videos']);
    expect(api.state.auth.slice(hits + 1)).toEqual(Array(3).fill('Bearer ph-google-access'));
  });

  test('Facebook: the Page, its followers and likes, and its posts with reactions, comments and shares', async () => {
    const read = await call(kit.connectionFor(OTHER), 'read_facebook');
    expect(read.status).toBe('ok');
    for (const words of ['(Northwind Studio) · https://www.facebook.com/northwind', 'followers 1000 · likes 900',
      'post 555_1 · posted 2026-10-21T08:00:00+0000 · reactions 31 · comments 4 · shares 2 · https://www.facebook.com/northwind/posts/1',
      'Out now: Wind over water', 'We make films.']) {
      expect(read.content).toContain(words);
    }
    expect(api.state.auth.at(-1)).toBe('Bearer ph-page-token');
  });

  test('Mastodon and Bluesky: the profile, its counts and its posts', async () => {
    const mastodon = await call(kit.connectionFor(OTHER), 'read_mastodon');
    expect(mastodon.status).toBe('ok');
    for (const words of ['@northwind · (Northwind)', 'followers 50 · following 10 · posts 3',
      'post 109 · posted 2026-10-22T09:00:00.000Z · favourites 9 · boosts 2 · replies 1', 'Wind over water is out.\nWatch it.', 'Films & wind.']) {
      expect(mastodon.content).toContain(words);
    }
    const bluesky = await call(kit.connectionFor(OTHER), 'read_bluesky');
    expect(bluesky.status).toBe('ok');
    for (const words of ['@northwind.bsky.social · (Northwind) · https://bsky.app/profile/northwind.bsky.social', 'followers 70 · following 5 · posts 4',
      'likes 12 · reposts 3 · replies 1 · quotes 0 · https://bsky.app/profile/northwind.bsky.social/post/3kabc', 'Wind over water, out now']) {
      expect(bluesky.content).toContain(words);
    }
  });

  test('declined: nothing leaves the machine', async () => {
    kit.decide = () => 'deny';
    const hits = api.state.hits.length;
    const read = await call(kit.connectionFor(OTHER), 'read_youtube');
    expect(read.status).toBe('denied');
    expect(api.state.hits).toHaveLength(hits);
    kit.decide = () => 'allow';
  });
});

describe('what cannot be read says why, and how to fix it', () => {
  test('a YouTube connection without read access names the reconnect', async () => {
    api.state.accounts.youtube.mode = 'scope';
    const read = await call(kit.connectionFor(OTHER), 'read_youtube');
    api.state.accounts.youtube.mode = 'ok';
    expect(read.status).toBe('error');
    expect(read.error).toMatch(/The YouTube read did not land: the connection may not read this channel; reconnect YouTube in Settings → API → Channel keys \(CONNECT\)/);
  });

  test('a dead Page token is named; a Page whose posts are refused still reads its Page', async () => {
    api.state.accounts.facebook.mode = 'expired';
    const dead = await call(kit.connectionFor(OTHER), 'read_facebook');
    expect(dead.error).toMatch(/Facebook no longer accepts the Page token; paste a fresh one/);
    api.state.accounts.facebook.mode = 'posts';
    const half = await call(kit.connectionFor(OTHER), 'read_facebook');
    api.state.accounts.facebook.mode = 'ok';
    expect(half.status).toBe('ok');
    expect(half.content).toContain('followers 1000 · likes 900');
    expect(half.content).toContain('The posts could not be read: Facebook refused the read (pages_read_engagement is required).');
  });

  test('an account of another platform is refused in words, before anything is read', async () => {
    const hits = api.state.hits.length;
    const read = await call(kit.connectionFor(OTHER), 'read_youtube', { account: 'tiktok-1' });
    expect(read.error).toBe('tiktok-1 is not a YouTube account — accounts are named youtube-1, youtube-2…');
    expect(api.state.hits).toHaveLength(hits);
  });
});

test('a read too long for the window holds back the oldest posts WHOLE, and says so', async () => {
  const full = await readPlatformForBeing('read_youtube', OTHER, {});
  const fitted = await readPlatformForBeing('read_youtube', OTHER, { budget: full.text.length - 50 });
  expect(fitted.ok).toBe(true);
  expect(fitted.text.length).toBeLessThanOrEqual(full.text.length - 50);
  expect(fitted.text).toContain('1 of the 2 newest video(s)');
  expect(fitted.text).toContain('…and 1 older video(s) held back so this read fits your window WHOLE.');
  expect(fitted.text).not.toContain('vid-old');
  expect(fitted.summary).toBe('read the YouTube account and 1 video(s)');
});
