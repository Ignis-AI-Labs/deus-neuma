/**
 * COMPANY SOURCES — a company's code repos, the owner's read grant to the
 * house's CMO, and `company_updates` — proven end to end on real temp disk
 * with REAL git repositories made here (git init, dated commits, changelog.d
 * fragments, a CHANGELOG, release notes, a committed .env). No mock anywhere
 * (RULE 0): the real kit store, the real CMO seat, the real lane policy, the
 * real git, and the real marketing tool handler over a real WebSocket pair.
 *
 * Claims: the CMO reads what changed since a point, citing repo + commit /
 * fragment; only repos the owner granted are read; a secret file inside a
 * repo is never returned (a fragment named like one, a committed .env in a
 * patch, a key-shaped line); another house's company repos are invisible;
 * the last-reported point advances.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import process from 'process';
import { promisify } from 'util';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaWorkspace } from '../../core/index.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { setCompanyRepos } from '../../backend/services/marketing/companies.js';
import { companySources, proposeRepos } from '../../backend/services/marketing/company-sources.js';
import { grantRepoRead, revokeRepoRead } from '../../backend/services/marketing/company-repo-grants.js';
import { readCompanyUpdates, readCommitDiff } from '../../backend/services/marketing/company-updates.js';
import { renderUpdates } from '../../backend/services/marketing/company-updates-text.js';

const { _handleCampaignTool, _cmoBriefingSection } = __test;
const run = promisify(execFile);
const HOUSE_A = `0x${'a1'.repeat(20)}`;
const HOUSE_B = `0x${'b2'.repeat(20)}`;
const CMO_A = 'aurelcmo';
const OTHER_A = 'scribea';
const CMO_B = 'heraldb';
// Built at run time so no key-shaped string sits in this file itself.
const FAKE_KEY = `sk-${'ant-'}${'z'.repeat(36)}`;
const OLD = '2026-01-05T10:00:00Z';

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
const initRepo = async (dir) => { await fs.mkdir(dir, { recursive: true }); await run('git', ['init', '-q', dir]); return fs.realpath(dir); };

describe('company sources: granted repos, read-only, cited, one house at a time (real git, gnosis)', () => {
  let tmp; let repos; let app; let site; let labs; let laneRepo; let saved; let envSha; let firstNew;
  let httpServer; let wss; let serverWs; let client;

  beforeAll(async () => {
    tmp = await fs.realpath(await createTempDir('company-sources'));
    saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), cmo: process.env.NEUMA_CMO_PATH };
    process.env.NEUMA_CMO_PATH = path.join(tmp, 'legacy-cmo.json');
    setRealmRoot(path.join(tmp, 'realm'));
    setWorkspacesRoot(path.join(tmp, 'lanes'));
    for (const [lane, house] of [[CMO_A, HOUSE_A], [OTHER_A, HOUSE_A], [CMO_B, HOUSE_B]]) await writeOwner(path.join(tmp, 'lanes'), lane, house);
    // Both houses keep a company with the SAME id — the houses must never be confused.
    for (const [house, ground] of [[HOUSE_A, 'ground-a'], [HOUSE_B, 'ground-b']]) {
      await setHouseWorkspace(house, path.join(tmp, ground));
      await writeReadyBrandKit(path.join(tmp, ground), 'northwind');
    }
    await cmoDesignation.designate(HOUSE_A, CMO_A);
    await cmoDesignation.designate(HOUSE_B, CMO_B);

    repos = path.join(tmp, 'repos');
    app = await initRepo(path.join(repos, 'northwind'));
    site = await initRepo(path.join(repos, 'northwind-site'));
    labs = await initRepo(path.join(repos, 'northwind-labs'));
    await initRepo(path.join(repos, 'unrelated-tool'));
    laneRepo = await initRepo(path.join(tmp, 'lanes', CMO_A, 'project'));
    await commitAt(app, OLD, 'chore: the first commit', {
      'README.md': '# Northwind\n',
      'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n- The first release.\n',
      'changelog.d/old-thing.md': 'Added\n- Something from January.\n',
    });
    firstNew = await commitAt(app, new Date(Date.now() - 2 * 864e5).toISOString(), 'feat: the sources panel', {
      'changelog.d/sources-panel.md': `Added\n- Each company lists its code and its site.\nTOKEN=${FAKE_KEY}\n`,
      'changelog.d/secrets.md': 'Added\n- this file is named like a secret and must never be returned\n',
      'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n- Company sources.\n\n## [0.2.0]\n- The second release.\n\n## [0.1.0]\n- The first release.\n',
      'docs/operations/release-notes-0.2.0.md': '# Release notes 0.2.0\n\nWhat is new: the sources panel.\n',
    });
    envSha = await commitAt(app, new Date(Date.now() - 864e5).toISOString(), 'fix: the reader keeps its walls', {
      '.env': `DEPLOY_TOKEN=${FAKE_KEY}\n`,
      'src/reader.js': 'export const reader = () => "walls";\n',
    });
    await commitAt(site, new Date(Date.now() - 864e5).toISOString(), 'feat: a new landing page', { 'index.html': '<h1>Northwind</h1>\n' });
    await commitAt(labs, OLD, 'chore: labs', { 'README.md': '# Labs\n' });
    await commitAt(laneRepo, OLD, 'chore: a project inside a lane', { 'a.txt': 'a\n' });

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    const linked = new Promise((resolve) => wss.on('connection', (ws) => { serverWs = ws; resolve(); }));
    client = new WebSocket(`ws://localhost:${httpServer.address().port}`);
    client.on('message', () => {});
    await linked;
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    setRealmRoot(saved.realm);
    setWorkspacesRoot(saved.lanes);
    if (saved.cmo === undefined) delete process.env.NEUMA_CMO_PATH; else process.env.NEUMA_CMO_PATH = saved.cmo;
  });

  test('PROPOSALS: the repos beside the app that carry the company\'s name — proposed, never recorded', async () => {
    const out = await proposeRepos(HOUSE_A, 'northwind', { scanDir: repos, appDir: app });
    expect(out.ok).toBe(true);
    expect(out.proposals.map((p) => [path.basename(p.path), p.role, p.strong])).toEqual([
      ['northwind', 'the app', true],
      ['northwind-labs', '', false],
      ['northwind-site', 'the website', true],
    ]);
    // Nothing was written: the company still lists no repos.
    expect((await companySources(HOUSE_A)).companies.find((c) => c.id === 'northwind').repos).toEqual([]);
  });

  test('RECORD: the owner lists the repos; a malformed one is refused in words', async () => {
    expect((await setCompanyRepos(HOUSE_A, 'northwind', [{ path: 'relative/app' }])).error).toMatch(/full folder path/);
    const set = await setCompanyRepos(HOUSE_A, 'northwind', [
      { path: app, role: 'the app' },
      { path: site, role: 'the website' },
      { remote: 'https://github.com/example/northwind-docs', role: 'the docs' },
      { path: laneRepo, role: 'a project in a lane' },
    ]);
    expect(set.ok).toBe(true);
    expect(set.company.repos).toHaveLength(4);
    // The proposals now leave out what is listed.
    expect((await proposeRepos(HOUSE_A, 'northwind', { scanDir: repos, appDir: app })).proposals.map((p) => path.basename(p.path))).toEqual(['northwind-labs']);
  });

  test('NOT GRANTED: nothing is read until the owner lets the CMO read it', async () => {
    const out = await readCompanyUpdates({ wallet: HOUSE_A, laneId: CMO_A, company: 'northwind', since: '2026-06-01' });
    expect(out.ok).toBe(true);
    expect(out.report.repos.map((r) => r.unread)).toEqual([
      expect.stringMatching(/has not let you read it/),
      expect.stringMatching(/has not let you read it/),
      expect.stringMatching(/not on this machine/),
      expect.stringMatching(/has not let you read it/),
    ]);
    expect(renderUpdates(out.report)).not.toContain('sources panel');
  });

  test('GRANT: one repo at a time, onto the CMO lane\'s own read roots; walls and other houses refused', async () => {
    const granted = await grantRepoRead(HOUSE_A, 'northwind', app);
    expect(granted).toEqual({ ok: true, laneId: CMO_A, path: app });
    expect((await neumaWorkspace.readToolPolicy(CMO_A)).pathGrants.read).toEqual([app]);
    // Not listed by the company: refused.
    expect((await grantRepoRead(HOUSE_A, 'northwind', labs)).error).toMatch(/does not list/);
    // Inside a being's lane: refused, though it is listed.
    expect((await grantRepoRead(HOUSE_A, 'northwind', laneRepo)).error).toMatch(/inside the beings' lanes/);
    // House B's northwind lists none of house A's repos: refused, and B's CMO holds nothing.
    expect((await grantRepoRead(HOUSE_B, 'northwind', app)).error).toMatch(/does not list/);
    expect(await neumaWorkspace.readToolPolicy(CMO_B)).toBeNull();
    const sources = await companySources(HOUSE_A, { probe: true });
    expect(sources.cmo).toEqual({ laneId: CMO_A });
    expect(sources.companies.find((c) => c.id === 'northwind').repos.map((r) => [r.role, r.granted, r.onDisk])).toEqual([
      ['the app', true, true], ['the website', false, true], ['the docs', false, null], ['a project in a lane', false, true],
    ]);
  });

  test('READ: commits, fragments, CHANGELOG and release notes since a date — cited; walled and secret-shaped text never returned', async () => {
    const out = await readCompanyUpdates({ wallet: HOUSE_A, laneId: CMO_A, company: 'Northwind Capital', since: '2026-06-01' });
    expect(out.ok).toBe(true);
    const [appRead, siteRead] = out.report.repos;
    expect(appRead.total).toBe(2);
    expect(appRead.commits.map((c) => c.subject)).toEqual(['fix: the reader keeps its walls', 'feat: the sources panel']);
    expect(appRead.fragments.map((f) => f.file)).toEqual(['changelog.d/sources-panel.md']);
    expect(appRead.changelog.map((s) => s.heading)).toEqual(['[Unreleased]', '[0.2.0]']);
    expect(appRead.notes.map((n) => n.file)).toEqual(['docs/operations/release-notes-0.2.0.md']);
    expect(siteRead.unread).toMatch(/has not let you read it/);
    const text = renderUpdates(out.report);
    expect(text).toContain(`${firstNew.slice(0, 9)} · `);
    expect(text).toContain(`changelog.d/sources-panel.md (added in ${firstNew.slice(0, 9)})`);
    expect(text).toContain('Each company lists its code and its site.');
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('named like a secret');
    expect(text).not.toContain('Something from January');
    expect(text).toMatch(/1 line\(s\) shaped like a secret were held back/);
  });

  test('DIFF ON REQUEST: one commit\'s patch, the committed .env left out whole', async () => {
    const out = await readCommitDiff({ wallet: HOUSE_A, laneId: CMO_A, company: 'northwind', commit: envSha });
    expect(out.ok).toBe(true);
    expect(out.withheld).toBe(1);
    expect(out.text).toContain('src/reader.js');
    expect(out.text).not.toContain('DEPLOY_TOKEN');
    expect(out.text).not.toContain(FAKE_KEY);
    // A lane the owner never granted reads no patch, nor does another house's CMO.
    expect((await readCommitDiff({ wallet: HOUSE_A, laneId: OTHER_A, company: 'northwind', commit: envSha })).ok).toBe(false);
    expect((await readCommitDiff({ wallet: HOUSE_B, laneId: CMO_B, company: 'northwind', commit: envSha })).ok).toBe(false);
  });

  test('OTHER HOUSE: house B\'s CMO, asking for "northwind", sees only its own company — no repo of house A', async () => {
    const out = await readCompanyUpdates({ wallet: HOUSE_B, laneId: CMO_B, company: 'northwind' });
    expect(out.ok).toBe(true);
    const text = renderUpdates(out.report);
    expect(text).toMatch(/lists no repos yet/);
    expect(text).not.toContain(app);
    expect(text).not.toContain('sources panel');
  });

  test('THE TOOL + THE REPORT POINT: through the real marketing handler (no card); the point advances', async () => {
    const connection = { ws: serverWs, walletAddress: HOUSE_A, companion: { name: 'Aurel', neumaId: CMO_A } };
    const call = (args) => _handleCampaignTool(serverWs, connection, null, 'ask', { toolName: 'company_updates' }, args);

    const first = await call({ company: 'northwind', markReported: true });
    expect(first.status).toBe('ok');
    expect(first.content).toContain('## WHAT CHANGED — Northwind Capital');
    expect(first.content).toMatch(/the last 7 days — no report is recorded yet/);
    expect(first.content).toContain('fix: the reader keeps its walls');
    expect(first.content).toMatch(/Recorded as your report point/);

    // Since that report: nothing new in the app.
    const quiet = await call({ company: 'northwind' });
    expect(quiet.content).toMatch(/Window: since .* \(your last report, /);
    expect(quiet.content).toMatch(/0 commit\(s\) after /);

    // A new commit and a new fragment land; the next read shows exactly those.
    const next = await commitAt(app, new Date().toISOString(), 'feat: company updates for the CMO', {
      'changelog.d/company-updates.md': 'Added\n- The CMO reads what changed in each company.\n',
    });
    const fresh = await call({ company: 'northwind', markReported: true });
    expect(fresh.content).toMatch(/1 commit\(s\) after /);
    expect(fresh.content).toContain(`changelog.d/company-updates.md (added in ${next.slice(0, 9)})`);
    expect(fresh.content).not.toContain('changelog.d/sources-panel.md');
    expect((await call({ company: 'northwind' })).content).toMatch(/0 commit\(s\) after /);

    // A commit's patch through the tool, too.
    const diff = await call({ company: 'northwind', commit: envSha });
    expect(diff.content).toMatch(/1 file\(s\) in it are behind a wall/);
    expect(diff.content).not.toContain(FAKE_KEY);
  });

  test('THE BRIEFING: one line names the sources and how to read them; a house with none carries no line', async () => {
    const a = await _cmoBriefingSection({ walletAddress: HOUSE_A, companion: { neumaId: CMO_A } });
    expect(a).toContain('COMPANY SOURCES: your companies record 0 site(s) and 4 code repo(s) (1 you may read).');
    expect(a).toContain('company_updates {company}');
    const b = await _cmoBriefingSection({ walletAddress: HOUSE_B, companion: { neumaId: CMO_B } });
    expect(b).toContain('## CMO office');
    expect(b).not.toContain('COMPANY SOURCES');
  });

  test('REVOKE: taking the read back closes company_updates at once', async () => {
    expect((await revokeRepoRead(HOUSE_A, 'northwind', app)).ok).toBe(true);
    expect((await neumaWorkspace.readToolPolicy(CMO_A)).pathGrants.read).toEqual([]);
    const out = await readCompanyUpdates({ wallet: HOUSE_A, laneId: CMO_A, company: 'northwind', since: '2026-06-01' });
    expect(out.report.repos[0].unread).toMatch(/has not let you read it/);
  });
});
