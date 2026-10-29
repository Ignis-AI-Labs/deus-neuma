/**
 * THE CMO PROPOSES A COMPANY'S LINKS; THE OPERATOR APPROVES EACH CHANGE —
 * proven on real stores on tmp disk, the REAL intent sweep, the REAL routes
 * (/api/v1/company-links, /api/v1/companies, /api/v1/waiting) over real
 * signed-wallet sessions, the REAL policy table and a REAL mandate. No double
 * (RULE 0).
 *
 *  - the seated CMO files marketing/company-links → ONE card in WAITING ON YOU
 *    and nothing written; DECLINE writes nothing; APPROVE writes through the
 *    company block's own door; a listed repo is lent to no one
 *  - refused before any card: http, a name inside the address, this machine,
 *    a private network, another house's company, a change already on record
 *  - only the seated CMO files it; a stranger house's CMO lands in its own
 *    house alone, and this house's operator cannot decide the stranger's
 *  - under an ACTIVE mandate it still asks
 *  - the surface: offered to the CMO seat alone, on demand; one briefing line
 */
/* global fetch */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';
import express from 'express';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaWorkspace } from '../../core/index.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { viaIntent } from '../helpers/intent-path.js';
import { pinSocialKeysEmpty } from '../helpers/no-social-keys.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';
import { addAccount } from '../../backend/services/social/account-store.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { readLinkChanges } from '../../backend/services/marketing/link-change-store.js';
import { grantMandate } from '../../backend/services/marketing/mandate/mandate-lifecycle.js';
import { readMandate } from '../../backend/services/marketing/mandate/mandate-store.js';
import { mandateStanding } from '../../backend/services/marketing/mandate/mandate-shape.js';
import { mandateRenderAccess } from '../../backend/services/marketing/mandate/mandate-act.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const TMP = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cmo-company-links-')));
const ENV = ['NEUMA_CMO_PATH', 'NEUMA_CAMPAIGNS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_LEAD_LEDGER_PATH'];
const saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), env: { ...process.env } };
const CMO = 'kestrel';
const PEER = 'heron';
const STRANGER_CMO = 'tern';
const ACT = 'marketing/company-links';
const PROPOSAL = Object.freeze({
  company: 'northwind',
  site: 'https://northwind.example',
  links: ['https://northwind.example/about'],
  repos: [{ remote: 'https://github.com/northwind/app', role: 'the app' }, { path: path.join(TMP, 'repos', 'northwind-site'), role: 'the website' }],
});

let house; let stranger; let server; let base;
const lane = (neumaId, walletAddress = house.address) => ({ walletAddress, companion: { name: neumaId, neumaId }, toolMode: 'ask' });
const file = async (connection, payload, mode = 'ask') => {
  const frames = [];
  const [receipt] = await viaIntent(connection, ACT, payload, mode, null, (f) => frames.push(f));
  return { receipt, frames };
};
const api = async (who, method, url) => {
  const res = await fetch(`${base}${url}`, {
    method, headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }),
  });
  return { status: res.status, body: await res.json() };
};
const northwind = async () => (await listCompanies(house.address)).find((c) => c.id === 'northwind');
const linkItems = async (who = house) => (await api(who, 'GET', '/api/v1/waiting')).body.items.filter((i) => i.kind === 'link-change');
const openChanges = async (wallet = house.address) => (await readLinkChanges(wallet)).filter((c) => c.status === 'open');

beforeAll(async () => {
  pinSocialKeysEmpty();
  setRealmRoot(path.join(TMP, 'realm'));
  setWorkspacesRoot(path.join(TMP, 'lanes'));
  for (const k of ENV) process.env[k] = path.join(TMP, `${k.toLowerCase()}.json`);
  [house, stranger] = [await fullAuth(), await fullAuth()];
  for (const [wallet, ground, kit] of [[house.address, 'a-ground', 'northwind'], [stranger.address, 'b-ground', 'harbor']]) {
    await setHouseWorkspace(wallet, path.join(TMP, ground));
    await writeReadyBrandKit(path.join(TMP, ground), kit);
  }
  expect((await addAccount(house.address, 'x', { companyId: 'northwind' }, ['northwind'])).ok).toBe(true);
  for (const [id, wallet] of [[CMO, house.address], [PEER, house.address], [STRANGER_CMO, stranger.address]]) await writeOwner(getWorkspacesRoot(), id, wallet);
  await cmoDesignation.designate(house.address, CMO);
  await cmoDesignation.designate(stranger.address, STRANGER_CMO);
  const { default: links } = await import('../../backend/routes/company-link-routes.js');
  const { default: companies } = await import('../../backend/routes/company-routes.js');
  const { default: waiting } = await import('../../backend/routes/waiting-routes.js');
  const web = express();
  web.use(express.json());
  web.use('/api/v1/company-links', links);
  web.use('/api/v1/companies', companies);
  web.use('/api/v1/waiting', waiting);
  server = http.createServer(web);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  setRealmRoot(saved.realm);
  setWorkspacesRoot(saved.lanes);
  for (const k of Object.keys(process.env)) if (!(k in saved.env)) delete process.env[k];
  Object.assign(process.env, saved.env);
  await fs.rm(TMP, { recursive: true, force: true });
});

describe('the CMO proposes; the operator decides in WAITING ON YOU', () => {
  test('filing raises ONE card showing the change, and writes nothing', async () => {
    const { receipt, frames } = await file(lane(CMO), PROPOSAL);
    expect(receipt).toMatchObject({ tool: 'intents/marketing.company-links', status: 'ok' });
    expect(receipt.content).toBe('Proposed the site, 1 page(s), 2 repo(s) for northwind — it waits on your operator in WAITING ON YOU; nothing changes until they approve.');
    // No chat card was raised: the WAITING card is the decision.
    expect(frames.map((f) => f.status)).toEqual(['executing', 'ok']);
    const company = await northwind();
    expect([company.site.url, company.site.links, company.repos]).toEqual([null, [], []]);
    const [item, ...more] = await linkItems();
    expect(more).toEqual([]);
    const change = (await openChanges())[0];
    expect(item).toMatchObject({
      id: `link-change:${change.id}`, kind: 'link-change', who: { laneId: CMO },
      title: `${company.name} links: site → northwind.example, +1 page, +2 repos`,
      where: { app: 'marketing', tab: 'brand', companyId: 'northwind', section: 'sources', changeId: change.id },
    });
    const listed = (await api(house, 'GET', '/api/v1/company-links')).body.changes;
    expect(listed.map((c) => c.rows.map((r) => [r.field, r.before, r.after]))).toEqual([[
      ['site', null, 'https://northwind.example'],
      ['link', null, 'https://northwind.example/about'],
      ['repo', null, { remote: 'https://github.com/northwind/app', role: 'the app' }],
      ['repo', null, { path: PROPOSAL.repos[1].path, role: 'the website' }],
    ]]);
  });

  test('a newer filing for the same company stands in place of the waiting one', async () => {
    const first = (await openChanges())[0];
    const { receipt } = await file(lane(CMO), { company: 'northwind', site: 'https://northwind.example' });
    expect(receipt.content).toContain('It replaces your earlier proposal for this company.');
    const all = await readLinkChanges(house.address);
    expect(all.find((c) => c.id === first.id).status).toBe('superseded');
    expect((await linkItems()).map((i) => i.title)).toEqual([`${(await northwind()).name} links: site → northwind.example`]);
  });

  test('DECLINE writes nothing, and the card is gone', async () => {
    const [change] = await openChanges();
    expect((await api(house, 'POST', `/api/v1/company-links/${change.id}/decline`)).status).toBe(200);
    expect((await northwind()).site.url).toBeNull();
    expect(await linkItems()).toEqual([]);
    expect((await api(house, 'POST', `/api/v1/company-links/${change.id}/decline`)).status).toBe(404);
    expect((await api(house, 'POST', `/api/v1/company-links/${change.id}/approve`)).status).toBe(404);
  });

  test('APPROVE writes it through the company block, keeps the rest, and lends no repo\'s reading', async () => {
    await file(lane(CMO), PROPOSAL);
    const [change] = await openChanges();
    const out = await api(house, 'POST', `/api/v1/company-links/${change.id}/approve`);
    expect(out.status).toBe(200);
    const company = await northwind();
    expect(company.site).toEqual({ url: 'https://northwind.example', links: ['https://northwind.example/about'] });
    expect(company.repos.map((r) => [r.remote, r.path, r.role])).toEqual([
      ['https://github.com/northwind/app', null, 'the app'], [null, PROPOSAL.repos[1].path, 'the website']]);
    expect(await linkItems()).toEqual([]);
    // Listing is not lending: the CMO's own policy holds no read of the new repo.
    const policy = await neumaWorkspace.readToolPolicy(CMO).catch(() => null);
    expect(policy?.pathGrants?.read || []).toEqual([]);
    const sources = (await api(house, 'GET', '/api/v1/companies/sources')).body;
    expect(sources.companies.find((c) => c.id === 'northwind').repos.map((r) => r.granted)).toEqual([false, false]);
    // The same change again is already on record: refused before any card.
    const again = await file(lane(CMO), PROPOSAL);
    expect(again.receipt.status).toBe('error');
    expect(again.receipt.error).toBe(`- ${company.name} already has all of that on record`);
  });
});

// An address with a fake name and password set, on an example domain. Written whole as one string, the
// public repository's push guard reads it as a leaked credential and holds every public sync (it did,
// 2026-10-24 → 25), so the test builds it.
const NAMED_SITE = Object.assign(new URL('https://northwind.example'), { username: 'ops', password: 'hunter2' }).href;

describe('refused before any card — every reason, nothing filed', () => {
  test('http, a name inside the address, this machine, a private network, another house\'s company', async () => {
    const before = (await readLinkChanges(house.address)).length;
    for (const [payload, why] of [
      [{ company: 'northwind', site: 'http://northwind.example' }, '- site: http://northwind.example must start with https://'],
      [{ company: 'northwind', site: NAMED_SITE }, '- site: a link never carries a name or password inside it'],
      [{ company: 'northwind', links: ['https://localhost:3333/api'] }, '- links[0]: localhost is this machine or a private network, not a public site'],
      [{ company: 'northwind', links: ['https://192.168.0.10'] }, '- links[0]: 192.168.0.10 is a bare address — a company link names its site'],
      [{ company: 'northwind', repos: [{ remote: 'https://gitlab.internal/x' }] }, '- repos[0].remote: gitlab.internal is this machine or a private network, not a public site'],
      [{ company: 'northwind', repos: [{ path: getWorkspacesRoot(), role: 'lanes' }] }, `- ${getWorkspacesRoot()}: that folder is inside the beings' lanes — no repo grant reaches there`],
      [{ company: 'harbor', site: 'https://harbor.example' }, '- there is no "harbor" company in this house'],
    ]) {
      const { receipt, frames } = await file(lane(CMO), payload);
      expect(receipt.status).toBe('error');
      expect(receipt.error).toBe(why);
      expect(frames.map((f) => [f.status, f.summary])).toEqual([['error', `${ACT} — invalid`]]);
    }
    expect((await readLinkChanges(house.address)).length).toBe(before);
  });

  test('only the seated CMO files it; a stranger house\'s CMO lands in its own house alone', async () => {
    const peer = await file(lane(PEER), { company: 'northwind', site: 'https://elsewhere.example' });
    expect(peer.receipt.status).toBe('denied');
    expect(peer.receipt.error).toContain('only the house\'s seated CMO');
    // This house's CMO lane under the stranger's wallet holds no seat there.
    expect((await file(lane(CMO, stranger.address), { company: 'harbor', site: 'https://h.example' })).receipt.status).toBe('denied');
    // The stranger's CMO naming this house's company finds none in its own.
    const reach = await file(lane(STRANGER_CMO, stranger.address), { company: 'northwind', site: 'https://hijack.example' });
    expect(reach.receipt.error).toBe('- there is no "northwind" company in this house');
    const own = await file(lane(STRANGER_CMO, stranger.address), { company: 'harbor', site: 'https://harbor.example' });
    expect(own.receipt.status).toBe('ok');
    const [theirs] = await openChanges(stranger.address);
    expect(theirs.companyId).toBe('harbor');
    expect(await linkItems()).toEqual([]);
    expect((await linkItems(stranger)).map((i) => i.where.companyId)).toEqual(['harbor']);
    // This house's operator cannot decide the stranger's proposal.
    expect((await api(house, 'POST', `/api/v1/company-links/${theirs.id}/approve`)).status).toBe(404);
    expect((await api(house, 'GET', '/api/v1/company-links')).body.changes).toEqual([]);
    expect((await listCompanies(stranger.address)).find((c) => c.id === 'harbor').site.url).toBeNull();
    expect((await openChanges(stranger.address)).map((c) => c.id)).toEqual([theirs.id]);
  });
});

describe('a mandate never answers it', () => {
  test('under an ACTIVE mandate (and in AUTO) the filing still waits on the operator', async () => {
    const granted = await grantMandate(house.address, { accounts: [{ id: 'x-1', pace: 2 }], acts: { posts: true, renders: true }, timeZone: 'UTC' });
    expect(granted.ok).toBe(true);
    expect(mandateStanding(await readMandate(house.address))).toBe('active');
    for (const mode of ['ask', 'auto']) {
      const { receipt } = await file(lane(CMO), { company: 'northwind', links: [`https://northwind.example/${mode}`] }, mode);
      expect(receipt.status).toBe('ok');
      expect(receipt.content).toContain('nothing changes until they approve');
      expect((await northwind()).site.links).toEqual(['https://northwind.example/about']);
      expect((await linkItems()).length).toBe(1);
    }
    // The mandate's door on the sweep leaves this row exactly as it found it.
    expect(await mandateRenderAccess(lane(CMO), 'approval_required', 'marketing.company-links', 'propose links')).toBe('approval_required');
  });
});

describe('the surface — the CMO seat alone, on demand', () => {
  test('offered to the seated CMO only; one briefing line', async () => {
    const offered = async (c) => { await intentSectionFor(c); return c._turnIntents.map((t) => t.name); };
    expect(await offered(lane(CMO))).toContain(ACT);
    for (const c of [lane(PEER), lane(CMO, stranger.address)]) expect(await offered(c)).not.toContain(ACT);
    const briefing = await __test._cmoBriefingSection(lane(CMO));
    expect(briefing.split('\n').filter((l) => l.includes('marketing/company-links'))).toEqual([
      'COMPANY LINKS: propose a company\'s site and links with marketing/company-links; your operator approves each change.',
    ]);
    expect(await __test._cmoBriefingSection(lane(PEER))).toBe('');
  });
});
