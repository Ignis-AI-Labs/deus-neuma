/**
 * LEGAL ON EVERY DRAFT — the claims check over a house's real drafts, the
 * matters it files with the CLO office, the LEGAL flag on the desk's queue
 * read, and the AI disclosure line at staging (campaign plan slice 12). Real
 * tmp disk, the real queue store, the real account store and brand kits, the
 * real matter ledger, the real reply record, the real queue route over a
 * real signed-wallet session. No double anywhere (RULE 0); no social key.
 *
 * Proven: a being's draft carries "Made with AI." and the line counts
 * against X's 280; an edit cannot drop it; the operator's own text-only
 * words carry none; […] files ONE campaign-review matter for
 * the account's company, with citations' starting points, and a second
 * review files nothing; an edit that adds a NEVER ASSERTED claim files a new,
 * high matter; a reply that speaks of a lawsuit files a matter too; another
 * house's ledger holds none of it; the queue read carries the LEGAL flag with
 * the matter's standing, and approval is untouched (the check flags, never
 * holds).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import process from 'process';
import express from 'express';
import request from 'supertest';
import { standTwoHouses, HOUSE_B } from '../helpers/house-office-kit.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { writeKit, kitSkeleton } from '../../backend/services/branding/kit-store.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';
import { setAccountMeta } from '../../backend/services/social/account-store.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { replyCandidatesOf } from '../../backend/services/social/reply-candidates.js';
import { matterLedgerFor } from '../../backend/services/legal/matter-ledger.js';
import { reviewHouseDrafts, withLegalFlags } from '../../backend/services/marketing/draft-review.js';
import { houseEntries } from '../../backend/services/social/queue-house.js';
import channelRouter from '../../backend/routes/social-channel-routes.js';

const LINE = '\n\nMade with AI.';
const DOORS = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH'];

let houses;
let auth;
let app;
let saved;

beforeAll(async () => {
  saved = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
  houses = await standTwoHouses({ label: 'campaign-claims-review', lanesA: [], lanesB: [] });
  auth = await fullAuth();
  // Both houses' lanes on the one served ground.
  await writeOwner(houses.rootA, 'alpha-cmo', auth.address);
  await writeOwner(houses.rootA, 'beta-cmo', HOUSE_B);
  for (const [door, name] of [['NEUMA_SOCIAL_POST_QUEUE_PATH', 'social-post-queue.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'social-channel-bindings.json'],
    ['NEUMA_SECTOR_CREW_PATH', 'sector-crew.json'], ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'social-channel-credentials.json']]) {
    process.env[door] = path.join(houses.settings, name);
  }
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  // House A's own company, with its claims lists.
  await setHouseWorkspace(auth.address, path.join(houses.tmp, 'ground-a'));
  const kit = { ...kitSkeleton('acme', { name: 'Acme' }), claims: { approved: ['runs 100% on your own machine'], forbidden: ['clinically proven'] } };
  expect((await writeKit('acme', auth.address, kit)).ok).toBe(true);
  const companies = (await listCompanies(auth.address)).map((c) => c.id);
  expect((await setAccountMeta(auth.address, 'x-1', { companyId: 'acme' }, companies)).ok).toBe(true);
  app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', channelRouter);
});

afterAll(() => {
  houses.restore();
  for (const k of DOORS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const stage = (text, extra = {}) => postQueue.add({
  channelId: 'x', accountId: 'x-1', text, authorNeumaId: 'alpha-cmo', queuedBy: 'alpha-cmo', ...extra,
});
const ledgerOf = async (wallet) => (await matterLedgerFor(wallet)).load();

describe('the disclosure line at staging', () => {
  test('a being\'s words carry it, the line counts against X, an edit keeps it, the operator\'s own words carry none', async () => {
    const draft = await stage('We shipped the new desk.');
    expect(draft.text).toBe(`We shipped the new desk.${LINE}`);
    const edited = await postQueue.update(draft.id, { text: 'We shipped the new desk today.' }, { by: 'alpha-cmo' });
    expect(edited).toMatchObject({ ok: true, entry: { text: `We shipped the new desk today.${LINE}` } });
    // An edit that tries to drop the line gets it back.
    const dropped = await postQueue.update(draft.id, { text: 'We shipped it.' }, { by: 'alpha-cmo' });
    expect(dropped.entry.text).toBe(`We shipped it.${LINE}`);
    await expect(stage('a'.repeat(270))).rejects.toThrow('the post is 270 characters and the disclosure line "Made with AI." adds 15 — X (Twitter) allows at most 280');
    const own = await postQueue.add({ channelId: 'x', text: 'Typed by the operator.', authorNeumaId: null, queuedBy: auth.address });
    expect(own.text).toBe('Typed by the operator.');
  });
});

describe('the claims check files with the legal office', () => {
  test('one matter per draft and claim set, for the account\'s company; never twice; never in another house', async () => {
    const claim = await stage('Neuma is 3x faster than X.');
    const plain = await stage('A quiet note about the week.');
    const before = (await ledgerOf(auth.address)).length;

    const filed = await reviewHouseDrafts(auth.address);
    const mine = filed.filter((m) => m.externalId.startsWith(`draft:${claim.id}:`));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ area: 'marketing', source: 'campaign-review', companyId: 'acme', severity: 'medium', status: 'new' });
    expect(mine[0].title).toBe('A x draft for Acme makes 2 claim(s) to check');
    expect(mine[0].regimes.join(' ')).toMatch(/FTC Act §5/);
    expect(filed.some((m) => m.externalId.includes(plain.id))).toBe(false);
    expect(await reviewHouseDrafts(auth.address)).toEqual([]);
    expect((await ledgerOf(auth.address)).length).toBe(before + filed.length);
    expect(await reviewHouseDrafts(HOUSE_B)).toEqual([]);
    expect(await ledgerOf(HOUSE_B)).toEqual([]);

    // An edit that adds a NEVER ASSERTED claim is a new, high matter.
    await postQueue.update(claim.id, { text: 'Neuma is 3x faster than X. Clinically proven.' }, { by: 'alpha-cmo' });
    const again = await reviewHouseDrafts(auth.address);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ severity: 'high', companyId: 'acme' });
    expect(again[0].summary).toContain('NEVER ASSERTED');
  });

  test('a reply that speaks of a lawsuit files a matter; the other house\'s record files none', async () => {
    await replyCandidatesOf(auth.address).add({ postId: '1850000000000000001', username: 'angry_user', text: 'My lawyer will sue you over this.' });
    await replyCandidatesOf(HOUSE_B).add({ postId: '1850000000000000002', username: 'calm_user', text: 'Lovely work, thank you.' });
    const filed = await reviewHouseDrafts(auth.address);
    expect(filed.map((m) => m.externalId)).toEqual(['reply:1850000000000000001']);
    expect(filed[0]).toMatchObject({ severity: 'high', title: 'A reply to the house from @angry_user speaks of legal action' });
    expect(await reviewHouseDrafts(HOUSE_B)).toEqual([]);
  });

  test('the queue read carries the LEGAL flag and the matter\'s standing; approval is untouched', async () => {
    const approved = 'Runs 100% on your own machine.';
    const kitWords = await stage(approved);
    const flagged = await withLegalFlags(await houseEntries(auth.address), auth.address);
    const onKit = flagged.find((e) => e.id === kitWords.id);
    expect(onKit.legal).toMatchObject({ open: 0, matter: null });
    expect(onKit.legal.hits[0]).toMatchObject({ kind: 'figure', match: '100%', approved: true });

    const res = await request(app).get('/api/v1/social-channels/queue').set({ Authorization: `Bearer ${auth.token}` });
    expect(res.status).toBe(200);
    const claim = res.body.queue.find((e) => e.text.startsWith('Neuma is 3x faster than X. Clinically proven.'));
    // figure, comparison, the NEVER ASSERTED claim, and the health word inside it
    expect(claim.legal).toMatchObject({ open: 4, severity: 'high', matter: { status: 'new' } });
    expect(claim.status).toBe('draft');
    // The other house's queue read sees none of house A's posts.
    expect(res.body.queue.every((e) => e.queuedBy !== 'beta-cmo')).toBe(true);
  });
});
