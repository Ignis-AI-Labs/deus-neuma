// The MARKETING window's real-Chromium ground (marketing-overview-browser and
// marketing-office-browser): the PRODUCTION window (title + body) served by
// vite, the real routes over a real signed-wallet session, the real stores on
// tmp disk, and the house's results produced by the REAL stats sweep against
// local stand-ins in each platform's shape (X, Bluesky, the site counter).
// No double (RULE 0); placeholder keys; the queue holds sent and failed
// history and drafts — never `approved`.
//
// The house: Northwind (a holding company, its legal form recorded) › Northwind
// Labs › Northwind Studio, three levels deep; Brookmere, a separate client
// company; the repo's own shipped kits beside them; one account under no
// company; one lane of the house (Kestrel) the CMO seat can name.
//
// impure — tmp disk, env doors, servers, a browser. (`smallText` and `spill`
// run in the page, handed to page.evaluate.)
/* global document, getComputedStyle */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { expect } from 'vitest';
import { fullAuth, writeOwner } from './audit-auth.js';
import { writeReadyBrandKit } from './ready-brand-kit.js';
import { startStatsStandIns } from './social-stats-stand-ins.js';
import { startSiteCounterStandIn } from './site-counter-stand-in.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { addAccount, setAccountFields, setAppFields } from '../../backend/services/social/account-store.js';
import { listCompanies, setCompanyBlock } from '../../backend/services/marketing/companies.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { campaignContextFor } from '../../backend/services/marketing/campaign-context.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { setSiteToken } from '../../backend/services/marketing/site-counter.js';
import { appendLinks } from '../../backend/services/marketing/link-store.js';
import { sweepHouse } from '../../backend/services/social/stats/stats-sweep.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const ENV = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_X_API_ROOT', 'NEUMA_BLUESKY_API_ROOT', 'NEUMA_SITE_COUNTER_ROOT', 'NEUMA_CAMPAIGNS_PATH', 'NEUMA_CMO_PATH', 'NEUMA_STATS_SWEEP',
  'NEUMA_LEAD_LEDGER_PATH'];
const BSKY = 'at://did:plc:house/app.bsky.feed.post/3kq2';
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const ROUTES = ['campaign-routes', 'social-channel-routes', 'social-account-routes', 'social-group-routes', 'marketing-link-routes',
  'marketing-results-routes', 'waiting-routes', 'mandate-routes', 'company-routes', 'roster-routes', 'lead-routes', 'brand-routes', 'marketing-board-routes',
  'marketing-office-routes', 'company-link-routes'];

// impure — the house on tmp disk: companies, accounts, a campaign, the queue, the counter, the sweep.
const seedHouse = async (ctx) => {
  const { tmp, auth, stats, counter } = ctx;
  const house = auth.address;
  await setHouseWorkspace(house, path.join(tmp, 'ground'));
  for (const [kit, name] of [['northwind', 'Northwind'], ['northwind-labs', 'Northwind Labs'], ['northwind-studio', 'Northwind Studio'], ['brookmere', 'Brookmere']]) {
    const dir = await writeReadyBrandKit(path.join(tmp, 'ground'), kit);
    const file = path.join(dir, 'brand.json');
    await fs.writeFile(file, JSON.stringify({ ...JSON.parse(await fs.readFile(file, 'utf8')), name }, null, 2));
  }
  expect((await setCompanyBlock(house, 'northwind', { legalEntity: { name: 'Northwind Holdings LLC', jurisdiction: 'Delaware' } })).ok).toBe(true);
  expect((await setCompanyBlock(house, 'northwind-labs', { parentId: 'northwind' })).ok).toBe(true);
  expect((await setCompanyBlock(house, 'northwind-studio', { parentId: 'northwind-labs' })).ok).toBe(true);
  const ids = (await listCompanies(house)).map((c) => c.id);
  for (const [ch, companyId] of [['x', 'northwind'], ['bluesky', 'northwind'], ['x', 'northwind-labs'], ['x', 'brookmere'], ['bluesky', null]]) {
    expect((await addAccount(house, ch, companyId ? { companyId } : {}, ids)).ok).toBe(true);
  }
  await setAppFields(house, 'x', { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
  await setAccountFields(house, 'x-1', { accessToken: 'ph-x-token', accessSecret: 'ph-x-secret' });
  ctx.campaign = await (await campaignStoreFor(house)).add({
    name: 'Launch Week', companyId: 'northwind', goal: { kind: 'downloads', label: 'Linux installs' },
    kpi: { metric: 'conversions', target: 100, by: day(10) }, window: { start: day(-3), end: day(7) },
    angles: [{ name: 'proof' }, { name: 'speed' }], subs: [{ account: 'x-1' }, { account: 'bluesky-1' }],
  }, await campaignContextFor(house), house);
  const sentAgo = (id, channelId, accountId, postId, hours, extra = {}) => ({
    id, channelId, accountId, text: `${id}: only the harness changed.`, scheduledFor: null, campaignId: ctx.campaign.id, pillar: 'proof', angleId: 'proof',
    media: [], authorNeumaId: null, queuedBy: house, status: 'sent', createdAt: new Date(Date.now() - (hours + 1) * 36e5).toISOString(),
    decidedBy: house, sentAt: new Date(Date.now() - hours * 36e5).toISOString(), postId, ...extra,
  });
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, `${JSON.stringify([
    sentAgo('p1', 'x', 'x-1', '1850000000000000001', 20, { url: 'https://x.com/i/status/1850000000000000001' }),
    sentAgo('p2', 'bluesky', 'bluesky-1', BSKY, 20),
    { ...sentAgo('f1', 'x', 'x-1', null, 30), status: 'failed', failedAt: new Date().toISOString(), error: 'X answered HTTP 503', postId: undefined },
  ], null, 2)}\n`);
  await postQueue.add({ channelId: 'x', accountId: 'x-1', text: 'Thursday: the clip, on the core account.', groupId: 'launch-clip', campaignId: ctx.campaign.id, queuedBy: house, scheduledFor: new Date(Date.now() + 2 * 864e5).toISOString() });
  await postQueue.add({ channelId: 'x', accountId: 'x-2', text: 'Thursday: the clip, on the labs account.', groupId: 'launch-clip', queuedBy: house });
  Object.assign(stats.state.counts, { '1850000000000000001': { views: 4100, likes: 61, replies: 4, shares: 9, quotes: 1, saves: 3 }, [BSKY]: { likes: 8, shares: 2, replies: 1, quotes: 0 } });
  await setSiteToken(house, 'ph-site-token-0123456789');
  await appendLinks(house, [{ code: 'k7q2xm', destination: 'https://deusneuma.ai/download/', entryId: 'p1', accountId: 'x-1', companyId: 'northwind', createdAt: new Date().toISOString() }]);
  counter.codes.set('k7q2xm', { code: 'k7q2xm', destination: 'https://deusneuma.ai/download/', company: 'northwind' });
  counter.count('click', 'k7q2xm', day(0), 61);
  counter.count('download', 'k7q2xm', day(0), 22);
  // A lane of this house the CMO seat can name (its chosen name is what the roster reads).
  await writeOwner(getWorkspacesRoot(), 'kestrel', house);
  await fs.mkdir(path.join(getWorkspacesRoot(), 'kestrel', 'identity'), { recursive: true });
  await fs.writeFile(path.join(getWorkspacesRoot(), 'kestrel', 'identity', 'true-name.json'), JSON.stringify({ chosenName: 'Kestrel', fullName: 'Kestrel Aunvel', houseName: 'Aunvel' }));
  // The house's numbers, as the real sweep reads them.
  expect((await sweepHouse(house)).read).toBe(2);
};

// impure — the routes, the page, the server, the browser.
const serve = async (ctx) => {
  const app = express();
  app.use(express.json());
  const routers = (await Promise.all(ROUTES.map((r) => import(`../../backend/routes/${r}.js`)))).map((r) => r.default);
  const [camp, channel, account, group, links, results, waiting, mandate, company, roster, leads, brands, board, office, companyLinks] = routers;
  app.use('/api/v1/campaigns', camp);
  app.use('/api/v1/social-channels', account);
  app.use('/api/v1/social-channels', group);
  app.use('/api/v1/social-channels', channel);
  app.use('/api/v1/marketing/links', links);
  app.use('/api/v1/marketing/results', results);
  app.use('/api/v1/waiting', waiting);
  app.use('/api/v1/mandate', mandate);
  app.use('/api/v1/companies', company);
  app.use('/api/v1/roster', roster);
  app.use('/api/v1/leads', leads);
  app.use('/api/v1/brands', brands);
  app.use('/api/v1/marketing/board', board);
  app.use('/api/v1/marketing/office', office);
  app.use('/api/v1/company-links', companyLinks);
  ctx.vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(ctx.tmp, 'vite-cache'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/marketing-overview-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-i18next', 'i18next'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => {
    const fixture = {
      token: ctx.auth.token, card: req.query.card || null, platform: req.query.platform || null, wallet: req.query.wallet || ctx.auth.address,
      landing: req.query.landing ? JSON.parse(req.query.landing) : null,
    };
    res.type('html').send(`<!doctype html><html><body style="background:#000"><script>window.overviewFixture=${JSON.stringify(fixture)}</script><div id="root"></div><script type="module" src="/test/helpers/marketing-overview-page.jsx"></script></body></html>`);
  });
  app.use(ctx.vite.middlewares);
  ctx.server = http.createServer(app);
  await new Promise((resolve) => ctx.server.listen(0, '127.0.0.1', resolve));
  ctx.browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  ctx.url = (query = '') => `http://127.0.0.1:${ctx.server.address().port}/${query}`;
};

/** impure — the whole ground up; returns the context every test reads. */
export const startMarketingOffice = async (prefix) => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  const ctx = { tmp, saved: { realm: getRealmRoot(), lanes: getWorkspacesRoot(), env: Object.fromEntries(ENV.map((k) => [k, process.env[k]])) } };
  setRealmRoot(path.join(tmp, 'realm'));
  setWorkspacesRoot(path.join(tmp, 'lanes'));
  for (const [k, f] of [['NEUMA_SOCIAL_POST_QUEUE_PATH', 'queue.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'bindings.json'], ['NEUMA_SECTOR_CREW_PATH', 'crew.json'],
    ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'legacy-creds.json'], ['NEUMA_CAMPAIGNS_PATH', 'legacy-campaigns.json'], ['NEUMA_CMO_PATH', 'legacy-cmo.json'],
    ['NEUMA_LEAD_LEDGER_PATH', 'lead-ledger.json']]) process.env[k] = path.join(tmp, f);
  ctx.stats = await startStatsStandIns();
  ctx.counter = await startSiteCounterStandIn({ token: 'ph-site-token-0123456789' });
  Object.assign(process.env, { NEUMA_X_API_ROOT: `${ctx.stats.root}/2`, NEUMA_BLUESKY_API_ROOT: ctx.stats.root, NEUMA_SITE_COUNTER_ROOT: ctx.counter.root });
  ctx.auth = await fullAuth();
  await seedHouse(ctx);
  await serve(ctx);
  return ctx;
};

/** impure — everything down, every door restored, tmp removed. */
export const stopMarketingOffice = async (ctx) => {
  await ctx?.browser?.close();
  if (ctx?.server?.listening) await new Promise((resolve) => ctx.server.close(resolve));
  await ctx?.vite?.close();
  await Promise.all([ctx?.stats?.close(), ctx?.counter?.close()]);
  if (!ctx?.saved) return;
  setRealmRoot(ctx.saved.realm);
  setWorkspacesRoot(ctx.saved.lanes);
  for (const [k, v] of Object.entries(ctx.saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await fs.rm(ctx.tmp, { recursive: true, force: true });
};

/**
 * impure — a page on the window, waiting for the house level's tiles. Each
 * page gets its own browser context (its own localStorage, so a remembered
 * zoom never leaks between tests) unless `context` hands one in.
 */
export const openOffice = async (ctx, width, { query = '', height = 1400, ready = '[data-mkt-tiles] [data-company-tile]', context = null } = {}) => {
  const page = await (context || await ctx.browser.newContext()).newPage();
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ctx.url(query));
  if (ready) await page.locator(ready).first().waitFor({ timeout: 60000 });
  return { page, errors };
};

/**
 * In the page: every element in the office (the window's body; its title is the desk frame's), or under `root`,
 * carrying visible text under 13px. A form field's text is what a person typed, and a post's own words
 * (`data-own-words`) are the post's, never a label, so neither is judged.
 */
export const smallText = (root = '[data-marketing-office]') => [...document.querySelectorAll(`${root} *`)]
  .filter((el) => !el.matches('textarea, input, [data-own-words], [data-own-words] *') && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length)
  .map((el) => ({ text: el.textContent.trim().slice(0, 40), size: parseFloat(getComputedStyle(el).fontSize), at: `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).trim().replace(/\s+/g, '.')}` }))
  .filter((t) => t.size < 13);

/** In the page: anything drawn past the office's (or `root`'s) right edge — not counting what sits inside its own scrolling box. */
export const spill = (root = '[data-marketing-office]') => {
  const office = document.querySelector(root);
  const right = office.getBoundingClientRect().right + 1;
  const scrolled = (el) => { for (let n = el.parentElement; n && n !== office; n = n.parentElement) if (/(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true; return false; };
  return [...office.querySelectorAll('*')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > right && !scrolled(el))
    .map((el) => `${el.className || el.tagName}: ${el.textContent.trim().slice(0, 30)}`)
    .concat([...office.querySelectorAll('.sub-panel-in, .mkb-scroll, .hlth-cell')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `panel scrolls: ${el.textContent.trim().slice(0, 30)}`));
};

/**
 * In the page: the READ LOAD under `root` (show-dont-tell-audit.md § How it was
 * measured) — the visible words, from innerText, and the words of visible
 * placeholders counted on their own. A word is a run holding a letter or digit.
 */
export const readLoad = (root = '#root') => {
  const count = (text) => String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const el = document.querySelector(root);
  const held = [...el.querySelectorAll('[placeholder]')].filter((n) => n.getClientRects().length && !n.value);
  return { words: count(el.innerText), placeholder: held.reduce((sum, n) => sum + count(n.getAttribute('placeholder')), 0) };
};
