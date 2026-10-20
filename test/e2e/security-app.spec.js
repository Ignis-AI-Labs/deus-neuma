// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import { setupIsolatedHouse, openDesk, settledShot as shot } from './helpers/isolated-house.js';

/**
 * End-to-end THE SECURITY WINDOW (2026-10-19) — the CSO office on the desk:
 * the ledger listed with the dangerous first, a settled verdict the operator
 * overturns with REOPEN (the CSO's reasoning kept beside the reopen), an
 * unread threat that offers no REOPEN, and an entry the WATCH itself closed
 * because a whole scan no longer saw it. Then THE FIX AND ITS PROOF: a
 * finding's REMEDY on the detail, a CSO `mitigated` the next whole scan
 * VERIFIED (row + stamp), and one the scan contradicted, reopened with the
 * claim it overturned named.
 *
 * The ledger is seeded through the REAL ledger (threatLedgerFor(wallet)
 * .ingest + .assess) in the stack's own temp realm; the window reads it
 * through the real routes. Own backend child, own vite, real
 * challenge-sign-verify auth, real disk. No mock anywhere (RULE 0).
 * SAFETY LAW: NEVER a live stack — PID-derived bind-probed ports, a
 * disposable temp WORKSPACES_ROOT with realm and settings routed into it,
 * every machine-wide security file pinned into a temp dir; RUN SCAN is never
 * pressed (it would read real repos and speak to OSV). Shots:
 * test/e2e/shots/security-*.png
 */

const CSO = { id: 'e2e-sec-bizulen', name: 'Bizulen', utc: '2026-08-10T12:00:00.000Z' };
const MEMBERS = [CSO];

const CRITICAL = {
  layer: 'software', source: 'osv', repo: 'neuma', externalId: 'GHSA-e2e-crit-0001', severity: 'critical',
  title: 'Prototype pollution in deep-merge', summary: 'A crafted key reaches Object.prototype.',
  affected: [{ package: 'deep-merge', version: '1.0.0' }], shipped: true,
  remedy: 'upgrade deep-merge 1.0.0 → ≥1.0.1 (shipped, direct dependency — bump it in package.json)',
};
const SETTLED = {
  layer: 'software', source: 'osv', repo: 'neuma', externalId: 'GHSA-e2e-cso-0002', severity: 'medium',
  title: 'ReDoS in a markdown tokenizer', summary: 'Catastrophic backtracking on nested emphasis.',
  affected: [{ package: 'md-tok', version: '2.3.1' }], shipped: true,
};
const UNREAD = {
  layer: 'software', source: 'osv', repo: 'neuma', externalId: 'GHSA-e2e-new-0003', severity: 'low',
  title: 'dev-only: path traversal in a test fixture server', shipped: false,
  affected: [{ package: 'fixture-serve', version: '0.4.0' }],
};
const VANISHING = {
  layer: 'hardware', source: 'host-probe', repo: null, externalId: 'listener:59999', severity: 'medium',
  title: 'Unexpected listener on :59999',
};
const CSO_REASONING = 'The tokenizer only ever reads the operator\'s own notes; no remote input reaches it.';
// A claim the next whole scan PROVES (the key is gone from the file)…
const VERIFIED = {
  layer: 'software', source: 'secret-sweep', repo: 'neuma', externalId: 'sweep:aws-access-key:config.txt:e2e00001', severity: 'high',
  title: 'possible exposed secret (aws-access-key) in config.txt',
};
// …and one it CONTRADICTS (the listener still answers).
const CONTRADICTED = {
  layer: 'hardware', source: 'host-probe', repo: null, externalId: 'host:listener:network:27500', severity: 'high',
  title: 'unexpected listener on port 27500, reachable from the LAN or the internet', process: 'fixture-daemon',
};

// Every machine-wide security file the backend child (and this process)
// might read or move, pinned into a temp dir before the stack spawns — the
// child inherits process.env when isolated-house spreads it.
const SEC_ENV = {
  NEUMA_SECURITY_THREATS_PATH: 'security-threats.json',
  NEUMA_SECURITY_CSO_PATH: 'security-cso.json',
  NEUMA_SECURITY_WATCH_PATH: 'security-watch.json',
  NEUMA_SECURITY_SCAN_STATE_PATH: 'security-scan-state.json',
  NEUMA_SECURITY_HOST_PATH: 'security-host.json',
  NEUMA_SECURITY_BREAKERS_PATH: 'security-breakers.json',
};
const saved = {};
let secDir = null;
test.beforeAll(async () => {
  secDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'security-app-e2e-'));
  for (const [key, name] of Object.entries(SEC_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = path.join(secDir, name);
  }
});

const stack = setupIsolatedHouse(MEMBERS, 5231);

// The house's ledger, written by the real ledger module in the stack's realm.
// Imported only now so the realm door is open before the module reads it.
const seeded = {};
test.beforeAll(async () => {
  for (const key of ['NEUMA_REALM_ROOT', 'WORKSPACES_ROOT']) saved[key] = process.env[key];
  process.env.NEUMA_REALM_ROOT = path.join(stack.root, 'realm');
  process.env.WORKSPACES_ROOT = stack.root;
  const { setRealmRoot } = await import('../../backend/services/user-realm.js');
  setRealmRoot(process.env.NEUMA_REALM_ROOT);
  const { threatLedgerFor } = await import('../../backend/services/security/threat-ledger.js');
  const ledger = await threatLedgerFor(stack.addr);
  const first = await ledger.ingest([CRITICAL, SETTLED, UNREAD, VANISHING]);
  for (const e of first.added) seeded[e.externalId] = e.id;
  const verdict = await ledger.assess(seeded[SETTLED.externalId], {
    status: 'not_affected', assessment: CSO_REASONING, assessedBy: CSO.id,
  });
  expect(verdict.ok).toBe(true);
  // A whole host scan that no longer sees the listener: the watch closes it.
  const second = await ledger.ingest([], { scanned: [{ source: 'host-probe', repo: null }] });
  expect(second.closed.map((e) => e.externalId)).toEqual([VANISHING.externalId]);
  // Two CSO claims of `mitigated`; the next whole scan proves one and
  // contradicts the other.
  const third = await ledger.ingest([VERIFIED, CONTRADICTED]);
  for (const e of third.added) seeded[e.externalId] = e.id;
  await ledger.assess(seeded[VERIFIED.externalId], { status: 'mitigated', assessment: 'key rotated; the file reads the vault now', assessedBy: CSO.id });
  await ledger.assess(seeded[CONTRADICTED.externalId], { status: 'mitigated', assessment: 'closed the port', assessedBy: CSO.id });
  const fourth = await ledger.ingest([CONTRADICTED], {
    scanned: [{ source: 'secret-sweep', repo: 'neuma' }, { source: 'host-probe', repo: null }],
  });
  expect(fourth.verified.map((e) => e.externalId)).toEqual([VERIFIED.externalId]);
  expect(fourth.reopened.map((e) => e.externalId)).toEqual([CONTRADICTED.externalId]);
});

test.afterAll(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (secDir) await fs.promises.rm(secDir, { recursive: true, force: true });
});

test.use({ viewport: { width: 1500, height: 1000 } });

// pure-ish — the computed text color of an element, for "loud reads loud".
const colorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color);

test('the security window: the dangerous first, a verdict reopened, the watch closing what is gone', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await openDesk(page, stack, CSO);
  await openDockApp(page, 'SECURITY');
  const sec = page.locator('.sec');
  await expect(sec).toBeVisible();
  const win = page.locator('.fwin', { has: sec });
  await win.locator('.fwin-bar').dblclick(); // full size: the whole office in view

  // THE LEDGER — all six, the critical first and loud
  const rows = sec.locator('.sec-row');
  await expect(rows).toHaveCount(6);
  const top = rows.first();
  await expect(top).toBeVisible();
  await expect(top.locator('.sec-row-id')).toHaveText(CRITICAL.externalId);
  const topSeverity = top.locator('.sec-tag').first();
  await expect(topSeverity).toHaveText('CRITICAL');
  await expect(topSeverity).toHaveClass(/is-loud/);
  const lowRow = rows.filter({ hasText: UNREAD.externalId });
  await expect(lowRow.locator('.sec-tag').first()).toHaveText('LOW');
  // loud is SEEN: the critical's tag wears another color than the quiet low's
  expect(await colorOf(topSeverity)).not.toBe(await colorOf(lowRow.locator('.sec-tag').first()));
  await expect(rows.filter({ hasText: UNREAD.externalId }).locator('.sec-row-title')).toHaveText(UNREAD.title);
  await expect(sec.locator('.sec-strip')).toContainText('NEW 3');
  await expect(sec.locator('.sec-strip')).toContainText('NOT AFFECTED 1');
  await expect(sec.locator('.sec-strip')).toContainText('MITIGATED 2');
  await shot(win, 'security-01-ledger');

  // A CSO-SETTLED verdict opens whole, and offers REOPEN
  const settledRow = rows.filter({ hasText: SETTLED.externalId });
  await expect(settledRow.locator('.sec-tag').nth(1)).toHaveText('NOT AFFECTED');
  await settledRow.click();
  const detail = sec.locator('.sec-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.sec-detail-id')).toHaveText(SETTLED.externalId);
  await expect(detail.locator('.sec-detail-head .sec-tag').nth(1)).toHaveText('NOT AFFECTED');
  const reports = detail.locator('.sec-report');
  await expect(reports).toHaveCount(1);
  await expect(reports.first().locator('.sec-report-head')).toContainText(`BY ${CSO.id.toUpperCase()}`);
  await expect(reports.first().locator('.sec-report-body')).toHaveText(CSO_REASONING);
  const reopen = detail.getByRole('button', { name: 'REOPEN' });
  await expect(reopen).toBeVisible();
  await expect(reopen).toBeEnabled();
  await shot(win, 'security-02-settled');

  // REOPEN: the threat reads NEW; the CSO's verdict stands in the history
  // beside the operator's reopen; the list says so too
  await reopen.click();
  await expect(detail.locator('.sec-detail-head .sec-tag').nth(1)).toHaveText('NEW');
  await expect(detail.getByRole('button', { name: 'REOPEN' })).toHaveCount(0);
  await expect(reports).toHaveCount(2);
  await expect(reports.nth(0).locator('.sec-report-head .sec-tag')).toHaveText('NOT AFFECTED');
  await expect(reports.nth(0).locator('.sec-report-head')).toContainText(`BY ${CSO.id.toUpperCase()}`);
  await expect(reports.nth(0).locator('.sec-report-body')).toHaveText(CSO_REASONING);
  const reopenRow = reports.nth(1);
  await expect(reopenRow.locator('.sec-report-head')).toContainText('REOPENED');
  const shortOperator = `${stack.addr.slice(0, 6)}…${stack.addr.slice(-4)}`.toUpperCase();
  await expect(reopenRow.locator('.sec-report-head')).toContainText(`BY THE OPERATOR ${shortOperator}`);
  await expect(reopenRow.locator('.sec-report-head')).not.toContainText(stack.addr.toUpperCase()); // never the raw 42-char wallet
  await expect(reopenRow.locator('.sec-report-head')).not.toContainText('INVALID DATE');
  await expect(reopenRow.locator('.sec-report-body')).toHaveText('reopened by the operator from the desk');
  await expect(settledRow.locator('.sec-tag').nth(1)).toHaveText('NEW');
  await expect(sec.locator('.sec-strip')).toContainText('NEW 4');
  await expect(sec.locator('.sec-strip')).not.toContainText('NOT AFFECTED');
  await shot(win, 'security-03-reopened');

  // AN UNREAD threat: nothing to reopen, and it says it is unread
  await rows.filter({ hasText: UNREAD.externalId }).click();
  await expect(detail.locator('.sec-detail-id')).toHaveText(UNREAD.externalId);
  await expect(detail.locator('.sec-detail-head .sec-tag').nth(1)).toHaveText('NEW');
  await expect(detail.getByRole('button', { name: 'REOPEN' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'CLOSE' })).toBeVisible();
  await expect(detail.locator('.sec-report-empty')).toHaveText('NO VERDICT YET — THIS THREAT IS UNREAD.');
  await shot(win, 'security-04-unread');

  // THE WATCH CLOSED what a whole scan no longer saw — and says so, by watch
  await rows.filter({ hasText: VANISHING.externalId }).click();
  await expect(detail.locator('.sec-detail-id')).toHaveText(VANISHING.externalId);
  await expect(detail.locator('.sec-detail-head .sec-tag').nth(1)).toHaveText('MITIGATED');
  const watchRow = detail.locator('.sec-report').last();
  await expect(watchRow.locator('.sec-report-head .sec-tag')).toHaveText('MITIGATED');
  await expect(watchRow.locator('.sec-report-head')).toContainText('BY WATCH');
  await expect(watchRow.locator('.sec-report-body')).toContainText('no longer seen by the host-probe scan at');
  await expect(detail.getByRole('button', { name: 'REOPEN' })).toBeVisible();
  await shot(win, 'security-05-watch-closed');

  // THE FIX — the critical says exactly how it is fixed
  await rows.filter({ hasText: CRITICAL.externalId }).click();
  await expect(detail.locator('.sec-detail-id')).toHaveText(CRITICAL.externalId);
  const remedy = detail.locator('.sec-detail-remedy');
  await expect(remedy).toBeVisible();
  await expect(remedy).toHaveText(`REMEDY — ${CRITICAL.remedy}`);
  await shot(win, 'security-06-remedy');

  // A CLAIM PROVEN — the CSO's mitigated, then the watch's VERIFIED row and stamp
  await rows.filter({ hasText: VERIFIED.externalId }).click();
  await expect(detail.locator('.sec-detail-id')).toHaveText(VERIFIED.externalId);
  await expect(detail.locator('.sec-detail-head .sec-tag').nth(1)).toHaveText('MITIGATED');
  await expect(detail.locator('.sec-detail-verified')).toContainText('VERIFIED BY THE WATCH');
  await expect(detail.locator('.sec-detail-remedy')).toContainText('rotate the aws-access-key credential in config.txt at AWS IAM');
  const proven = detail.locator('.sec-report');
  await expect(proven).toHaveCount(2);
  await expect(proven.nth(0).locator('.sec-report-head')).toContainText(`BY ${CSO.id.toUpperCase()}`);
  await expect(proven.nth(1).locator('.sec-report-head .sec-tag')).toHaveText('VERIFIED');
  await expect(proven.nth(1).locator('.sec-report-head')).toContainText('BY WATCH');
  await expect(proven.nth(1).locator('.sec-report-body')).toContainText('verified by the secret-sweep scan at');
  await expect(proven.nth(1).locator('.sec-report-body')).toContainText(`since the mitigation claimed by ${CSO.id}`);
  await shot(win, 'security-07-verified');

  // A CLAIM CONTRADICTED — reopened, the overturned claim named
  await rows.filter({ hasText: CONTRADICTED.externalId }).click();
  await expect(detail.locator('.sec-detail-id')).toHaveText(CONTRADICTED.externalId);
  await expect(detail.locator('.sec-detail-head .sec-tag').nth(1)).toHaveText('NEW');
  await expect(detail.locator('.sec-detail-verified')).toHaveCount(0);
  await expect(detail.locator('.sec-detail-remedy')).toContainText('stop fixture-daemon or rebind it to 127.0.0.1');
  const overturned = detail.locator('.sec-report');
  await expect(overturned).toHaveCount(2);
  await expect(overturned.nth(0).locator('.sec-report-head .sec-tag')).toHaveText('MITIGATED');
  await expect(overturned.nth(1).locator('.sec-report-head .sec-tag')).toHaveText('REOPENED');
  await expect(overturned.nth(1).locator('.sec-report-head')).toContainText('BY WATCH');
  await expect(overturned.nth(1).locator('.sec-report-body'))
    .toContainText(`mitigation claimed by ${CSO.id} at`);
  await expect(overturned.nth(1).locator('.sec-report-body')).toContainText('but the host-probe scan still sees it');
  await shot(win, 'security-08-claim-reopened');

  expect(crashes, crashes.join(' | ')).toEqual([]);
});
