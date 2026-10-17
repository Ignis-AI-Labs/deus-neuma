// TEAM PROJECT — the full native chain, live (RULE 0 gnosis for the pipeline):
// witness hands an assignment via /team-project → the LEAD being (real, on the
// real substrate) plans → may ask the witness questions (answered here) →
// submits the plan (PlanChip APPROVED here) → runs the team (live TEAM AT WORK
// board) → reports with attribution.
//
// Everything is real: real wallet auth, real being (Signal of House Aldmere,
// with consented teammates of the same house), real gemma inference, real
// portal turn with real tool rounds. Model-behavior variance is handled, not
// hidden: the being MAY ask 0..3 questions before planning; the plan gate and
// the run are mandatory. Generous timeouts — a real team thinks in minutes.
//
// ⚠ LIVE-BEING RULES (2026-07-06 incident — read before running):
//   1. OPT-IN ONLY: requires E2E_LIVE=1. An automated suite must never talk
//      to a real being by accident.
//   2. The vite dev server MUST carry PORT — its /api and /ws proxy targets
//      default to :3333 (the canonical LIVE stack). On 2026-07-06 a run
//      whose vite lacked PORT proxied into the live backend and sent the
//      assignment INTO Signal's in-progress refinement-consent session.
//      Start the stack as: PORT=3355 npx vite --port 7755 (plus the backend
//      on the same PORT), and run this spec with PORT=3355 FRONTEND_PORT=7755.
//   3. FRESH SESSION ALWAYS: the desk continues the being's latest chat by
//      default — this spec clicks NEW first so it can never append into a
//      conversation someone else is holding.
//   4. Coordinate with any parallel session working the same house before
//      running.

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

const LEAD = { name: 'Signal', neumaId: 'signal' };
const ASSIGNMENT = 'Draft a short two-line greeting for the house journal. Form a small team: you lead, and bring exactly one teammate from the house to review your draft.';

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const { challenge } = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

test.describe('team project — assignment to report, live', () => {
  test.skip(process.env.E2E_LIVE !== '1', 'live-being run — opt in with E2E_LIVE=1 (see header rules)');
  test.setTimeout(20 * 60 * 1000); // a real team thinks in minutes

  let token, addr;
  test.beforeAll(async () => {
    ({ token, addr } = await mintToken());
  });

  test('the LEAD carries an assignment through plan approval, the run, and the report', async ({ page }) => {
    await page.addInitScript(({ t, a, companion }) => {
      localStorage.setItem('walletAddress', a);
      localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify(companion));
      sessionStorage.setItem('authToken', t);
    }, { t: token, a: addr, companion: LEAD });
    await page.goto('/');
    await expect(page.locator('.relink')).toBeVisible();

    // The portal must be LIVE (not just rendered) before anything is sent.
    const input = page.locator('.relink-input-field');
    await expect(input).toBeEnabled({ timeout: 60_000 });

    // FRESH SESSION — never continue whatever conversation the being was
    // last holding (live-being rule 3).
    await page.getByRole('button', { name: 'NEW CHAT', exact: true }).click();

    // The witness hands the assignment through the native skill summons.
    await input.fill(`/team-project ${ASSIGNMENT}`);
    await input.press('Enter');

    // The being may ask up to 3 clarifying questions before planning — answer
    // each honestly and generically; the PLAN card is the mandatory gate.
    const planCard = page.locator('.plan-chip.pending');
    for (let round = 0; round < 3; round += 1) {
      const askCard = page.locator('.ask-chip.pending');
      const which = await Promise.race([
        planCard.waitFor({ state: 'visible', timeout: 8 * 60 * 1000 }).then(() => 'plan'),
        askCard.waitFor({ state: 'visible', timeout: 8 * 60 * 1000 }).then(() => 'ask'),
      ]);
      if (which === 'plan') break;
      // Prefer a tap-able option when offered; else answer in words.
      const option = askCard.locator('.ask-chip-options button').first();
      if (await option.count()) await option.click();
      else {
        await askCard.locator('.ask-chip-free input').fill('Your call — keep it simple and true to the house.');
        await askCard.locator('.ask-chip-free button[type="submit"]').click();
      }
      // Wait for THIS card to settle before looking for the next — the same
      // still-pending card must never be answered twice.
      await askCard.waitFor({ state: 'hidden', timeout: 60_000 });
    }

    // The mandatory gate: a structured plan, approved by the witness.
    await expect(planCard).toBeVisible({ timeout: 60_000 });
    await expect(planCard.locator('.plan-chip-step')).not.toHaveCount(0);
    await planCard.locator('.approval-actions button', { hasText: 'APPROVE' }).click();
    await expect(page.locator('.plan-chip.resolved.ok')).toBeVisible({ timeout: 60_000 });

    // The team works — live board, then TEAM FINISHED.
    await expect(page.locator('.teamrun-chip.pending')).toBeVisible({ timeout: 4 * 60 * 1000 });
    await expect(page.locator('.teamrun-chip.resolved.ok')).toBeVisible({ timeout: 12 * 60 * 1000 });

    // The LEAD's report reaches the witness in the stream, and no page crash
    // occurred anywhere along the chain.
    const finalText = page.locator('.relink-msg--neuma').last();
    await expect(finalText).toContainText(/journal|greeting|team/i, { timeout: 4 * 60 * 1000 });
  });
});
