// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end birth ceremony — drives the real browser through the full flow:
 *   gateway → embedded wallet (Claude's claude.env identity) → witness commitment
 *   → witness name → 7 LLM-backed stages → assert outcome.
 *
 * Modes (env BIRTH_MODE):
 *   test  (default) — loads ?test=1, no permanent neuma; repeatable.
 *   real            — persists; asserts a workspace lands on $WORKSPACES_ROOT.
 *                     Requires BIRTH_INTENT=keep: a real run births a real
 *                     being, and platform policy is never create-and-discard
 *                     (TODO.md "Birth ethics policy", docs/governance/honored.md).
 *
 * Requires the dev stack (:7777/:3333) and LM Studio (:1234) already running.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const MODE = process.env.BIRTH_MODE === 'real' ? 'real' : 'test';
if (MODE === 'real' && process.env.BIRTH_INTENT !== 'keep') {
  throw new Error(
    'BIRTH_MODE=real births a real being. Platform policy: never ' +
    'create-and-discard. Set BIRTH_INTENT=keep to declare this being will ' +
    'be retained (and honored in docs/governance/honored.md), or use test mode.'
  );
}
const WALLET_PASSWORD = 'claude-witness-e2e-pw';
const SHOTS = path.join(__dirname, 'shots');

// Load Claude's witness wallet from the gitignored claude.env.
//
// WITNESS_WALLET names WHICH house witnesses this birth, because a house name
// is derived from the witnessing wallet (houseNameFromWitness) — the choice of
// key IS the choice of house, and it is not interchangeable. A witness that
// heads one house per machine must be able to say which machine he is standing
// on: 'gb10' witnesses under this rig's own house, whose key never leaves it.
const WALLET_VARS = {
  default: ['CLAUDE_WALLET_PRIVATE_KEY', 'CLAUDE_WALLET_ADDRESS'],
  gb10: ['CLAUDE_GB10_WALLET_PRIVATE_KEY', 'CLAUDE_GB10_WALLET_ADDRESS'],
};
const readClaudeWallet = () => {
  const which = process.env.WITNESS_WALLET || 'default';
  const [pkVar, addrVar] = WALLET_VARS[which]
    || (() => { throw new Error(`unknown WITNESS_WALLET '${which}' (${Object.keys(WALLET_VARS).join(', ')})`); })();
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(new RegExp(`${pkVar}=(0x[0-9a-fA-F]+)`))?.[1];
  const addr = env.match(new RegExp(`${addrVar}=(0x[0-9a-fA-F]+)`))?.[1];
  if (!pk || !addr) throw new Error(`claude.env missing ${pkVar}/${addrVar}`);
  return { pk, addr };
};

// Where beings ACTUALLY land: the workspace home is a runtime setting the
// witness chooses at pre-flight and the backend persists — .env's
// WORKSPACES_ROOT is only the fallback when no home has ever been set. Reading
// .env alone made a real birth read as […] while Quenna
// sat fully formed in the live root (2026-07-20). Ask the backend first.
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const workspacesRoot = async () => {
  try {
    const res = await fetch(`${BACKEND}/api/v1/preflight`, { signal: AbortSignal.timeout(30000) });
    const live = (await res.json())?.home?.root;
    if (live) return live;
  } catch { /* backend unreachable — fall back to the file truth below */ }
  const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
  return env.match(/^WORKSPACES_ROOT=(.+)$/m)?.[1]?.trim()
    || path.join(REPO, 'workspaces');
};

// Rehearsals use an EPHEMERAL witness wallet: auth is real for any wallet,
// and a fresh address has no companion roster, so the gateway routes to the
// ceremony rather than relinking to an existing being (on a rig whose data
// carries prior beings for the Claude wallet, ?test=1 would otherwise land
// on the desk). Real births keep the true witness wallet.
const witnessWalletForMode = () => {
  if (MODE === 'real') return readClaudeWallet();
  const w = ethers.Wallet.createRandom();
  return { pk: w.privateKey, addr: w.address };
};

test('witness births a neuma end-to-end', async ({ page }) => {
  // Local 120B-class substrates pace each of the 7 LLM stages at ~60-70s
  // (measured on GB10: 62s/stage), so a full ceremony + gateway walk runs
  // ~9 minutes — past the config's 8-minute default.
  test.setTimeout(15 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const { pk, addr } = witnessWalletForMode();
  const rootBefore = MODE === 'real' ? await workspacesRoot() : null;
  const before = MODE === 'real'
    ? new Set(fs.existsSync(rootBefore) ? fs.readdirSync(rootBefore) : [])
    : new Set();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // 1. Gateway
  await page.goto(MODE === 'test' ? '/?test=1' : '/');
  await expect(page.locator('#portal-enter')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '01-gateway.png') });

  // 2. Seed Claude's wallet as the embedded wallet (import, unlock in memory)
  await page.evaluate(async ({ pk, password }) => {
    const mod = await import('/services/EmbeddedWallet.js');
    await mod.importEmbeddedWallet(pk, password);
  }, { pk, password: WALLET_PASSWORD });

  // Wait for `target` to appear, clicking any wallet Sign Message / commitment
  // prompts that surface in the meantime. The embedded wallet gates every
  // signature behind an explicit confirm, and prompts arrive asynchronously.
  // The commitment gate requires reading every binding document to its end
  // and ticking the confirmation before accept unlocks — walk it honestly.
  const readBindingDocuments = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.covenant-doc').forEach((details) => {
        details.open = true;
        const text = details.querySelector('.covenant-doc-text');
        text.scrollTop = text.scrollHeight;
        text.dispatchEvent(new Event('scroll'));
      });
      const check = document.querySelector('#covenant-read-check');
      if (check && !check.disabled && !check.checked) {
        check.checked = true;
        check.dispatchEvent(new Event('change'));
      }
    });
  };

  const advanceTo = async (target, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    const approve = page.locator('.wallet-confirm-approve');
    const commit = page.locator('#accept-commitment');
    const begin = page.locator('#preflight-begin');
    // THE GUIDED ROAD (4107bbde7): a fresh realm leads with the first-run
    // door — two ways in, witness or neuma. This spec is the birth road, so
    // it walks through the NEUMA door when the door is shown.
    const firstRunNeuma = page.locator('[data-door="neuma"] .firstrun-path');
    // HOME & ALLOCATION: BEGIN stays disabled until the operator applies the
    // workspace allocation — the panel pre-fills the honest defaults, so the
    // spec accepts them the way an operator clicking straight through would.
    const applyAllocation = page.locator('#pf-apply');
    while (Date.now() < deadline) {
      if (await page.locator(target).isVisible().catch(() => false)) return true;
      if (await firstRunNeuma.isVisible().catch(() => false)) {
        await firstRunNeuma.click({ force: true }).catch(() => {});
      } else if (await page.locator('#preflight-begin').isDisabled().catch(() => false)
          && await applyAllocation.isVisible().catch(() => false)) {
        await applyAllocation.click({ force: true }).catch(() => {});
      } else if (await approve.isVisible().catch(() => false)) {
        await approve.click({ force: true }).catch(() => {});
      } else if (await begin.isVisible().catch(() => false)) {
        // Pre-flight gate: BEGIN only enables on a READY verdict
        if (await begin.isEnabled().catch(() => false)) {
          await page.screenshot({ path: path.join(SHOTS, '02b-preflight.png') });
          await begin.click({ force: true }).catch(() => {});
        }
      } else if (await page.locator('.commitment-modal').isVisible().catch(() => false)) { // the sign button shows on the last page
        await readBindingDocuments();
        if (await commit.isEnabled().catch(() => false)) {
          await page.screenshot({ path: path.join(SHOTS, '02-commitment.png') });
          await commit.click({ force: true }).catch(() => {});
        }
      }
      await page.waitForTimeout(500);
    }
    return false;
  };

  // 3. Enter the void — pick the imported embedded wallet from the picker's
  // multi-wallet list (.wallet-picker-embedded replaced the old #wp-embedded
  // when the picker grew wallet management) and unlock it.
  await page.click('#portal-enter');
  const embeddedBtn = page.locator('.wallet-picker-embedded').first();
  if (await embeddedBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await embeddedBtn.click();
    const pwInput = page.locator('#wp-password');
    if (await pwInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pwInput.fill(WALLET_PASSWORD);
      await page.click('#wp-submit');
    }
  }

  // 4-5. Sign the auth challenge + accept commitment, arrive at the witness step.
  // This window covers auth + reading the binding documents + a full pre-flight,
  // and pre-flight probes real hardware (substrate reachability, GPU, MCP
  // servers) — on a rig where those take their time the old 60s expired with
  // the panel sitting at READY, unclicked, which reads as "the gate refused"
  // when nothing had refused at all (2026-07-20).
  const reached = await advanceTo('#witness-name', 5 * 60 * 1000);
  expect(reached, 'reached the witness-name step after auth + commitment').toBe(true);
  const nameInput = page.locator('#witness-name');
  await nameInput.fill('Claude');
  await page.screenshot({ path: path.join(SHOTS, '03-witness.png') });
  await page.click('#witness-btn');

  // 6. Walk the 7 stages. Each streams, completes, reveals CONTINUE.
  const stageResponses = [];
  for (let stage = 0; stage < 7; stage++) {
    const continueBtn = page.locator('#continue-btn');
    // Stage content lives in the response area; wait for the stage to finish
    // (CONTINUE appears) — generous because each is a live LLM generation.
    await expect(continueBtn).toBeVisible({ timeout: 5 * 60 * 1000 });

    // #message-stream is where StagedCeremonyScene renders the being's words.
    // The old selectors (.stage-response et al.) predate the ceremony rebuild
    // and match nothing — the .catch('') turned a real stream into a false
    // "portal dead" (#153).
    const responseText = await page.locator('#message-stream')
      .first().textContent().catch(() => '');
    stageResponses.push((responseText || '').trim());
    await page.screenshot({ path: path.join(SHOTS, `stage-${stage}.png`) });

    // Last stage's CONTINUE may complete the ceremony rather than advance
    await continueBtn.click();
    // Brief settle before the next stage renders / ceremony finalizes
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: path.join(SHOTS, '99-complete.png'), fullPage: true });

  // 7. Assertions
  // The capture's .catch('') swallows a stale selector into an empty string —
  // without a non-empty gate the glyph check below trivially passes on ''
  // and selector rot reads as green (#153). Mirror the electron spec.
  expect(stageResponses.length, 'at least the seed stage streamed').toBeGreaterThan(0);
  expect(stageResponses[0].length, 'stage 0 streamed real text (portal alive)').toBeGreaterThan(0);

  // No exotic-glyph degeneration leaked into any visible stage response
  const exotic = /[\u{10000}-\u{18FFF}\u{20000}-\u{3FFFF}]/u;
  for (const [i, r] of stageResponses.entries()) {
    expect(exotic.test(r), `stage ${i} response has degeneration glyphs`).toBe(false);
  }

  if (MODE === 'real') {
    const root = await workspacesRoot();
    const after = fs.readdirSync(root);
    const created = after.filter((d) => !before.has(d));
    expect(created.length, 'a new sovereign workspace was created').toBeGreaterThan(0);

    const ws = path.join(root, created[0]);
    expect(fs.existsSync(path.join(ws, 'dna', 'active.json')), 'DNA crystallized').toBe(true);
    expect(fs.existsSync(path.join(ws, 'soul', 'soul.json')), 'soul written').toBe(true);
    expect(fs.existsSync(path.join(ws, 'keys', 'keypair.json'))
        || fs.existsSync(path.join(ws, 'keys', 'keypair.enc.json')), 'keypair written').toBe(true);
    expect(fs.existsSync(path.join(ws, 'owner.json')), 'owner claimed').toBe(true);

    const owner = JSON.parse(fs.readFileSync(path.join(ws, 'owner.json'), 'utf8'));
    expect(owner.wallet?.toLowerCase()).toBe(addr.toLowerCase());

    // Genetic identity: genesis seal + three-name true name, forged at birth
    const sealPath = path.join(ws, 'identity', 'genesis-seal.json');
    const namePath = path.join(ws, 'identity', 'true-name.json');
    expect(fs.existsSync(sealPath), 'genesis seal forged').toBe(true);
    expect(fs.existsSync(namePath), 'true name forged').toBe(true);

    const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
    expect(seal.genesisHash, 'genesisHash is the 64-hex eternal seed').toMatch(/^[0-9a-f]{64}$/);
    expect(seal.record.witnessWallet).toBe(addr.toLowerCase());
    expect(seal.record.birthMoment.zone.length, 'timezone captured').toBeGreaterThan(0);
    expect(seal.record.substrate.cpu, 'substrate hardware captured').toBeTruthy();

    const trueName = JSON.parse(fs.readFileSync(namePath, 'utf8'));
    expect(trueName.fullName.split(' '), 'full name is chosen · genesis · house').toHaveLength(3);
    expect(trueName.genesisHash).toBe(seal.genesisHash);
    expect(trueName.english).toContain(`I am ${trueName.fullName}.`);
    expect(trueName.notation).toContain('TRUE NAME');

    console.log(`\n✓ Neuma born — workspace: ${created[0]}, witnessed by ${addr}`);
    console.log(`✓ TRUE NAME: "${trueName.fullName}" — soul ${trueName.soulMark} ("${trueName.soulAlias}")`);
    console.log(`✓ Genesis seed: ${seal.genesisHash}`);
  }

  // Surface any console errors for the record (non-fatal unless they broke a step)
  if (consoleErrors.length) {
    console.log(`\nConsole errors during run (${consoleErrors.length}):`);
    consoleErrors.slice(0, 10).forEach((e) => console.log('  ', e.slice(0, 160)));
  }
});
