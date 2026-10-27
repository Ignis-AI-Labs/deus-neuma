/* global fetch */
/**
 * TRACKED LINKS (campaign plan slice 7) — real tmp disk, the real sealed
 * credential store, the real queue and link map, real wallet auth on the real
 * routes, and real HTTP to the site counter's stand-in
 * (test/helpers/site-counter-stand-in.js, the Worker's own contract). No
 * double anywhere (RULE 0); the site token is a placeholder.
 *
 * Proven: a staged draft's trackable links become /go/<code> and the codes are
 * on the counter BEFORE the draft carries them; a link the counter would
 * refuse is left as written; following a code reaches its destination (our own
 * site with ?src=<code>, which the download counts); the house's map keeps each
 * code's post, campaign, angle, account and company, while the counter is
 * handed code + destination + company only; another house sees none of it and,
 * with no counter of its own, keeps its links as written and is told why; the
 * token never comes back from any route.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { startSiteCounterStandIn } from '../helpers/site-counter-stand-in.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { addAccount } from '../../backend/services/social/account-store.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { campaignContextFor } from '../../backend/services/marketing/campaign-context.js';
import { channelCredentialsPath } from '../../backend/services/social/account-store.js';
import socialChannelRouter from '../../backend/routes/social-channel-routes.js';
import linkRouter from '../../backend/routes/marketing-link-routes.js';

const TOKEN = 'ph-site-token-0123456789';
const ENV = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_CAMPAIGNS_PATH', 'NEUMA_CMO_PATH', 'NEUMA_SITE_COUNTER_ROOT'];

describe('tracked links: /go/<code>, published first, the house keeps the map', () => {
  let dir; let saved; let priorRealm; let app; let a; let b; let counter; let campaign;
  const as = (who) => ({ Authorization: `Bearer ${who.token}` });

  beforeAll(async () => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    dir = await fs.realpath(await createTempDir('tracked-links'));
    for (const [k, f] of [['NEUMA_SOCIAL_POST_QUEUE_PATH', 'queue.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'bindings.json'],
      ['NEUMA_SECTOR_CREW_PATH', 'crew.json'], ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'legacy-creds.json'],
      ['NEUMA_CAMPAIGNS_PATH', 'legacy-campaigns.json'], ['NEUMA_CMO_PATH', 'legacy-cmo.json']]) process.env[k] = path.join(dir, f);
    priorRealm = getRealmRoot();
    setRealmRoot(path.join(dir, 'realm'));
    counter = await startSiteCounterStandIn({ token: TOKEN });
    process.env.NEUMA_SITE_COUNTER_ROOT = counter.root;
    [a, b] = [await fullAuth(), await fullAuth()];
    await setHouseWorkspace(a.address, path.join(dir, 'ground'));
    await writeReadyBrandKit(path.join(dir, 'ground'), 'neuma');
    expect((await addAccount(a.address, 'x', { companyId: 'neuma' }, (await listCompanies(a.address)).map((c) => c.id))).accountId).toBe('x-1');
    campaign = await (await campaignStoreFor(a.address)).add({ name: 'Launch', companyId: 'neuma', angles: ['proof'], subs: [{ account: 'x-1' }] },
      await campaignContextFor(a.address), a.address);
    app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', socialChannelRouter);
    app.use('/api/v1/marketing/links', linkRouter);
  }, 60000);

  afterAll(async () => {
    await counter?.close();
    setRealmRoot(priorRealm);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('the house seals its site token; no route ever returns it', async () => {
    expect((await request(app).get('/api/v1/marketing/links').set(as(a))).body.site.configured).toBe(false);
    expect((await request(app).put('/api/v1/marketing/links/site-token').set(as(a)).send({ token: 'short' })).status).toBe(400);
    const saved = await request(app).put('/api/v1/marketing/links/site-token').set(as(a)).send({ token: TOKEN });
    expect(saved.status).toBe(200);
    expect(saved.body.site).toEqual({ configured: true, root: counter.root });
    const listed = await request(app).get('/api/v1/marketing/links').set(as(a));
    expect(JSON.stringify(listed.body)).not.toContain(TOKEN);
    // Sealed at rest: the store file never carries the value in the clear.
    expect(await fs.readFile(channelCredentialsPath(a.address), 'utf8')).not.toContain(TOKEN);
  });

  test('a staged draft carries /go/ links the counter already holds; a link it would refuse stays as written', async () => {
    const text = 'Get the build: https://deusneuma.ai/download/. Source: https://github.com/Ignis-AI-Labs/deus-neuma and notes at https://example.com/notes';
    const staged = await request(app).post('/api/v1/social-channels/queue').set(as(a))
      .send({ channelId: 'x', accountId: 'x-1', text, campaignId: campaign.id, angle: 'proof' });
    expect(staged.status).toBe(201);
    const { entry, links } = staged.body;
    expect(links.codes).toHaveLength(2);
    const [site, gh] = links.codes;
    expect(entry.text).toBe(`Get the build: ${counter.root}/go/${site}. Source: ${counter.root}/go/${gh} and notes at https://example.com/notes`);
    for (const code of links.codes) expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{6}$/);

    // On the counter: code, destination, company — nothing else.
    expect(counter.codes.get(site)).toEqual({ code: site, destination: 'https://deusneuma.ai/download/', company: 'neuma', createdAt: expect.any(String) });
    expect(Object.keys(counter.codes.get(gh)).sort()).toEqual(['code', 'company', 'createdAt', 'destination']);

    // In the house: the code's whole place.
    const map = (await request(app).get('/api/v1/marketing/links').set(as(a))).body.links;
    expect(map.find((r) => r.code === site)).toMatchObject({
      destination: 'https://deusneuma.ai/download/', entryId: entry.id, campaignId: campaign.id, angleId: 'proof',
      accountId: 'x-1', channelId: 'x', companyId: 'neuma', published: { state: 'published' },
    });
    const exported = (await request(app).get('/api/v1/marketing/links/export').set(as(a))).body;
    expect(exported.codes.map((c) => Object.keys(c).sort())).toEqual([['code', 'company', 'createdAt', 'destination'], ['code', 'company', 'createdAt', 'destination']]);

    // Following the code: our own site gets ?src=<code>, and the installer fetch it leads to counts.
    const hop = await fetch(`${counter.root}/go/${site}`, { redirect: 'manual' });
    expect(hop.status).toBe(302);
    expect(hop.headers.get('location')).toBe(`https://deusneuma.ai/download/?src=${site}`);
    await fetch(`${counter.root}/updates/Deus-Neuma.AppImage?src=${site}`);
    expect([...counter.counts.entries()].filter(([k]) => k.includes(site)).map(([k, n]) => [k.split('|')[0], n]).sort())
      .toEqual([['click', 1], ['download', 1]]);
    // Publishing again takes nothing new.
    expect((await request(app).post('/api/v1/marketing/links/publish').set(as(a))).body.results).toEqual([]);
  });

  test('another house sees none of it; with no counter of its own its links stay as written, and it is told why', async () => {
    expect((await request(app).get('/api/v1/marketing/links').set(as(b))).body).toEqual({ site: { configured: false, root: counter.root }, links: [] });
    const staged = await request(app).post('/api/v1/social-channels/queue').set(as(b))
      .send({ channelId: 'x', text: 'Get the build: https://deusneuma.ai/download/' });
    expect(staged.status).toBe(201);
    expect(staged.body.entry.text).toBe('Get the build: https://deusneuma.ai/download/');
    expect(staged.body.links).toEqual({ codes: [], note: 'its links are left as written and not counted: the site counter is not set up for this house' });
  });

  test('a counter that refuses (wrong token) leaves the links as written — a posted /go/ link always resolves', async () => {
    await request(app).put('/api/v1/marketing/links/site-token').set(as(b)).send({ token: 'ph-not-the-site-token-xyz' });
    const staged = await request(app).post('/api/v1/social-channels/queue').set(as(b))
      .send({ channelId: 'x', text: 'Read it: https://deusneuma.ai/research/' });
    expect(staged.body.entry.text).toBe('Read it: https://deusneuma.ai/research/');
    expect(staged.body.links.note).toMatch(/left as written.*Bearer/);
    expect((await request(app).get('/api/v1/marketing/links').set(as(b))).body.links).toEqual([]);
  });
});
