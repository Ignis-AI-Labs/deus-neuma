// SITE & CODE (company sources) — real Chromium, the PRODUCTION panel, the
// real /api/v1/companies routes over a real signed-wallet session as the
// install owner at the desk, the real kit store and lane policy on tmp disk,
// and real git repositories made here. No double (RULE 0). The owner finds
// the company's repos (proposals only), confirms them, lets the CMO read one
// through its card, adds one by hand, and takes the read back. Screens at two
// widths are written for a person to look at.
/* global document, fetch */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaWorkspace } from '../../core/index.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(os.tmpdir(), 'neuma-company-sources-shots');
const ENV = ['NEUMA_CMO_PATH', 'NEUMA_COMPANY_REPO_SCAN_DIR'];
const CMO = 'aurelcmo';
const run = promisify(execFile);
let tmp; let vite; let server; let browser; let auth; let saved; let app; let site;

const initRepo = async (dir, subject) => {
  await fs.mkdir(dir, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'f@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'f@example.invalid' };
  await run('git', ['init', '-q', dir]);
  await fs.writeFile(path.join(dir, 'README.md'), `# ${subject}\n`);
  await run('git', ['add', '-A'], { cwd: dir, env });
  await run('git', ['commit', '-q', '-m', subject], { cwd: dir, env });
  return fs.realpath(dir);
};

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'company-sources-ui-')));
  saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), env: Object.fromEntries(ENV.map((k) => [k, process.env[k]])) };
  setRealmRoot(path.join(tmp, 'realm'));
  setWorkspacesRoot(path.join(tmp, 'lanes'));
  process.env.NEUMA_CMO_PATH = path.join(tmp, 'legacy-cmo.json');
  process.env.NEUMA_COMPANY_REPO_SCAN_DIR = path.join(tmp, 'repos');
  auth = await fullAuth();
  await makeInstallOwner(auth.address);
  await setHouseWorkspace(auth.address, path.join(tmp, 'ground'));
  await writeReadyBrandKit(path.join(tmp, 'ground'), 'northwind');
  await writeOwner(path.join(tmp, 'lanes'), CMO, auth.address);
  await cmoDesignation.designate(auth.address, CMO);
  app = await initRepo(path.join(tmp, 'repos', 'northwind'), 'the app');
  site = await initRepo(path.join(tmp, 'repos', 'northwind-site'), 'the site');
  await initRepo(path.join(tmp, 'repos', 'elsewhere'), 'not this company');

  const { default: companies } = await import('../../backend/routes/company-routes.js');
  const { default: brands } = await import('../../backend/routes/brand-routes.js');
  const { default: companyLinks } = await import('../../backend/routes/company-link-routes.js');
  const web = express();
  web.use(express.json());
  web.use('/api/v1/companies', companies);
  web.use('/api/v1/company-links', companyLinks);
  web.use('/api/v1/brands', brands);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/company-sources-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  const fixture = { token: auth.token, companyId: 'northwind', roster: [{ neumaId: CMO, name: 'Marlow' }] };
  web.get('/', (req, res) => res.type('html').send(
    `<!doctype html><html><body style="background:#000"><script>window.sourcesFixture=${JSON.stringify(fixture)}</script><div id="root"></div><script type="module" src="/test/helpers/company-sources-page.jsx"></script></body></html>`,
  ));
  web.use(vite.middlewares);
  server = http.createServer(web);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  setRealmRoot(saved.realm);
  setWorkspacesRoot(saved.lanes);
  for (const [k, v] of Object.entries(saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

const open = async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('[data-company-sources="northwind"]').waitFor({ timeout: 60000 });
  return { page, errors };
};
const tally = (page) => page.locator('[data-src-tally] b').allTextContents();

describe('SITE & CODE — the company\'s repos, proposed, confirmed, and lent to the CMO one card at a time', () => {
  it('finds, confirms, lends, adds by hand and takes back — every mark true to disk', async () => {
    const { page, errors } = await open(1280);
    expect(await tally(page)).toEqual(['0', '0', '0']);
    expect(await page.locator('.bk-src').textContent()).toContain('No repos are listed yet');

    // PROPOSED: the two folders named for the company, ticked; the stranger not offered; nothing recorded yet.
    await page.getByRole('button', { name: /LOOK FOR NORTHWIND CAPITAL'S REPOS/ }).click();
    const proposals = page.locator('[data-src-proposal]');
    await proposals.first().waitFor();
    expect(await proposals.evaluateAll((rows) => rows.map((r) => r.getAttribute('data-src-proposal')))).toEqual([app, site]);
    expect(await page.locator('[data-src-proposal] input[type="checkbox"]:checked').count()).toBe(2);
    expect(await page.getByLabel(`role of ${site}`, { exact: true }).inputValue()).toBe('the website');
    expect(await page.locator('[data-src-repo]').count()).toBe(0);
    await page.screenshot({ path: path.join(SHOTS, 'proposed-1280.png'), fullPage: true });
    await page.getByLabel(`role of ${app}`, { exact: true }).fill('the app');
    await page.getByRole('button', { name: 'CONFIRM 2 REPO(S)' }).click();
    await page.locator(`[data-src-repo="${app}"]`).waitFor();
    expect(await tally(page)).toEqual(['2', '0', '0']);
    expect(await page.locator(`[data-src-repo="${app}"] [data-src-state]`).textContent()).toBe('NOT LENT');

    // A kit draft opened BEFORE the repos were listed, saved after: the kit's
    // company block is the companies route's, so the save keeps the repos.
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    const stale = (await (await fetch(`${base}/api/v1/brands/northwind`, { headers })).json()).kit;
    const saveStale = await fetch(`${base}/api/v1/brands/northwind`, { method: 'PUT', headers, body: JSON.stringify({ ...stale, company: undefined, tagline: 'Saved from an old draft.' }) });
    expect(saveStale.status).toBe(200);
    const after = await (await fetch(`${base}/api/v1/companies/sources`, { headers })).json();
    expect(after.companies.find((c) => c.id === 'northwind').repos.map((r) => r.path)).toEqual([app, site]);

    // THE CARD: plain words, then the yes; the mark turns live and the lane policy holds exactly that root.
    await page.locator(`[data-src-repo="${app}"]`).getByRole('button', { name: 'LET MARLOW READ' }).click();
    const card = page.locator('[data-src-card]');
    expect(await card.textContent()).toContain('It can never change anything there');
    expect(await card.textContent()).toContain('.env files, keys, credential stores and git internals are never read');
    await page.screenshot({ path: path.join(SHOTS, 'card-1280.png'), fullPage: true });
    await card.getByRole('button', { name: 'LET IT READ' }).click();
    await page.locator(`[data-src-repo="${app}"].is-granted`).waitFor();
    expect(await page.locator(`[data-src-repo="${app}"] [data-src-state]`).textContent()).toBe('THE CMO CAN READ');
    expect(await page.locator(`[data-src-repo="${site}"] [data-src-state]`).textContent()).toBe('NOT LENT');
    expect(await tally(page)).toEqual(['2', '1', '0']);
    expect((await neumaWorkspace.readToolPolicy(CMO)).pathGrants.read).toEqual([app]);

    // BY HAND: a repo published elsewhere only; a malformed folder is refused before it is sent.
    await page.getByLabel('repo folder').fill('relative/path');
    expect(await page.locator('.bk-src .is-bad').textContent()).toContain('FULL PATH');
    await page.getByLabel('repo folder').fill('');
    await page.getByLabel('repo web address').fill('https://github.com/example/northwind-docs');
    await page.getByLabel('repo role').fill('the docs');
    await page.locator('[data-src-add]').getByRole('button', { name: 'ADD' }).click();
    await page.locator('[data-src-repo="https://github.com/example/northwind-docs"]').waitFor();
    expect(await page.locator('[data-src-repo="https://github.com/example/northwind-docs"] [data-src-state]').textContent()).toBe('ELSEWHERE ONLY');
    expect(await tally(page)).toEqual(['3', '1', '0']);
    await page.screenshot({ path: path.join(SHOTS, 'listed-1280.png'), fullPage: true });

    // TAKE BACK: the mark returns to rest and the lane holds no root.
    await page.locator(`[data-src-repo="${app}"]`).getByRole('button', { name: 'TAKE BACK' }).click();
    await page.locator(`[data-src-repo="${app}"].is-closed`).waitFor();
    expect(await tally(page)).toEqual(['3', '0', '0']);
    expect((await neumaWorkspace.readToolPolicy(CMO)).pathGrants.read).toEqual([]);
    expect(await page.locator('[data-src-notice]').textContent()).toContain('taken back');
    expect(errors).toEqual([]);
    await page.close();
  }, 120000);

  it('a narrow panel still reads every repo and its mark', async () => {
    const { page, errors } = await open(760);
    await page.locator('[data-src-repo]').first().waitFor();
    expect(await page.locator('[data-src-repo]').count()).toBe(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'listed-760.png'), fullPage: true });
    await page.close();
  }, 60000);
});
