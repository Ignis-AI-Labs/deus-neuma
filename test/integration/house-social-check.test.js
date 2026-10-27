/**
 * THE HOUSE SOCIAL CHECK — every account the house uses, checked and rolled
 * up per company → tree → house, the rest OPTIONAL (campaign plan slice 11).
 * Real tmp disk: the real account store, bindings, crews, brand kits, queue
 * and keys file; a real loopback X answering /2/users/me as whoever the
 * signed token is; the real route over a real signed-wallet session; the real
 * being read. No double anywhere (RULE 0); placeholder keys only.
 *
 * Proven: the clear account reads clear on every check; a wrong expected
 * handle reads red with the fix in words; an UNSORTED account reads red; an
 * unused account and every unconnected platform stand OPTIONAL and never
 * count; the tree rolls up its own companies only; the same X user connected
 * in another house is caught (naming no house); a keys file opened to 0644
 * reads red; a waiting post without the disclosure line reads red; no key
 * value ever leaves; and the being's read says the same in words.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import process from 'process';
import express from 'express';
import request from 'supertest';
import { standTwoHouses, HOUSE_B } from '../helpers/house-office-kit.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { writeKit, kitSkeleton } from '../../backend/services/branding/kit-store.js';
import { listCompanies, setCompanyBlock } from '../../backend/services/marketing/companies.js';
import {
  addAccount, setAccountFields, setAppFields, setAccountMeta, channelCredentialsPath,
} from '../../backend/services/social/account-store.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { sectorCrew } from '../../backend/services/sector-crew.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { runHouseCheck } from '../../backend/services/social/house-check/house-check-facts.js';
import { formatHouseCheckForBeing } from '../../backend/services/social/house-check/house-check-words.js';
import accountRouter from '../../backend/routes/social-account-routes.js';

const X_APP = Object.freeze({ apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
const X_USERS = Object.freeze({
  'ph-x-token-1': { id: '101', username: 'core_voice' },
  'ph-x-token-2': { id: '202', username: 'sub_voice' },
});
const DOORS = ['NEUMA_X_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH'];
const valuesOf = (o) => JSON.stringify(o).match(/ph-[a-z0-9-]+/g) || [];

let houses;
let auth;
let app;
let xServer;
let saved;

beforeAll(async () => {
  saved = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
  xServer = http.createServer((req, res) => {
    const signed = /oauth_token="([^"]+)"/.exec(req.headers.authorization || '')?.[1];
    const user = X_USERS[signed ? decodeURIComponent(signed) : ''];
    res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user ? { data: user } : { detail: 'Unauthorized' }));
  });
  await new Promise((r) => xServer.listen(0, '127.0.0.1', r));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${xServer.address().port}/2`;

  houses = await standTwoHouses({ label: 'house-social-check', lanesA: [], lanesB: [] });
  for (const [door, name] of [['NEUMA_SOCIAL_POST_QUEUE_PATH', 'social-post-queue.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'social-channel-bindings.json'],
    ['NEUMA_SECTOR_CREW_PATH', 'sector-crew.json'], ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'social-channel-credentials.json']]) {
    process.env[door] = path.join(houses.settings, name);
  }
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  auth = await fullAuth();
  const A = auth.address;
  for (const lane of ['core-cmo', 'sub-cmo', 'drafter']) await writeOwner(houses.rootA, lane, A);
  await writeOwner(houses.rootA, 'beta-cmo', HOUSE_B);

  // Two trees: ignis heads umbrae; acme-client stands alone.
  await setHouseWorkspace(A, path.join(houses.tmp, 'ground-a'));
  expect((await writeKit('acme-client', A, kitSkeleton('acme-client', { name: 'Acme Client' }))).ok).toBe(true);
  expect((await setCompanyBlock(A, 'ignis', { site: { url: 'https://example.com/ignis', links: [] } })).ok).toBe(true);
  expect((await setCompanyBlock(A, 'umbrae', { parentId: 'ignis', site: { url: 'https://example.com/umbrae', links: [] } })).ok).toBe(true);
  const companies = (await listCompanies(A)).map((c) => c.id);

  // x-1: the clear one. x-2: keys speak as @sub_voice, recorded as another.
  // x-3: held, no company, no keys. x-4: nothing at all (OPTIONAL).
  await setAppFields(A, 'x', X_APP);
  await setAccountMeta(A, 'x-1', { companyId: 'ignis', expectedHandle: 'core_voice' }, companies);
  await setAccountFields(A, 'x-1', { accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' });
  const two = await addAccount(A, 'x', { companyId: 'umbrae', expectedHandle: 'wrong_handle' }, companies);
  await setAccountFields(A, two.accountId, { accessToken: 'ph-x-token-2', accessSecret: 'ph-x-secret-2' });
  await addAccount(A, 'x', {}, companies);
  await addAccount(A, 'x', { companyId: 'acme-client' }, companies);
  await channelBindings.bind(A, 'x-1', { neumaId: 'core-cmo' });
  await channelBindings.bind(A, 'x-2', { neumaId: 'sub-cmo' });
  await channelBindings.bind(A, 'x-3', { neumaId: 'drafter' });
  await sectorCrew.add(A, 'x-1', { neumaId: 'drafter', kind: 'neuma', remit: 'threads' });

  // House B connects the same X user as house A's x-2.
  await setAppFields(HOUSE_B, 'x', X_APP);
  await setAccountFields(HOUSE_B, 'x-1', { accessToken: 'ph-x-token-2', accessSecret: 'ph-x-secret-2' });

  // A being's draft on x-1 carries the line; a pre-line draft on x-2 does not.
  await postQueue.add({ channelId: 'x', accountId: 'x-1', text: 'The week, in one line.', authorNeumaId: 'core-cmo', queuedBy: 'core-cmo' });
  const queue = JSON.parse(await fs.readFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, 'utf8'));
  queue.push({
    id: 'aaaabbbbccccdddd', channelId: 'x', accountId: 'x-2', text: 'Written before the line.', scheduledFor: null,
    campaignId: null, pillar: '', media: [], authorNeumaId: 'sub-cmo', queuedBy: 'sub-cmo', status: 'draft', createdAt: new Date().toISOString(),
  });
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, JSON.stringify(queue));

  app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', accountRouter);
});

afterAll(async () => {
  houses.restore();
  for (const k of DOORS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await new Promise((r) => xServer.close(r));
});

const verdicts = (row) => Object.fromEntries(row.checks.map((c) => [c.id, c.verdict]));
const checkOf = (row, id) => row.checks.find((c) => c.id === id);

describe('the house social check (real disk, real loopback X, real route)', () => {
  test('one clear, two red, the rest OPTIONAL; rolled up per company and tree; nothing secret leaves', async () => {
    expect((await request(app).get('/api/v1/social-channels/accounts/house-check')).status).toBe(401);
    const res = await request(app).get('/api/v1/social-channels/accounts/house-check?fresh=1').set({ Authorization: `Bearer ${auth.token}` });
    expect(res.status).toBe(200);
    const { check } = res.body;
    expect(valuesOf(check)).toEqual([]);
    // 3 in use (x-1, x-2, x-3); x-4 and the eight unconnected platforms are OPTIONAL.
    expect(check.house).toEqual({ clear: 1, total: 3, optional: 9 });
    expect(check.headline).toBe('1 OF 3 ACCOUNTS CLEAR · 9 OPTIONAL');
    expect(check.optional.accounts).toEqual(['x-4']);
    expect(check.optional.platforms).toHaveLength(8);

    const [x1, x2, x3] = ['x-1', 'x-2', 'x-3'].map((id) => check.accounts.find((a) => a.id === id));
    expect(x1).toMatchObject({ inUse: true, clear: true, handle: '@core_voice' });
    expect(verdicts(x1)).toEqual({
      keys: 'pass', live: 'pass', 'right-account': 'pass', company: 'pass', holder: 'pass', crew: 'pass',
      scopes: 'na', token: 'na', 'not-shared': 'pass', file: 'pass', disclosure: 'pass', site: 'pass', quota: 'pass',
    });

    // The wrong expected handle reads red, with the fix in plain words.
    expect(x2.clear).toBe(false);
    expect(checkOf(x2, 'right-account')).toMatchObject({ verdict: 'fail', words: 'The keys speak as @sub_voice, not @wrong_handle.' });
    expect(checkOf(x2, 'right-account').fix).toMatchObject({
      title: 'Fix the keys or @handle', words: expect.stringMatching(/Replace the keys/),
      door: { kind: 'handle', channelId: 'x', accountId: 'x-2', seen: 'sub_voice' },
    });
    // The pre-line draft's fix lands on that post, and its holder — a lane of THIS house, keyed — may take it.
    expect(checkOf(x2, 'disclosure').fix).toMatchObject({
      title: 'Add the AI line', door: { kind: 'queue', channelId: 'x', accountId: 'x-2', entryId: 'aaaabbbbccccdddd' },
      handTo: { neumaId: 'sub-cmo', role: 'holder', prompt: expect.stringContaining('aaaabbbbccccdddd') },
    });
    // Sharing with another house is the operator's to settle: a door, never a hand-over.
    expect(checkOf(x2, 'not-shared').fix).toMatchObject({ title: 'Remove the duplicate', door: { kind: 'keys', accountId: 'x-2' } });
    expect(checkOf(x2, 'not-shared').fix.handTo).toBeUndefined();
    // The same X user is connected in another house — said, never named.
    expect(checkOf(x2, 'not-shared')).toMatchObject({ verdict: 'fail' });
    expect(checkOf(x2, 'not-shared').words).toContain('another house on this machine connects the same account');
    expect(checkOf(x2, 'not-shared').words).not.toContain(HOUSE_B);
    expect(checkOf(x2, 'disclosure')).toMatchObject({ verdict: 'fail', detail: 'aaaabbbbccccdddd' });

    // UNSORTED reads red; it stands apart from every tree.
    expect(checkOf(x3, 'company')).toMatchObject({ verdict: 'fail', words: 'It belongs to no company (UNSORTED).' });
    expect(checkOf(x3, 'company').fix).toMatchObject({ title: 'Pick its company', door: { kind: 'keys', accountId: 'x-3' } });
    expect(checkOf(x3, 'keys').verdict).toBe('fail');
    expect(checkOf(x3, 'keys').fix.handTo).toBeUndefined();
    expect(check.unsorted).toEqual({ clear: 0, total: 1, accounts: ['x-3'] });

    const tree = (id) => check.trees.find((t) => t.rootId === id);
    expect(tree('ignis')).toMatchObject({ clear: 1, total: 2, companies: ['ignis', 'umbrae'] });
    expect(tree('acme-client')).toMatchObject({ clear: 0, total: 0, companies: ['acme-client'] });
    expect(check.companies.find((c) => c.id === 'umbrae')).toMatchObject({ clear: 0, total: 1, depth: 1, accounts: ['x-2'] });
  });

  test('the other house sees only its own; a keys file opened up reads red', async () => {
    await fs.chmod(channelCredentialsPath(HOUSE_B), 0o644);
    const theirs = await runHouseCheck(HOUSE_B, { fresh: true });
    expect(theirs.accounts.map((a) => a.id)).toEqual(['x-1']);
    const [x1] = theirs.accounts;
    expect(checkOf(x1, 'file')).toMatchObject({ verdict: 'fail', words: 'The house\'s keys file can be read by more than its owner.' });
    expect(checkOf(x1, 'file').fix).toMatchObject({ title: 'Lock the keys file', door: { kind: 'keys', channelId: null, accountId: null } });
    expect(checkOf(x1, 'not-shared').verdict).toBe('fail');
    expect(checkOf(x1, 'company').verdict).toBe('fail');
    await fs.chmod(channelCredentialsPath(HOUSE_B), 0o600);
  });

  test('without the live probes, identity reads NOT PROVEN — never a pass; the being reads it in words', async () => {
    const offline = await runHouseCheck(auth.address, { probes: false });
    const x1 = offline.accounts.find((a) => a.id === 'x-1');
    expect(checkOf(x1, 'live').verdict).toBe('unknown');
    expect(checkOf(x1, 'right-account').verdict).toBe('unknown');
    expect(x1.clear).toBe(false);

    const words = formatHouseCheckForBeing(await runHouseCheck(auth.address, { fresh: true }));
    expect(words).toContain('## HOUSE SOCIAL CHECK — 1 OF 3 ACCOUNTS CLEAR · 9 OPTIONAL');
    expect(words).toContain('FAIL The right account — The keys speak as @sub_voice, not @wrong_handle. FIX: Replace the keys');
    expect(words).toContain('UNSORTED (no company): x-3');
    expect(words).toContain('OPTIONAL (not counted): accounts not in use x-4');
    expect(valuesOf(words)).toEqual([]);
  });
});
