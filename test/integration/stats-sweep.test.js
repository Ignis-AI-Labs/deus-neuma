/**
 * THE STATS SWEEP (campaign plan slice 9) — real tmp disk, the real sealed
 * credential store, the real queue and results stores, real HTTP to local
 * stand-ins in each platform's shape (test/helpers/social-stats-stand-ins.js,
 * the extended TikTok stand-in, the site counter's stand-in). Placeholder keys
 * only; nothing leaves the machine; no double anywhere (RULE 0).
 *
 * The queue holds SENT posts — history, never `approved` — as the store
 * writes them, staged by the house's operator.
 *
 * Proven: each account is read with its own credential, the result stored per
 * house per account per post, a metric the platform does not report is absent
 * (never 0) and LinkedIn — no read — is recorded as not readable with why; a
 * second pass inside the interval reads nothing; a post read again after its
 * interval adds to its series; X's 429 is honoured until its reset and logged
 * once; X's private metrics refused leaves the public ones; YouTube's quota
 * exhausted stops every YouTube account of the house (the project's quota is
 * shared) until the reset; the site counter's clicks are read for the house's
 * own codes; another house reads none of it.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { startStatsStandIns } from '../helpers/social-stats-stand-ins.js';
import { startTikTokStandIn } from '../helpers/tiktok-stand-in.js';
import { startSiteCounterStandIn } from '../helpers/site-counter-stand-in.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { addAccount, setAccountFields, setAppFields } from '../../backend/services/social/account-store.js';
import { setSiteToken } from '../../backend/services/marketing/site-counter.js';
import { appendLinks } from '../../backend/services/marketing/link-store.js';
import { sweepHouse } from '../../backend/services/social/stats/stats-sweep.js';
import { loadResults } from '../../backend/services/marketing/results-store.js';
import resultsRouter from '../../backend/routes/marketing-results-routes.js';

const ENV = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_X_API_ROOT', 'NEUMA_YOUTUBE_API_ROOT', 'NEUMA_GOOGLE_TOKEN_URL', 'NEUMA_TIKTOK_API_ROOT', 'NEUMA_MASTODON_API_ROOT',
  'NEUMA_BLUESKY_API_ROOT', 'NEUMA_SITE_COUNTER_ROOT', 'NEUMA_CAMPAIGNS_PATH'];
const HOUR = 3600e3;
const BSKY = 'at://did:plc:house/app.bsky.feed.post/3kq2';

describe('the stats sweep: per account, decaying, polite, honest about what it cannot read', () => {
  let dir; let saved; let priorRealm; let a; let b; let stats; let tiktok; let counter; let app;
  const sentAgo = (id, channelId, accountId, postId, hours) => ({
    id, channelId, accountId, text: `post ${id}`, scheduledFor: null, campaignId: null, pillar: '', media: [],
    authorNeumaId: null, queuedBy: a.address, status: 'sent', createdAt: new Date(Date.now() - (hours + 1) * HOUR).toISOString(),
    decidedBy: a.address, decidedAt: new Date(Date.now() - (hours + 1) * HOUR).toISOString(), sentAt: new Date(Date.now() - hours * HOUR).toISOString(), postId,
  });

  beforeAll(async () => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    dir = await fs.realpath(await createTempDir('stats-sweep'));
    for (const [k, f] of [['NEUMA_SOCIAL_POST_QUEUE_PATH', 'queue.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'bindings.json'],
      ['NEUMA_SECTOR_CREW_PATH', 'crew.json'], ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'legacy-creds.json'], ['NEUMA_CAMPAIGNS_PATH', 'legacy-campaigns.json']]) {
      process.env[k] = path.join(dir, f);
    }
    priorRealm = getRealmRoot();
    setRealmRoot(path.join(dir, 'realm'));
    [stats, tiktok] = [await startStatsStandIns(), await startTikTokStandIn()];
    counter = await startSiteCounterStandIn({ token: 'ph-site-token-0123456789' });
    Object.assign(process.env, {
      NEUMA_X_API_ROOT: `${stats.root}/2`, NEUMA_YOUTUBE_API_ROOT: stats.root, NEUMA_GOOGLE_TOKEN_URL: `${stats.root}/token`,
      NEUMA_TIKTOK_API_ROOT: tiktok.root, NEUMA_MASTODON_API_ROOT: stats.root, NEUMA_BLUESKY_API_ROOT: stats.root, NEUMA_SITE_COUNTER_ROOT: counter.root,
    });
    [a, b] = [await fullAuth(), await fullAuth()];
    for (const ch of ['x', 'youtube', 'youtube', 'tiktok', 'mastodon', 'bluesky', 'linkedin']) expect((await addAccount(a.address, ch, {}, [])).ok).toBe(true);
    await setAppFields(a.address, 'x', { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
    await setAccountFields(a.address, 'x-1', { accessToken: 'ph-x-token', accessSecret: 'ph-x-secret' });
    await setAppFields(a.address, 'youtube', { clientId: 'ph-google-client', clientSecret: 'ph-google-secret' });
    for (const id of ['youtube-1', 'youtube-2']) await setAccountFields(a.address, id, { refreshToken: `ph-refresh-${id}` });
    await setAppFields(a.address, 'tiktok', { clientKey: 'awkey', clientSecret: 'stand-in-secret' });
    await setAccountFields(a.address, 'tiktok-1', {
      accessToken: 'access-1', refreshToken: 'refresh-1', accessExpiresAt: new Date(Date.now() + 20 * HOUR).toISOString(),
      grantedScope: 'user.info.basic,video.list,video.publish,video.upload',
    });
    await setAccountFields(a.address, 'mastodon-1', { instanceUrl: 'social.example', accessToken: 'ph-mastodon' });

    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, `${JSON.stringify([
      sentAgo('e-x', 'x', 'x-1', '1850000000000000001', 2),
      sentAgo('e-yt1', 'youtube', 'youtube-1', 'vid-one', 5),
      sentAgo('e-yt2', 'youtube', 'youtube-2', 'vid-two', 50),
      sentAgo('e-tt', 'tiktok', 'tiktok-1', '7300000000000000003', 10),
      sentAgo('e-md', 'mastodon', 'mastodon-1', '109', 1),
      sentAgo('e-bs', 'bluesky', 'bluesky-1', BSKY, 1),
      sentAgo('e-li', 'linkedin', 'linkedin-1', 'urn:li:share:7000', 1),
      sentAgo('e-old', 'x', 'x-1', '1850000000000000009', 24 * 120),
    ], null, 2)}\n`, { mode: 0o600 });
    Object.assign(stats.state.counts, {
      '1850000000000000001': { views: 4100, likes: 61, replies: 4, shares: 9, quotes: 1, saves: 3, linkClicks: 61, profileClicks: 7 },
      'vid-one': { views: 900, likes: 30, replies: 2 },
      'vid-two': { views: 50, likes: undefined, replies: 0 },
      109: { likes: 12, shares: 3, replies: 1 },
      [BSKY]: { likes: 8, shares: 2, replies: 1, quotes: 0 },
    });
    await setSiteToken(a.address, 'ph-site-token-0123456789');
    await appendLinks(a.address, [{ code: 'k7q2xm', destination: 'https://deusneuma.ai/download/', entryId: 'e-x', accountId: 'x-1', companyId: null, createdAt: new Date().toISOString() }]);
    counter.codes.set('k7q2xm', { code: 'k7q2xm', destination: 'https://deusneuma.ai/download/', company: null });
    counter.count('click', 'k7q2xm', '2026-10-24', 61);
    counter.count('download', 'k7q2xm', '2026-10-24', 22);
    app = express();
    app.use(express.json());
    app.use('/api/v1/marketing/results', resultsRouter);
  }, 60000);

  afterAll(async () => {
    await Promise.all([stats?.close(), tiktok?.close(), counter?.close()]);
    setRealmRoot(priorRealm);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('one pass: each account read with its own keys; absent means not reported; LinkedIn has no read and says why; the counter\'s clicks are read', async () => {
    const outcome = await sweepHouse(a.address);
    expect(outcome.accounts).toEqual({
      'x-1': 'read 1', 'youtube-1': 'read 1', 'youtube-2': 'read 1', 'tiktok-1': 'read 1', 'mastodon-1': 'read 1', 'bluesky-1': 'read 1', 'linkedin-1': 'not readable',
    });
    const record = await loadResults(a.address);
    const latest = Object.fromEntries(record.results.map((r) => [r.entryId, r]));
    expect(latest['e-x']).toMatchObject({ accountId: 'x-1', channelId: 'x', postId: '1850000000000000001', source: 'x',
      metrics: { views: 4100, likes: 61, replies: 4, shares: 9, quotes: 1, saves: 3, linkClicks: 61, profileClicks: 7 } });
    expect(latest['e-yt1'].metrics).toEqual({ views: 900, likes: 30, replies: 2 });
    expect(latest['e-yt2'].metrics).toEqual({ views: 50, replies: 0 }); // a hidden like count is ABSENT, never 0
    expect(latest['e-tt'].metrics).toEqual({ views: 2000, likes: 150, replies: 12, shares: 3 });
    expect(latest['e-md'].metrics).toEqual({ likes: 12, shares: 3, replies: 1 });
    expect(latest['e-bs'].metrics).toEqual({ likes: 8, shares: 2, replies: 1, quotes: 0 });
    expect(latest['e-li']).toBeUndefined();
    expect(latest['e-old']).toBeUndefined(); // past 90 days a post is no longer read
    expect(record.unavailable['linkedin-1'].reason).toMatch(/partner apps/);
    expect(record.links.counts.sort((x, y) => x.kind.localeCompare(y.kind))).toEqual([
      { code: 'k7q2xm', kind: 'click', day: '2026-10-24', count: 61 }, { code: 'k7q2xm', kind: 'download', day: '2026-10-24', count: 22 },
    ]);
    expect(record.spend.youtube.units).toBe(2);
    // The TikTok read asked TikTok's own video.query for exactly its video.
    expect(tiktok.state.hits.filter((h) => h.leg === 'query').map((h) => h.ids)).toEqual([['7300000000000000003']]);
  });

  test('inside the interval nothing is read again; past it, the post\'s series grows', async () => {
    const before = stats.state.hits.length;
    expect((await sweepHouse(a.address)).read).toBe(0);
    expect(stats.state.hits.length).toBe(before);
    stats.state.counts['1850000000000000001'].views = 5200;
    const later = await sweepHouse(a.address, { now: Date.now() + 7 * HOUR });
    expect(later.accounts['x-1']).toBe('read 1');
    const series = (await loadResults(a.address)).results.filter((r) => r.entryId === 'e-x').map((r) => r.metrics.views);
    expect(series).toEqual([4100, 5200]);
  });

  test('X says slow down: honoured until its reset; X refusing private metrics leaves the public ones', async () => {
    stats.state.x = 'slow';
    const t = Date.now() + 14 * HOUR;
    expect((await sweepHouse(a.address, { now: t })).accounts['x-1']).toBe('slowed down');
    const { backoff } = await loadResults(a.address);
    expect(Date.parse(backoff['x-1'].until)).toBeGreaterThan(t);
    stats.state.x = 'private';
    expect((await sweepHouse(a.address, { now: t + 60e3 })).accounts['x-1']).toBe('backing off');
    const after = await sweepHouse(a.address, { now: Date.parse(backoff['x-1'].until) + 1000 });
    expect(after.accounts['x-1']).toBe('read 1');
    const last = (await loadResults(a.address)).results.filter((r) => r.entryId === 'e-x').at(-1);
    expect(last.metrics).toEqual({ views: 5200, likes: 61, replies: 4, shares: 9, quotes: 1, saves: 3 }); // no click counts: X refused them
  });

  test('YouTube\'s project quota used up stops every YouTube account of the house until it resets', async () => {
    stats.state.youtube = 'quota';
    // Both YouTube posts are due again by then (one read every 6 hours, the older every day).
    const t = Date.now() + 40 * HOUR;
    const pass = await sweepHouse(a.address, { now: t });
    expect([pass.accounts['youtube-1'], pass.accounts['youtube-2']].sort()).toEqual(['backing off', 'slowed down']);
    const { backoff } = await loadResults(a.address);
    expect(backoff['app:youtube'].reason).toMatch(/every channel shares it/);
  });

  test('TikTok\'s 429 with Retry-After: the account waits exactly as long as it asked', async () => {
    tiktok.state.queryCode = 'rate_limit_exceeded';
    tiktok.state.queryRetryAfter = 120;
    const t = Date.now() + 60 * HOUR;
    expect((await sweepHouse(a.address, { now: t })).accounts['tiktok-1']).toBe('slowed down');
    const { backoff } = await loadResults(a.address);
    expect(Date.parse(backoff['tiktok-1'].until) - t).toBe(120000);
    tiktok.state.queryCode = 'ok';
  });

  test('another house reads none of it; the route shows the house its own, with what each platform can report', async () => {
    expect((await loadResults(b.address)).results).toEqual([]);
    expect((await sweepHouse(b.address)).accounts).toEqual({});
    const own = await request(app).get('/api/v1/marketing/results').set({ Authorization: `Bearer ${a.token}` });
    expect(own.status).toBe(200);
    // Every pass that found it due added one reading: the series is the trend.
    const views = own.body.posts['e-x'].series.map((s) => s.metrics.views);
    expect(views[0]).toBe(4100);
    expect(views.slice(1).every((v) => v === 5200)).toBe(true);
    expect(views.length).toBe((await loadResults(a.address)).results.filter((r) => r.entryId === 'e-x').length);
    expect(own.body.capability.linkedin.reads).toBe(false);
    const theirs = await request(app).get('/api/v1/marketing/results').set({ Authorization: `Bearer ${b.token}` });
    expect(theirs.body.posts).toEqual({});
  });
});
