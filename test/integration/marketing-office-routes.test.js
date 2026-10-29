/**
 * /api/v1/marketing/office (the board's new panels' own reads) and the board
 * route with the slice-4 kinds — over the REAL access guard: two operators who
 * each sign a real wallet challenge, their houses on a tmp realm with real
 * brand kits (companies), real accounts, a real CMO seat on a real lane, a
 * REAL git repository made here (dated commits, changelog fragments, release
 * notes, a key-shaped line) and the CMO's real read grant on it. No double
 * (RULE 0).
 *
 * Proven: unsigned is 401; the plan (and the CMO's board record) reads null
 * until there is one, and each house reads only its own; COMPANY WATCH reads the company's repo with the
 * seated CMO's own grant — newest first, each row its source, a secret-shaped
 * line held back — says why for a repo not granted, and the other house, with
 * a company of the SAME id, never sees the first house's repo; a board with
 * the new kinds saves whole, and one naming a metric the platform does not
 * report, or another house's account, writes nothing and names why.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { setCompanyRepos, listCompanies } from '../../backend/services/marketing/companies.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { grantRepoRead } from '../../backend/services/marketing/company-repo-grants.js';
import { weeklyPlanStoreFor } from '../../backend/services/marketing/weekly-plan.js';
import { boardStoreFor } from '../../backend/services/marketing/board-store.js';
import { addAccount } from '../../backend/services/social/account-store.js';
import { CAPABILITY } from '../../backend/services/social/stats/stats-metrics.js';
import officeRouter from '../../backend/routes/marketing-office-routes.js';
import boardRouter from '../../backend/routes/marketing-board-routes.js';

const run = promisify(execFile);
// Built at run time so no key-shaped string sits in this file itself.
const FAKE_KEY = `sk-${'ant-'}${'q'.repeat(36)}`;
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');

// impure — commit `files` in `dir` at `when`; returns the sha.
const commitAt = async (dir, when, subject, files) => {
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  }
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  await run('git', ['add', '-A'], { cwd: dir, env });
  await run('git', ['commit', '-q', '-m', subject], { cwd: dir, env });
  return (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
};

describe('the board\'s own reads (/api/v1/marketing/office) and the new kinds on the board route', () => {
  let tmp; let saved; let app; let a; let b; let repo; let site; let shas;
  const as = (who) => ({ Authorization: `Bearer ${who.token}` });

  beforeAll(async () => {
    tmp = await fs.realpath(await createTempDir('marketing-office-routes'));
    saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), cmo: process.env.NEUMA_CMO_PATH, plan: process.env.NEUMA_WEEKLY_PLAN_PATH };
    process.env.NEUMA_CMO_PATH = path.join(tmp, 'legacy-cmo.json');
    process.env.NEUMA_WEEKLY_PLAN_PATH = path.join(tmp, 'legacy-plan.json');
    setRealmRoot(path.join(tmp, 'realm'));
    setWorkspacesRoot(path.join(tmp, 'lanes'));
    [a, b] = [await fullAuth(), await fullAuth()];
    // Both houses keep a company with the SAME id — the houses must never be confused.
    for (const [who, kits] of [[a, ['northwind', 'brookmere']], [b, ['northwind']]]) {
      await setHouseWorkspace(who.address, path.join(tmp, `ground-${who.address.slice(2, 8)}`));
      for (const kit of kits) await writeReadyBrandKit(path.join(tmp, `ground-${who.address.slice(2, 8)}`), kit);
    }
    await writeOwner(path.join(tmp, 'lanes'), 'kestrel', a.address);
    await writeOwner(path.join(tmp, 'lanes'), 'heron', b.address);
    await cmoDesignation.designate(a.address, 'kestrel');
    await cmoDesignation.designate(b.address, 'heron');

    repo = path.join(tmp, 'repos', 'northwind');
    site = path.join(tmp, 'repos', 'northwind-site');
    for (const dir of [repo, site]) { await fs.mkdir(dir, { recursive: true }); await run('git', ['init', '-q', dir]); }
    shas = {
      old: await commitAt(repo, ago(60), 'chore: the first commit', { 'README.md': '# Northwind\n' }),
      fix: await commitAt(repo, ago(3), 'fix(seal): the seal no longer stalls', { 'changelog.d/seal.md': 'Fixed\n- The seal no longer stalls on a slow disk.\n' }),
      key: await commitAt(repo, ago(2), 'chore: rotate a key', { 'notes.md': `the old key was ${FAKE_KEY}\n` }),
      release: await commitAt(repo, ago(1), 'docs: release notes 0.3.0', { 'docs/operations/release-notes-0.3.0.md': '# 0.3.0\n' }),
    };
    await commitAt(site, ago(1), 'feat: the new landing page', { 'index.html': '<h1>Northwind</h1>\n' });
    expect((await setCompanyRepos(a.address, 'northwind', [
      { path: repo, remote: 'https://github.com/northwind/app', role: 'the app' }, { path: site, role: 'the website' },
    ])).ok).toBe(true);
    expect((await grantRepoRead(a.address, 'northwind', repo)).ok).toBe(true);
    const ids = (await listCompanies(a.address)).map((c) => c.id);
    for (const [ch, companyId] of [['x', 'northwind'], ['telegram', 'brookmere']]) expect((await addAccount(a.address, ch, { companyId }, ids)).ok).toBe(true);
    expect((await addAccount(b.address, 'bluesky', { companyId: 'northwind' }, ['northwind'])).ok).toBe(true);

    app = express();
    app.use(express.json());
    app.use('/api/v1/marketing/office', officeRouter);
    app.use('/api/v1/marketing/board', boardRouter);
  }, 60000);

  afterAll(async () => {
    setRealmRoot(saved.realm);
    setWorkspacesRoot(saved.lanes);
    for (const [k, v] of [['NEUMA_CMO_PATH', saved.cmo], ['NEUMA_WEEKLY_PLAN_PATH', saved.plan]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('unsigned is refused; a malformed company id is refused before any read', async () => {
    expect((await request(app).get('/api/v1/marketing/office/plan')).status).toBe(401);
    expect((await request(app).get('/api/v1/marketing/office/watch/northwind')).status).toBe(401);
    expect((await request(app).get('/api/v1/marketing/office/watch/North%20Wind').set(as(a))).status).toBe(400);
  });

  test('the weekly plan and the CMO\'s board record: null until there is one; each house reads its own', async () => {
    expect((await request(app).get('/api/v1/marketing/office/plan').set(as(a))).body).toEqual({ plan: null, board: null });
    await (await weeklyPlanStoreFor(a.address)).approve([{ day: 'monday', theme: 'proof', objective: 'show the harness', posts: 2 }]);
    // The CMO lays out A's house board once (slice 5): the record counts it; an operator's own save counts nothing.
    const house = { companies: await listCompanies(a.address), campaigns: [] };
    const posts = [{ id: 'posts', kind: 'posts', span: 12, scope: { companyId: null } }];
    expect((await (await boardStoreFor(a.address)).save('house', posts, { ...house, setBy: 'cmo' })).ok).toBe(true);
    expect((await (await boardStoreFor(a.address)).save('house', [{ ...posts[0], span: 6 }], { ...house, setBy: 'operator' })).ok).toBe(true);
    const res = await request(app).get('/api/v1/marketing/office/plan').set(as(a));
    expect(res.body.plan).toMatchObject({ status: 'approved', days: [{ day: 'monday', theme: 'proof', objective: 'show the harness', posts: 2 }] });
    expect(res.body.board).toEqual({ changes: 1, lastAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), lastLevel: 'house' });
    expect((await request(app).get('/api/v1/marketing/office/plan').set(as(b))).body).toEqual({ plan: null, board: null });
  });

  test('COMPANY WATCH: the granted repo newest first with its sources, a secret held back, the ungranted one named; never another house\'s', async () => {
    const res = await request(app).get('/api/v1/marketing/office/watch/northwind').set(as(a));
    expect(res.status).toBe(200);
    const w = res.body.watch;
    expect(w.rows.map((r) => [r.kind, r.line, r.sha])).toEqual([
      ['release', 'release 0.3.0', shas.release], ['commit', 'rotate a key', shas.key], ['fixed', 'The seal no longer stalls on a slow disk.', shas.fix]]);
    expect(w.rows[2].href).toBe(`https://github.com/northwind/app/commit/${shas.fix}`);
    // The 60-day-old commit is outside the 30 days; nothing of the key's value in the answer.
    expect([w.commits, w.repos, w.listed, w.counts]).toEqual([3, 1, 2, { fixed: 1, release: 1, commit: 1 }]);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
    expect(w.unread).toEqual([{ repo: 'the website', why: expect.stringMatching(/^your operator has not let you read it/) }]);
    expect(w.cmo).toEqual({ laneId: 'kestrel' });

    const other = await request(app).get('/api/v1/marketing/office/watch/northwind').set(as(b));
    expect(other.status).toBe(200);
    expect([other.body.watch.listed, other.body.watch.rows, other.body.watch.cmo]).toEqual([0, [], { laneId: 'heron' }]);
    expect(JSON.stringify(other.body)).not.toContain(repo);
    expect((await request(app).get('/api/v1/marketing/office/watch/brookmere').set(as(b))).status).toBe(404);
  });

  test('a board with the new kinds saves whole; a metric not reported, or another house\'s account, writes nothing and says why', async () => {
    const panels = [
      { id: 'platform:x', kind: 'platform', span: 4, scope: { companyId: null, platform: 'x' }, show: ['views', 'linkClicks'], window: '30d' },
      { id: 'platform:telegram:telegram-1', kind: 'platform', span: 4, scope: { companyId: null, platform: 'telegram', accountId: 'telegram-1' }, window: '7d' },
      { id: 'top-posts', kind: 'top-posts', span: 6, scope: { companyId: null }, sort: 'views', count: 5 },
      { id: 'funnel:northwind', kind: 'funnel', span: 6, scope: { companyId: null, company: 'northwind' } },
      { id: 'company-watch:northwind', kind: 'company-watch', span: 6, scope: { companyId: null, company: 'northwind' } },
      { id: 'next-7-days', kind: 'next-7-days', span: 6, scope: { companyId: null } },
      { id: 'cmo-log', kind: 'cmo-log', span: 6, scope: { companyId: null } },
    ];
    const put = await request(app).put('/api/v1/marketing/board?level=house').set(as(a)).send({ panels });
    expect(put.status).toBe(200);
    expect(put.body.board.map((p) => [p.id, p.show ?? null, p.window ?? null, p.sort ?? null, p.count ?? null])).toEqual([
      ['platform:x', ['views', 'linkClicks'], '30d', null, null], ['platform:telegram:telegram-1', null, '7d', null, null], ['top-posts', null, null, 'views', 5],
      ['funnel:northwind', null, null, null, null], ['company-watch:northwind', null, null, null, null], ['next-7-days', null, null, null, null], ['cmo-log', null, null, null, null]]);
    expect(put.body.windows).toEqual(['7d', '30d']);
    expect(put.body.count).toEqual({ min: 3, max: 10 });

    const refused = await request(app).put('/api/v1/marketing/board?level=house').set(as(a)).send({ panels: [
      { id: 'platform:telegram', kind: 'platform', span: 4, scope: { companyId: null, platform: 'telegram' }, show: ['views'] },
      { id: 'platform:bluesky:bluesky-1', kind: 'platform', span: 4, scope: { companyId: null, platform: 'bluesky', accountId: 'bluesky-1' } },
    ] });
    expect(refused.status).toBe(400);
    expect(refused.body.reasons).toEqual([
      `panel 1 (platform): telegram does not report views: ${CAPABILITY.telegram.why}`,
      'panel 2 (platform): there is no account "bluesky-1" in this house',
    ]);
    expect((await request(app).get('/api/v1/marketing/board?level=house').set(as(a))).body.board.map((p) => p.id)).toEqual(panels.map((p) => p.id));
    const onCompany = await request(app).put('/api/v1/marketing/board?level=northwind').set(as(a)).send({ panels: [{ id: 'cmo-log', kind: 'cmo-log', span: 6, scope: { companyId: 'northwind' } }] });
    expect(onCompany.body.reasons).toEqual(['panel 1 (cmo-log): a cmo-log panel stands on the house\'s board only']);
    // The other house's board is its own: house B never reads A's.
    expect((await request(app).get('/api/v1/marketing/board?level=house').set(as(b))).body.board).toBeNull();
  });
});
