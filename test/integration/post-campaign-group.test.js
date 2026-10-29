/* global URL */
/**
 * POST ↔ CAMPAIGN (campaign plan slice 6) — on real tmp disk with the real
 * queue store, the real campaign bench, real wallet auth on the real routes,
 * and real HTTP to loopback platform stand-ins (X- and Mastodon-shaped);
 * placeholder keys only, nothing leaves the machine (RULE 0, no double).
 *
 * Proven: a staged post carries its campaign (resolved from a prefix), its
 * angle and its group; a draft on an account with no part in the campaign, a
 * group that would span two company trees, and a second post of a group on
 * one account are refused in words; APPROVE GROUP approves all three posts of
 * a group with ONE press, refuses when a copy moved since it was read, and
 * another house — even with the same group name — touches nothing; a sent
 * post keeps its address (built from X's id, and as Mastodon returns it);
 * leads keep the campaign and account they came through.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { addAccount, setAccountFields, setAppFields } from '../../backend/services/social/account-store.js';
import { listCompanies, setCompanyBlock } from '../../backend/services/marketing/companies.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { campaignContextFor } from '../../backend/services/marketing/campaign-context.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { publishEntry } from '../../backend/services/social/post-scheduler.js';
import socialChannelRouter from '../../backend/routes/social-channel-routes.js';
import socialGroupRouter from '../../backend/routes/social-group-routes.js';
import leadRouter from '../../backend/routes/lead-routes.js';

const ENV = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_X_API_ROOT', 'NEUMA_MASTODON_API_ROOT', 'NEUMA_CAMPAIGNS_PATH', 'NEUMA_CMO_PATH', 'NEUMA_LEAD_LEDGER_PATH'];
const X_POST_ID = '1850000000000000001';

describe('post ↔ campaign: angle, group, one-press group approval, the kept address', () => {
  let dir; let saved; let priorRealm; let app; let a; let b; let xServer; let mastodon; let campaign;
  const as = (who) => ({ Authorization: `Bearer ${who.token}` });

  beforeAll(async () => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    dir = await fs.realpath(await createTempDir('post-campaign'));
    for (const [k, f] of [['NEUMA_SOCIAL_POST_QUEUE_PATH', 'queue.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'bindings.json'],
      ['NEUMA_SECTOR_CREW_PATH', 'crew.json'], ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'legacy-creds.json'],
      ['NEUMA_CAMPAIGNS_PATH', 'legacy-campaigns.json'], ['NEUMA_CMO_PATH', 'legacy-cmo.json'], ['NEUMA_LEAD_LEDGER_PATH', 'legacy-leads.json']]) {
      process.env[k] = path.join(dir, f);
    }
    priorRealm = getRealmRoot();
    setRealmRoot(path.join(dir, 'realm'));
    [a, b] = [await fullAuth(), await fullAuth()];

    // House A: a core company with a subsidiary (one tree) and an unrelated client (its own tree).
    const ground = path.join(dir, 'ground');
    await setHouseWorkspace(a.address, ground);
    for (const kit of ['northwind', 'northwind-labs', 'brookmere']) await writeReadyBrandKit(ground, kit);
    expect((await setCompanyBlock(a.address, 'northwind-labs', { parentId: 'northwind' })).ok).toBe(true);
    const ids = (await listCompanies(a.address)).map((c) => c.id);
    for (const [channel, companyId] of [['x', 'northwind'], ['x', 'northwind-labs'], ['mastodon', 'northwind'], ['x', 'brookmere']]) {
      expect((await addAccount(a.address, channel, { companyId }, ids)).ok).toBe(true);
    }
    await setAppFields(a.address, 'x', { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
    await setAccountFields(a.address, 'x-1', { accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' });
    await setAccountFields(a.address, 'mastodon-1', { instanceUrl: 'social.example', accessToken: 'ph-mastodon-token' });
    campaign = await (await campaignStoreFor(a.address)).add({
      name: 'Launch Week', companyId: 'northwind', angles: [{ name: 'proof' }, { name: 'speed' }],
      subs: [{ account: 'x-1' }, { account: 'mastodon-1' }],
    }, await campaignContextFor(a.address), a.address);

    // X- and Mastodon-shaped stand-ins on loopback.
    xServer = http.createServer((req, res) => {
      const created = req.method === 'POST' && new URL(req.url, 'http://x').pathname === '/2/tweets';
      res.writeHead(created ? 201 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(created ? { data: { id: X_POST_ID, text: 'ok' } } : { data: { id: '101', username: 'northwind_x' } }));
    });
    mastodon = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: '109', url: 'https://social.example/@northwind/109' }));
    });
    await Promise.all([xServer, mastodon].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
    process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${xServer.address().port}/2`;
    process.env.NEUMA_MASTODON_API_ROOT = `http://127.0.0.1:${mastodon.address().port}`;

    app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', socialGroupRouter);
    app.use('/api/v1/social-channels', socialChannelRouter);
    app.use('/api/v1/leads', leadRouter);
  }, 60000);

  afterAll(async () => {
    await Promise.all([xServer, mastodon].map((s) => new Promise((r) => s?.close(r))));
    setRealmRoot(priorRealm);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(dir, { recursive: true, force: true });
  });

  const stage = (who, body) => request(app).post('/api/v1/social-channels/queue').set(as(who)).send(body);

  test('a staged post carries its campaign, angle and group; the wrong account, a second tree or a second post per account are refused', async () => {
    const posts = [];
    for (const [channelId, accountId] of [['x', 'x-1'], ['mastodon', 'mastodon-1']]) {
      const res = await stage(a, { channelId, accountId, text: `Only the harness changed (${accountId}).`, campaignId: campaign.id.slice(0, 8), angle: 'Proof', group: 'launch-clip' });
      expect(res.status).toBe(201);
      posts.push(res.body.entry);
    }
    for (const p of posts) expect(p).toMatchObject({ campaignId: campaign.id, angleId: 'proof', pillar: 'proof', groupId: 'launch-clip', status: 'draft' });
    // The subsidiary's account joins the same group (one tree), outside the core company's campaign.
    const labs = await stage(a, { channelId: 'x', accountId: 'x-2', text: 'Only the harness changed (labs).', group: 'launch-clip' });
    expect(labs.status).toBe(201);
    expect(labs.body.entry).toMatchObject({ groupId: 'launch-clip', campaignId: null });

    const offCampaign = await stage(a, { channelId: 'x', accountId: 'x-3', text: 'client copy', campaignId: campaign.id, angle: 'proof' });
    expect(offCampaign.status).toBe(400);
    expect(offCampaign.body.error).toBe(`x-3 has no part in "Launch Week" — its sub-campaigns run on x-1, mastodon-1`);
    const noAngle = await stage(a, { channelId: 'x', accountId: 'x-1', text: 'x', campaignId: campaign.id, angle: 'vibes' });
    expect(noAngle.body.error).toMatch(/no angle "vibes" — its angles: proof, speed/);

    expect((await stage(a, { channelId: 'x', accountId: 'x-1', text: 'tree one', group: 'tree-test' })).status).toBe(201);
    const crossed = await stage(a, { channelId: 'x', accountId: 'x-3', text: 'tree two', group: 'tree-test' });
    expect(crossed.status).toBe(400);
    expect(crossed.body.error).toMatch(/never spans two trees/);
    const twice = await stage(a, { channelId: 'x', accountId: 'x-1', text: 'again', campaignId: campaign.id, group: 'launch-clip' });
    expect(twice.status).toBe(400);
    expect(twice.body.error).toMatch(/x-1 already carries group "launch-clip"/);
  });

  test('APPROVE GROUP: one press approves the three — refused when a copy moved; another house touches nothing', async () => {
    const group = (await postQueue.load()).filter((e) => e.groupId === 'launch-clip');
    expect(group).toHaveLength(3);
    const seen = Object.fromEntries(group.map((e) => [e.id, e.text]));

    // House B, same group name: nothing of A's is its to approve.
    const strange = await request(app).put('/api/v1/social-channels/queue/groups/launch-clip/approve').set(as(b)).send({ textsSeen: seen });
    expect(strange.status).toBe(404);
    expect((await postQueue.load()).filter((e) => e.groupId === 'launch-clip').every((e) => e.status === 'draft')).toBe(true);

    const stale = await request(app).put('/api/v1/social-channels/queue/groups/launch-clip/approve').set(as(a))
      .send({ textsSeen: { ...seen, [group[1].id]: 'a copy I never read' } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe(`the post on ${group[1].accountId} changed since you read it — nothing in the group was approved; read it again`);
    expect((await postQueue.load()).filter((e) => e.groupId === 'launch-clip').every((e) => e.status === 'draft')).toBe(true);

    const pressed = await request(app).put('/api/v1/social-channels/queue/groups/launch-clip/approve').set(as(a)).send({ textsSeen: seen });
    expect(pressed.status).toBe(200);
    expect(pressed.body.ownCard).toEqual([]);
    expect(pressed.body.entries.map((e) => e.accountId).sort()).toEqual(['mastodon-1', 'x-1', 'x-2']);
    const after = (await postQueue.load()).filter((e) => e.groupId === 'launch-clip');
    for (const e of after) {
      expect(e.status).toBe('approved');
      expect(e.decidedBy.toLowerCase()).toBe(a.address.toLowerCase());
    }
  });

  test('a sent post keeps its address: built from X\'s id, and as Mastodon returns it', async () => {
    const group = (await postQueue.load()).filter((e) => e.groupId === 'launch-clip');
    for (const accountId of ['x-1', 'mastodon-1']) {
      const entry = group.find((e) => e.accountId === accountId);
      const claimed = await postQueue.claimForSend(entry.id);
      expect(claimed.ok).toBe(true);
      const outcome = await publishEntry(claimed.entry);
      expect(outcome.ok).toBe(true);
    }
    const sent = (await postQueue.load()).filter((e) => e.groupId === 'launch-clip' && e.status === 'sent');
    expect(Object.fromEntries(sent.map((e) => [e.accountId, e.url]))).toEqual({
      'x-1': `https://x.com/i/status/${X_POST_ID}`,
      'mastodon-1': 'https://social.example/@northwind/109',
    });
    // Its place in the campaign rides the sent record untouched.
    expect(sent.every((e) => e.campaignId === campaign.id && e.angleId === 'proof')).toBe(true);
    expect(sent).toHaveLength(2);
  });

  test('a lead keeps the campaign and the account it came through; both can be set later', async () => {
    const made = await request(app).post('/api/v1/leads').set(as(a)).send({ name: 'Real Prospect', campaignId: campaign.id, accountId: 'x-1' });
    expect(made.status).toBe(201);
    expect(made.body.lead).toMatchObject({ campaignId: campaign.id, accountId: 'x-1' });
    const moved = await request(app).put(`/api/v1/leads/${made.body.lead.id}`).set(as(a)).send({ accountId: 'mastodon-1' });
    expect(moved.body.lead).toMatchObject({ campaignId: campaign.id, accountId: 'mastodon-1' });
    expect((await request(app).post('/api/v1/leads').set(as(a)).send({ name: 'X', accountId: 'not an account' })).status).toBe(400);
  });
});
