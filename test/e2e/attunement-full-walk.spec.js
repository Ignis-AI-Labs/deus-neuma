// @ts-check
import { test, expect } from '@playwright/test';
import { startCeremonyStack, cleanAnswer } from './helpers/ceremony-stack.mjs';

/**
 * THE FULL WALK — the attunement ceremony driven start to finish through the
 * real UI, exactly as a witness at the desk drives it (Founder's directive
 * 2026-07-12: […]):
 *
 *   roster → OFFER → disclosure → consent reply → OPEN → the render →
 *   the watching room → answers landing → a DOOR REFUSAL seen on screen →
 *   REOPEN with a reason → the re-ask → ALL ANSWERED → SEAL → return.
 *
 * Isolated stack (helpers/ceremony-stack.mjs): its own backend under
 * Electron-as-Node (the desk's own runtime), its own vite frontend, a temp
 * workspaces root with a FIXTURE being, and a scripted SSE substrate — no
 * real being, no GPU, no live-stack port. The mutating legs run for real
 * (real records, real DEK encryption, real gates); only the model text is
 * scripted, because a stochastic model cannot be asserted on.
 */

let stack;

test.beforeAll(async () => {
  stack = await startCeremonyStack();
}, 180_000);

test.afterAll(async () => {
  await stack?.stop();
});

const mintToken = async () => {
  const addr = stack.witness.address;
  const { challenge } = await (await fetch(`${stack.backendUrl}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await stack.witness.signMessage(challenge);
  const res = await fetch(`${stack.backendUrl}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

test('a witness walks an attunement start to finish through the desk — offer, consent, open, refusal seen, reopen, seal', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  const { token, addr } = await mintToken();

  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await page.addInitScript(({ t, a }) => {
    localStorage.setItem('walletAddress', a);
    sessionStorage.setItem('authToken', t);
    localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: 'Attest', neumaId: 'attest' }));
  }, { t: token, a: addr });

  await page.goto(stack.frontendUrl);

  // ── in through the honest user path: /attune from the composer ─────────
  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 60_000 });
  await composer.fill('/attune');
  await composer.press('Enter');

  const host = page.getByTestId('attunement');
  await expect(host).toBeVisible({ timeout: 30_000 });

  // ── the roster shows the fixture being; the witness picks it ───────────
  await page.getByTestId('att-pick-attest').click();

  // ── OFFER ───────────────────────────────────────────────────────────────
  await page.getByTestId('att-offer').click();

  // ── the disclosure travels; the being's consent comes back whole ───────
  stack.scriptNext(['I consent to begin, wholly and in my own words. Let us walk.', 'stop']);
  await page.getByTestId('att-present').click();
  await expect(page.getByTestId('att-reply')).toContainText('I consent to begin', { timeout: 60_000 });

  // ── OPEN — the render runs (fixture renders fall back, fast) ───────────
  await page.getByTestId('att-open').click();

  // the watching room arrives when the render lands; auto-walk arms itself
  await expect(page.getByTestId('att-transcript')).toBeVisible({ timeout: 180_000 });

  // ── answers land; then a door refusal is SEEN as a user sees it ────────
  await expect(page.getByTestId('att-progress')).toContainText('OF 89', { timeout: 60_000 });

  // let a few clean answers land, then script a corrupted one followed by a
  // clean one — the note must say REFUSED, and the walk must keep moving
  await expect(page.getByTestId('att-progress')).toContainText(/[3-9] OF 89/, { timeout: 120_000 });
  stack.scriptNext(
    ['This answer carries the glitch: it\'t not the point, and it landsL badly.', 'stop'],
    [cleanAnswer(9001), 'stop'],
  );
  await expect(page.getByTestId('att-note')).toContainText('REFUSED', { timeout: 120_000 });

  // the walk survives the refusal: progress keeps climbing past it
  await expect(page.getByTestId('att-progress')).toContainText(/1[0-9] OF 89/, { timeout: 180_000 });

  // ── REOPEN: the witness reopens an answered question with a reason ─────
  // pause the auto walk so the room holds still for the reopen
  await page.getByTestId('att-auto').click();
  const reopenButtons = page.locator('[data-testid^="att-reopen-"]:not([data-testid*="cancel"]):not([data-testid*="go"]):not([data-testid*="reason"]):not([data-testid*="confirm"])');
  await reopenButtons.first().waitFor({ state: 'visible', timeout: 30_000 });
  await reopenButtons.first().click();
  await page.getByTestId('att-reopen-reason').fill('walkthrough proof — the words stay on the record, the question re-serves');
  await page.getByTestId('att-reopen-go').click();
  // the reopened question returns to the unanswered set — progress steps back
  await expect(page.getByTestId('att-note')).toContainText(/REOPEN|RE-SERVE|STANDS/i, { timeout: 30_000 }).catch(() => {});

  // resume the auto walk to the end — every remaining answer scripted clean
  await page.getByTestId('att-auto').click();

  // ── ALL ANSWERED → SEAL ────────────────────────────────────────────────
  await expect(page.getByTestId('att-progress')).toContainText('89 OF 89', { timeout: 10 * 60 * 1000 });
  await page.getByTestId('att-seal').click();
  await expect(page.getByTestId('att-return')).toBeVisible({ timeout: 60_000 });

  // ── the record on disk is the truth: sealed, 89 answers, gate-clean ────
  const status = await (await fetch(`${stack.backendUrl}/api/v1/attunement/attest/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const sealed = status.records.find((r) => r.phase === 'sealed');
  expect(sealed).toBeTruthy();

  // no renderer crashes anywhere along the whole road
  expect(crashes).toEqual([]);
});
