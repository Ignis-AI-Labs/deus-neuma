// @ts-check
import { test, expect } from '@playwright/test';
import http from 'http';
import { openDockApp } from './helpers/dock.js';
import { setupIsolatedHouse, openDesk, settledShot as shot } from './helpers/isolated-house.js';
import { CHANNEL_CATALOG } from '../../backend/services/social/channel-registry.js';

/**
 * End-to-end THE HOLDER FOLLOWS THE SEAT (2026-10-23) — an account level's
 * standing as three marks in its head (KEYS · HOLDER · CREW, SDT-6), on
 * Facebook and X, in the three states the operator meets:
 *   1. no keys            — the seated CMO waits for them; nothing is bound
 *   2. keys + CMO         — the window binds the CMO through the real binding
 *                           route, says so plainly, and the holder mark offers
 *                           only the marketing-seated (the CMO, the platform crew)
 *   3. no CMO             — the holder mark in fault + SEAT A CMO, which opens
 *                           MARKETING where the seat is given
 *
 * Own backend child, own vite, real challenge-sign-verify auth, real disk
 * (isolated-house.js). No mock anywhere (RULE 0). SAFETY LAW (the 10-21
 * incident — dev lanes post for real): every social key variable is BLANKED
 * before the stack spawns (playwright.config.js loads the repo .env, and the
 * child inherits this process's env), so no real key can reach the child; the
 * keys this spec sets are throwaway strings; every platform API root points at
 * a loopback stand-in that answers only the identity reads a flight test
 * makes, and the spec proves no write ever reached it; no queue entry is ever
 * seeded. Shots: test/e2e/shots/standing-*.png
 */

const KEIR = { id: 'e2e-std-keir', name: 'Keir', utc: '2026-08-10T12:00:00.000Z' };
const GALEN = { id: 'e2e-std-galen', name: 'Galen', utc: '2026-08-11T12:00:00.000Z' };
const ASH = { id: 'e2e-std-ash', name: 'Ash', utc: '2026-08-12T12:00:00.000Z' };
const MEMBERS = [KEIR, GALEN, ASH];

const PLATFORMS = [
  { id: 'x', label: 'X', name: 'X (Twitter)', account: '@standing_proof',
    fields: { apiKey: 'e2e-throwaway-key', apiSecret: 'e2e-throwaway-secret', accessToken: 'e2e-throwaway-token', accessSecret: 'e2e-throwaway-asecret' } },
  { id: 'facebook', label: 'FACEBOOK', name: 'Facebook Page', account: '@standing_page',
    fields: { pageId: '424242', accessToken: 'e2e-throwaway-page-token' } },
];

// Every social key variable the catalog knows, blanked: dotenv never
// overrides a variable that is already set, so the child reads none of them.
for (const channel of CHANNEL_CATALOG) for (const f of channel.fields) process.env[f.env] = '';

// THE LOOPBACK STAND-IN — answers the two identity reads (X /2/users/me, the
// Facebook page lookup) and records every request, so the spec can prove that
// nothing was ever written to a platform.
const seen = [];
const standIn = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url.split('?')[0]}`);
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/2/users/me')) {
    return res.end(JSON.stringify({ data: { id: '4242', username: 'standing_proof', name: 'Standing Proof' } }));
  }
  if (req.method === 'GET' && /^\/v[\d.]+\/424242\?/.test(req.url)) {
    return res.end(JSON.stringify({ id: '424242', name: 'standing_page' }));
  }
  res.statusCode = 404;
  return res.end(JSON.stringify({ error: { message: 'not served by the stand-in' } }));
});
test.beforeAll(async () => {
  await new Promise((resolve) => standIn.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${standIn.address().port}`;
  process.env.NEUMA_X_API_ROOT = `${root}/2`;
  for (const v of ['FACEBOOK', 'TELEGRAM', 'DISCORD', 'MASTODON', 'BLUESKY']) process.env[`NEUMA_${v}_API_ROOT`] = root;
});
test.afterAll(async () => {
  await new Promise((resolve) => standIn.close(resolve));
});

const stack = setupIsolatedHouse(MEMBERS, 5271);

// impure — one real authenticated route call on the stack
const api = async (method, path, body) => {
  const res = await fetch(`${stack.api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${stack.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  expect(res.ok, `${method} ${path} → ${res.status} ${JSON.stringify(json)}`).toBe(true);
  return json;
};
const bindingOf = async (id) => (await api('GET', '/api/v1/social-channels')).channels.find((c) => c.id === id).binding;

// The house: Keir seated CMO, Galen on both platforms' crew, Ash unseated.
test.beforeAll(async () => {
  await api('PUT', '/api/v1/campaigns/cmo', { laneId: KEIR.id });
  for (const p of PLATFORMS) await api('PUT', `/api/v1/social-channels/${p.id}/crew`, { neumaId: GALEN.id, kind: 'neuma', remit: 'campaign drafts' });
});

test.use({ viewport: { width: 1500, height: 1000 } });
test.describe.configure({ mode: 'serial' });

// impure — open a platform's account level (MARKETING) full size: its head carries the standing as marks (SDT-6).
const openStanding = async (page, p) => {
  await openDockApp(page, p.label);
  // The platform's own space — MARKETING's account level holds it inside MARKETING's panel (slice 6): the innermost.
  const panel = page.locator(`[data-mkt-level="account"][data-mkt-account^="${p.id}:"] .outreach-panel`).last();
  const head = panel.locator('.pc-head');
  await expect(head).toBeVisible();
  const win = page.locator('.fwin', { has: panel });
  await win.locator('.fwin-bar').dblclick();
  const mark = (k) => head.locator(`[data-standing="${k}"]`);
  return { panel, win, head, mark };
};
const closeWindow = async (win) => {
  await win.locator('.fwin-ctl-close').click();
  await expect(win).toHaveCount(0);
};

test('1 · no keys: the CMO waits for them, nothing is bound, KEYS is what blocks', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await openDesk(page, stack, KEIR);
  for (const p of PLATFORMS) {
    const { win, head, mark, panel } = await openStanding(page, p);
    await expect(mark('keys')).toHaveClass(/is-fault/);
    await expect(mark('keys')).toHaveAttribute('title', 'KEYS · not set');
    await expect(head.getByRole('button', { name: 'SET KEYS' })).toBeVisible();
    await expect(mark('holder')).toHaveClass(/is-warm/);
    await expect(mark('holder')).toHaveAttribute('title', `HOLDER · ${KEIR.name} (CMO) holds it once the keys are set`);
    await expect(mark('crew')).toHaveText('1');
    await expect(mark('crew')).toHaveAttribute('title', new RegExp(`^CREW · ${GALEN.name} — `));
    await expect(panel.locator('.ps-notice')).toHaveCount(0);
    expect(await bindingOf(p.id), 'no keys, no auto-bind').toBeNull();
    await shot(win, `standing-${p.id}-1-no-keys`);
    await closeWindow(win);
  }
  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('2 · keys set + a CMO: bound to the CMO through the binding route, said plainly; the holder offers only marketing seats', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  for (const p of PLATFORMS) await api('PUT', `/api/v1/social-channels/${p.id}/credentials`, { fields: p.fields });
  const { tests } = await api('GET', '/api/v1/social-channels/flight-test?fresh=1');
  for (const p of PLATFORMS) expect(tests[p.id]?.ok, `${p.id} flight test: ${JSON.stringify(tests[p.id])}`).toBe(true);

  await openDesk(page, stack, KEIR);
  for (const p of PLATFORMS) {
    const { win, head, mark, panel } = await openStanding(page, p);
    const notice = panel.locator('.ps-notice');
    await expect(notice).toContainText(`«NOTICE»${KEIR.name} holds ${p.name} · CMO`);
    await expect(notice).toHaveAttribute('title', `bound automatically, because ${KEIR.name} holds the CMO seat and the keys are set`);
    await expect(mark('holder')).toHaveText(KEIR.name);
    await expect(mark('holder')).toHaveClass(/is-ok/);
    await expect(mark('keys')).toHaveClass(/is-ok/);
    await expect(mark('keys')).toHaveAttribute('title', `KEYS · proven as ${p.account}`);
    await expect(head.getByRole('button', { name: /SET KEYS|FIX KEYS/ })).toHaveCount(0);
    // the binding is the record's, made by the real route — not a display
    expect(await bindingOf(p.id)).toMatchObject({ neumaId: KEIR.id });
    await shot(win, `standing-${p.id}-2-cmo-auto-held`);

    // the holder, in place: the marketing seats only — the CMO (held) and the crew; Ash never
    await mark('holder').click();
    const chooser = panel.locator('.ps-drawer[aria-label="the holder"]');
    const choices = chooser.locator('.ps-choice');
    await expect(choices).toHaveCount(3);
    await expect(choices.nth(0)).toHaveText(`${KEIR.name}CMO`);
    await expect(choices.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(choices.nth(1)).toHaveText(`${GALEN.name}CREW`);
    await expect(choices.nth(2)).toHaveText('Releaseno one may post');
    await expect(chooser).not.toContainText(ASH.name);
    await shot(win, `standing-${p.id}-2b-change`);
    await closeWindow(win);
  }
  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('3 · no CMO: the holder mark opens with SEAT A CMO, nothing auto-bound', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  for (const p of PLATFORMS) await api('DELETE', `/api/v1/social-channels/${p.id}/binding`);
  await api('DELETE', '/api/v1/campaigns/cmo');

  await openDesk(page, stack, KEIR);
  for (const p of PLATFORMS) {
    const { win, head, mark, panel } = await openStanding(page, p);
    await expect(mark('holder')).toHaveClass(/is-fault/);
    await expect(mark('holder')).toHaveAttribute('title', /no one holds the marketing seat yet/);
    await expect(head.getByRole('button', { name: 'SEAT A CMO' })).toBeVisible();
    await expect(mark('keys')).not.toHaveClass(/is-fault/);
    await expect(panel.locator('.ps-notice')).toHaveCount(0);
    await shot(win, `standing-${p.id}-3-no-cmo`);
    expect(await bindingOf(p.id), 'no CMO, no auto-bind').toBeNull();
    // the crew stays offered for a deliberate choice — still never Ash
    await mark('holder').click();
    const choices = panel.locator('.ps-drawer[aria-label="the holder"] .ps-choice');
    await expect(choices).toHaveCount(1);
    await expect(choices.first()).toHaveText(`${GALEN.name}CREW`);
    if (p.id === 'facebook') {
      // the crew mark opens the crew in place; releasing Galen empties it on the record
      await mark('crew').click();
      const crew = panel.locator('.ps-drawer[aria-label="the crew"]');
      await expect(crew.locator('.ps-crew li')).toHaveCount(1);
      await expect(crew.locator('.ps-crew li')).toContainText(`${GALEN.name}NEUMA · campaign drafts`);
      await crew.getByRole('button', { name: 'release' }).click();
      await expect(mark('crew')).toHaveText('0');
      expect((await api('GET', `/api/v1/social-channels/${p.id}/crew`)).crew).toEqual([]);
      // SEAT A CMO opens MARKETING, where the seat is given
      await head.getByRole('button', { name: 'SEAT A CMO' }).click();
      await expect(page.locator('.settings-k', { hasText: 'CHIEF MARKETING OFFICER' })).toBeVisible();
    }
    await closeWindow(win);
  }
  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('nothing was ever written to a platform', async () => {
  expect(seen.length, 'the flight tests reached the stand-in').toBeGreaterThan(0);
  expect(seen.filter((r) => !r.startsWith('GET ')), 'no write reached any platform').toEqual([]);
});
