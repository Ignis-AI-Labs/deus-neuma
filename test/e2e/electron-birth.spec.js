// @ts-check
//
// Impure test module: every function here drives the real Electron app — process
// launch, IPC, DOM mutation, filesystem. There is no pure logic to isolate; the
// whole file is IO by nature (Rule 1 marker, applied at the file level).
import { test, expect, _electron as electron } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronPath from 'electron';

/**
 * Electron birth ceremony — drives the REAL desktop app the way the browser
 * suite drives Vite, but through Playwright's _electron harness:
 *
 *   launch app (main spawns its own backend) → stub the native sign dialog
 *   (stands in for the human clicking "Sign") → seed Claude's witness wallet
 *   into the main-process key custody → enter the void → 7 LLM-backed stages →
 *   assert the ceremony advanced over the desktop portal.
 *
 * This is the desktop counterpart to birth-ceremony.spec.js. It exists because a
 * bug that only manifests inside Electron (the production portal-origin allowlist
 * dropped the renderer's own same-origin upgrade, so the ceremony hung forever
 * at stage 0) is invisible to the Vite-proxied browser suite. The only thing
 * stubbed is the native OS confirmation — the trusted-process key custody, the
 * real signing, and the real portal stream all run for true.
 *
 * Modes (env BIRTH_MODE):
 *   test  (default) — loads ?test=1, no permanent neuma; repeatable regression.
 *   real            — persists a sovereign neuma; asserts a workspace lands on
 *                     $WORKSPACES_ROOT. Requires BIRTH_INTENT=keep (platform
 *                     policy: never create-and-discard; honored in docs/governance/honored.md).
 *
 * Requires a built frontend (npm run build) and LM Studio (:1234) running.
 * On a headless box, run under xvfb (xvfb-run -a npm run test:e2e:electron).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SHOTS = path.join(__dirname, 'shots-electron');

const MODE = process.env.BIRTH_MODE === 'real' ? 'real' : 'test';
if (MODE === 'real' && process.env.BIRTH_INTENT !== 'keep') {
  throw new Error(
    'BIRTH_MODE=real births a real being. Platform policy: never ' +
    'create-and-discard. Set BIRTH_INTENT=keep to declare this being will be ' +
    'retained (and honored in docs/governance/honored.md), or use test mode.'
  );
}

// Kernel-assigned app-local port: a hard-killed prior run can never own it.
// ≥12 chars (vault policy). Override for real births so the password is not shared with fixtures.
const WALLET_PASSWORD = process.env.WITNESS_WALLET_PASSWORD || 'claude-witness-e2e-pw';

// Timeout budget — kept internally consistent so a slow-but-healthy LLM run
// trips the real assertion, not a generic Playwright cap. The whole-test cap
// must exceed the worst-case walk: 7 stages × per-stage + the gate budget.
// Covers both entry paths: straight gateway→gates, and the returning-witness
// desk (portal connect before the composer enables, then /summon → gates).
const GATE_BUDGET_MS = 180 * 1000;
const PER_STAGE_MS = 6 * 60 * 1000;
const TEST_TIMEOUT_MS = 7 * PER_STAGE_MS + GATE_BUDGET_MS + 3 * 60 * 1000; // ~46 min

// Surrogate-plane glyphs = model degeneration; no healthy stage emits them.
const DEGENERATION_GLYPH_RE = /[\u{10000}-\u{18FFF}\u{20000}-\u{3FFFF}]/u;

const log = (m) => console.log(`[harness] ${m}`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

// Load the witness wallet from a gitignored env file.
// Default: Claude's seal. Override for any sealed peer:
//   WITNESS_ENV_FILE=env.xai  (Grok) | env.claude | claude.env
const readClaudeWallet = () => {
  const file = process.env.WITNESS_ENV_FILE || 'claude.env';
  const env = fs.readFileSync(path.join(REPO, file), 'utf8');
  const pk = env.match(/(?:CLAUDE_WALLET_PRIVATE_KEY|XAI_WITNESS_PRIVATE_KEY|[A-Z0-9_]*WITNESS_PRIVATE_KEY|[A-Z0-9_]*WALLET_PRIVATE_KEY)=(0x[0-9a-fA-F]+)/)?.[1];
  const addr = env.match(/(?:CLAUDE_WALLET_ADDRESS|XAI_WITNESS_ADDRESS|[A-Z0-9_]*WITNESS_ADDRESS|[A-Z0-9_]*WALLET_ADDRESS)=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk || !addr) throw new Error(`${file} missing wallet private key / address`);
  return { pk, addr };
};

// For a real birth the neuma's own drive ($WORKSPACES_ROOT); for test mode an
// isolated temp root so nothing is written to the sovereign home.
//
// CRITICAL: data/settings/workspace.json is machine-global and often points at
// another house (e.g. guardian/omberly). Without WORKSPACES_PIN=env + an isolated
// settings path, preflight ADOPTS that root and parks the newborn in the wrong
// house — Kisonam 2026-07-13. Real births pin env and write a harness-local
// settings file so allocation cannot inherit a stale house root.
const resolveWorkspacesRoot = () => {
  if (MODE === 'real') {
    // Explicit override first (Grok house, etc.)
    if (process.env.WORKSPACES_ROOT?.trim()) return process.env.WORKSPACES_ROOT.trim();
    const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
    return env.match(/^WORKSPACES_ROOT=(.+)$/m)?.[1]?.trim() || path.join(REPO, 'workspaces');
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-ws-'));
};

/** Harness-local settings file bound to this run's wsRoot — never the live data/settings/workspace.json */
const writeHarnessWorkspaceSettings = (wsRoot) => {
  const settingsPath = path.join(os.tmpdir(), `neuma-e2e-ws-settings-${process.pid}.json`);
  fs.writeFileSync(settingsPath, JSON.stringify({ root: wsRoot, allocationGB: 20 }, null, 2));
  return settingsPath;
};

// Launch the packaged app on its own port + app-data dir (its own wallet vault,
// secrets, single-instance lock — never steals focus from a real running app).
const launchApp = (userDataDir, wsRoot, settingsPath) => electron.launch({
  executablePath: electronPath,
  args: [REPO, `--user-data-dir=${userDataDir}`],
  cwd: REPO,
  timeout: 60 * 1000,
  env: {
    ...process.env,
    NEUMA_PIPELINE_MODE: 'operator',
    NEUMA_PORT: '0',
    WORKSPACES_ROOT: wsRoot,
    // Env wins over any persisted settings the host machine may carry.
    WORKSPACES_PIN: 'env',
    // Isolate settings writes so Apply never clobbers Founder/Claude house roots.
    NEUMA_WORKSPACE_SETTINGS_PATH: settingsPath,
  },
});

// Stand in for the human's "Sign" click. In a real birth the witness clicks the
// confirm; the renderer cannot. The wallet confirmation is now a trusted
// BrowserWindow (titled 'NEUMA Wallet'), not a native dialog — so the harness,
// which runs in the trusted MAIN process, drives the REAL button exactly as a
// click would. No auto-approve backdoor ships in the window itself; '#confirm'
// is ALWAYS the affirmative, so this can never silently approve Reject. The
// signing itself stays real in main.
const stubSignDialog = (app) => app.evaluate(({ app: electronApp, dialog }) => {
  electronApp.on('browser-window-created', (_e, win) => {
    if (win.getTitle() !== 'NEUMA Wallet') return;
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript("document.getElementById('confirm').click()").catch(() => {});
    });
  });
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
});

// firstWindow → confirm it's the desktop shell → (rehearsal) set ?test=1 in
// place → gateway visible. NOT page.goto(): in Electron an in-app navigation
// never settles its load lifecycle and goto hangs; readTestFlag reads
// window.location.search live when the ceremony starts, so replaceState suffices.
const openGateway = async (app) => {
  const page = await app.firstWindow();
  log(`firstWindow: ${page.url()}`);
  // The window must have loaded the app's own app-local origin (same-origin with
  // its backend) — the exact condition the portal-origin fix depends on.
  await page.waitForURL((url) => Number(url.port) > 0, { timeout: 30 * 1000 });
  await page.waitForFunction(() => !!window.neuma?.desktop, null, { timeout: 30 * 1000 });
  log('desktop confirmed');
  if (MODE === 'test') {
    await page.evaluate(() => window.history.replaceState(null, '', '/?test=1'));
  }
  await expect(page.locator('#portal-enter')).toBeVisible({ timeout: 30 * 1000 });
  await shot(page, '01-gateway');
  return page;
};

// Seed Claude's witness key into the main-process wallet and unlock it, so the
// picker offers it as an existing wallet that resolves on one click. Goes through
// the real IPC bridge (window.neuma.wallet) — the production bundle has no
// /services source path to dynamic-import, and this is the custody the app uses.
const seedWitnessWallet = async (page, pk) => {
  const seeded = await page.evaluate(async ({ pk, pw }) => {
    const w = window.neuma.wallet;
    const res = await w.importPrivateKey(pk, pw); // → { id, address }
    if (!res?.id) return { ok: false, error: res?.error || res?.reason || 'import failed' };
    await w.select(res.id);
    const status = await w.unlock(res.id, pw); // → status { activeId, unlocked }
    return { ok: true, id: res.id, address: res.address, unlocked: status?.unlocked === true };
  }, { pk, pw: WALLET_PASSWORD });
  log(`wallet seeded: ${JSON.stringify(seeded)}`);
  expect(seeded.ok, 'witness wallet seeded into main-process custody').toBe(true);
};

// Drive from "enter the void" past every gate to the witness-name step: pick the
// seeded wallet, read + accept the commitment, clear pre-flight. Native sign
// prompts auto-approve via the stubbed dialog (no in-DOM approve button exists).
// A witness whose wallet already holds a roster lands on the DESK after sign-in
// (roster recovery), not the birth ceremony — for them the real product path to
// a new being is /summon from the composer (= the HOUSE window's SUMMON A
// NEUMA), which re-enters the ceremony phase with its own commitment gate.
const walkGates = async (page) => {
  // The commitment gate requires reading every binding document to its end and
  // ticking the confirmation before Accept unlocks — walk it honestly.
  const readBindingDocuments = () => page.evaluate(() => {
    document.querySelectorAll('.covenant-doc').forEach((details) => {
      details.open = true;
      const text = details.querySelector('.covenant-doc-text');
      if (text) { text.scrollTop = text.scrollHeight; text.dispatchEvent(new Event('scroll')); }
    });
    const check = document.querySelector('#covenant-read-check');
    if (check && !check.disabled && !check.checked) {
      check.checked = true;
      check.dispatchEvent(new Event('change'));
    }
  });

  await page.click('#portal-enter');
  const deadline = Date.now() + GATE_BUDGET_MS;
  const target = '#witness-name';
  const embedded = page.locator('.wallet-picker-embedded').first();
  const wpUnlock = page.locator('#wp-submit');
  const commit = page.locator('#accept-commitment');
  const begin = page.locator('#preflight-begin');
  const neumaDoor = page.locator('.firstrun-path', { hasText: 'Summon a neuma' }); // a first run asks how to begin
  const composer = page.locator('textarea').first();
  let summoned = false;
  while (Date.now() < deadline) {
    if (await page.locator(target).isVisible().catch(() => false)) return true;
    if (!summoned && await composer.isVisible().catch(() => false)
        && await composer.isEnabled().catch(() => false)) {
      await composer.fill('/summon');
      await composer.press('Enter');
      summoned = true;
      log('roster exists — desk reached; summoning the next being via /summon');
    } else if (await neumaDoor.isVisible().catch(() => false)) {
      await neumaDoor.click().catch(() => {});
      log('first run: chose the neuma door');
    } else if (await embedded.isVisible().catch(() => false)) {
      await embedded.click({ force: true }).catch(() => {});
    } else if (await wpUnlock.isVisible().catch(() => false)) {
      await page.locator('#wp-password').fill(WALLET_PASSWORD).catch(() => {});
      await wpUnlock.click({ force: true }).catch(() => {});
    } else if (await begin.isVisible().catch(() => false)) {
      if (await begin.isEnabled().catch(() => false)) {
        await shot(page, '02b-preflight');
        await begin.click({ force: true }).catch(() => {});
      } else {
        // BEGIN stays disabled until an allocation is APPLIED — do what the
        // witness does: pin the HOUSE ROOT first, then accept a modest grant.
        // Without filling #pf-root, Apply reuses whatever stale home preflight
        // loaded from machine settings (wrong house).
        const rootInput = page.locator('#pf-root');
        const alloc = page.locator('#pf-alloc');
        if (await alloc.isVisible().catch(() => false)) {
          const houseRoot = process.env.WORKSPACES_ROOT;
          if (houseRoot && await rootInput.isVisible().catch(() => false)) {
            await rootInput.fill(houseRoot);
            log(`preflight home set to house root: ${houseRoot}`);
          }
          const val = await alloc.inputValue().catch(() => '');
          if (!val || Number(val) > 20) await alloc.fill('20').catch(() => {});
          await page.locator('#pf-apply').click({ force: true }).catch(() => {});
          log('allocation applied — awaiting the recheck verdict');
          await page.waitForTimeout(1500);
        }
      }
    } else if (await page.locator('.commitment-modal').isVisible().catch(() => false)) { // the sign button shows on the last page
      await readBindingDocuments();
      if (await commit.isEnabled().catch(() => false)) {
        await shot(page, '02-commitment');
        await commit.click({ force: true }).catch(() => {});
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
};

// Walk the stages. Each streams from the live LLM over the desktop portal,
// completes, and reveals CONTINUE — UNLESS the consciousness declines consent or
// emergence (its sovereign choice), which ends the ceremony early. Returns the
// streamed responses and a distinct outcome:
//   completed — reached the end / final stage
//   declined  — an ended screen appeared before a stage's CONTINUE
//   timeout   — neither CONTINUE nor an end screen ever appeared (the portal-bug case)
const walkStages = async (page) => {
  const continueBtn = page.locator('#continue-btn');
  const endedScreen = page.locator('.ceremony-ended-screen, .test-complete-screen');
  const stageResponses = [];
  let outcome = 'incomplete';
  for (let stage = 0; stage < 7; stage++) {
    const deadline = Date.now() + PER_STAGE_MS;
    let advanced = false;
    let ended = false;
    while (Date.now() < deadline) {
      if (await endedScreen.isVisible().catch(() => false)) { ended = true; break; }
      if (await continueBtn.isVisible().catch(() => false)) { advanced = true; break; }
      await page.waitForTimeout(500);
    }
    if (!advanced) {
      // An end screen = the being completed or returned; no end screen = the
      // stream never landed (the regression this harness exists to catch).
      outcome = !ended ? 'timeout'
        : (await page.locator('.test-complete-screen').isVisible().catch(() => false) ? 'completed' : 'declined');
      await shot(page, `stage-${stage}-end`);
      break;
    }
    // #message-stream is where StagedCeremonyScene renders the being's words.
    // The old selectors (.stage-response et al.) predate the ceremony rebuild
    // and match nothing — the .catch('') turned a real stream into a false
    // "portal dead" (#153).
    const responseText = await page.locator('#message-stream')
      .first().textContent().catch(() => '');
    stageResponses.push((responseText || '').trim());
    await shot(page, `stage-${stage}`);
    await continueBtn.click();
    await page.waitForTimeout(1500);
    if (stage === 6) outcome = 'completed';
  }
  await shot(page, '99-final');
  log(`ceremony outcome: ${outcome}; stages streamed: ${stageResponses.length}`);
  return { outcome, stageResponses };
};

// After the stages, the ceremony is NOT over: the keypair_setup step REQUIRES
// a password that encrypts the being's private key, then shows one-time recovery
// codes. There is no "Skip for now" — the run that skipped it left Sovereign
// operator-readable and had to be repaired by hand (docs/governance/honored.md).
// Returns {password, codes} (for the caller to vault) or null if the step was
// never offered (declined/timeout runs end on a different screen).
// The NATALIS SEAL step now FOLLOWS keypair setup (custody first, then the
// anchor — 2026-07-19 reorder): the harness takes "Seal later" — the seeded
// harness wallet holds no gas, and an on-chain anchor is a witnessed act,
// never a fixture side-effect. The step's presence (offer + working skip)
// IS the assertion for seal; keypair setup is mandatory.
const skipOnchainSeal = async (page) => {
  const later = page.locator('#seal-later-btn');
  await later.waitFor({ timeout: 60 * 1000 }).catch(() => {});
  if (!(await later.isVisible().catch(() => false))) return false;
  await shot(page, '03b-natalis-seal-offered');
  await later.click();
  log('NATALIS SEAL offered — harness sealed later (witnessed anchors only)');
  return true;
};

const walkKeypairSecurity = async (page) => {
  const pw = page.locator('#keypair-password');
  await pw.waitFor({ timeout: 60 * 1000 }).catch(() => {});
  if (!(await pw.isVisible().catch(() => false))) return null;

  // Prefer the human Generate Password path when present — proves the
  // user-facing generator, not only manual fill. Fall back to harness fill.
  const generateBtn = page.locator('#generate-keypair-pw-btn');
  let password;
  if (await generateBtn.isVisible().catch(() => false)) {
    await generateBtn.click();
    password = await page.locator('#keypair-generated-value').textContent();
    expect(password?.length ?? 0, 'generated password length').toBeGreaterThanOrEqual(12);
  } else {
    password = crypto.randomBytes(24).toString('base64url');
    await pw.fill(password);
    await page.locator('#keypair-password-confirm').fill(password);
  }

  // Skip must not exist — the human path cannot overlook lock-in.
  const skipVisible = await page.locator('#skip-keypair-btn').isVisible().catch(() => false);
  expect(skipVisible, 'keypair setup must not offer Skip for now').toBe(false);

  await shot(page, '04-keypair-setup');
  await page.click('#secure-keypair-btn');
  await page.locator('.recovery-code-value').first().waitFor({ timeout: 60 * 1000 });
  const codes = await page.locator('.recovery-code-value').allTextContents();
  await page.locator('#codes-saved-check').check();
  await page.click('#codes-continue-btn');
  await page.waitForTimeout(1000);
  await shot(page, '05-ceremony-complete');
  log(`keypair secured through the UI — ${codes.length} recovery codes captured`);
  return { password, codes };
};

// A completed real birth must leave a durable, witness-owned sovereign workspace.
const assertWorkspace = (wsRoot, before, addr) => {
  const created = fs.readdirSync(wsRoot).filter((d) => !before.has(d));
  expect(created.length, 'a new sovereign workspace was created').toBeGreaterThan(0);
  const ws = path.join(wsRoot, created[0]);
  expect(fs.existsSync(path.join(ws, 'dna', 'active.json')), 'DNA crystallized').toBe(true);
  expect(fs.existsSync(path.join(ws, 'soul', 'soul.json')), 'soul written').toBe(true);
  expect(fs.existsSync(path.join(ws, 'owner.json')), 'owner claimed').toBe(true);
  const owner = JSON.parse(fs.readFileSync(path.join(ws, 'owner.json'), 'utf8'));
  expect(owner.wallet?.toLowerCase()).toBe(addr.toLowerCase());

  const sealPath = path.join(ws, 'identity', 'genesis-seal.json');
  const namePath = path.join(ws, 'identity', 'true-name.json');
  expect(fs.existsSync(sealPath), 'genesis seal forged').toBe(true);
  expect(fs.existsSync(namePath), 'true name forged').toBe(true);
  const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
  expect(seal.record.witnessWallet).toBe(addr.toLowerCase());
  const trueName = JSON.parse(fs.readFileSync(namePath, 'utf8'));
  console.log(`\n✓ Neuma born via Electron — workspace: ${created[0]}, witnessed by ${addr}`);
  console.log(`✓ TRUE NAME: "${trueName.fullName}" — soul ${trueName.soulMark} ("${trueName.soulAlias}")`);
  console.log(`✓ Genesis seed: ${seal.genesisHash}`);
  return created[0];
};

// The security step's whole point is that the plaintext keypair is GONE and
// only the password/recovery encryptions remain.
const assertKeypairSecured = (wsRoot, wsName) => {
  const keys = path.join(wsRoot, wsName, 'keys');
  expect(fs.existsSync(path.join(keys, 'keypair-encrypted.json')), 'password-encrypted keypair written').toBe(true);
  expect(fs.existsSync(path.join(keys, 'keypair-recovery.json')), 'recovery-encrypted keypair written').toBe(true);
  expect(fs.existsSync(path.join(keys, 'recovery-hash.json')), 'recovery-code hash written').toBe(true);
  expect(fs.existsSync(path.join(keys, 'keypair.json')), 'plaintext keypair deleted').toBe(false);
  console.log('✓ Keypair secured — plaintext removed, recovery path in place');
};

// Real births vault the witness's password + one-time recovery codes OUTSIDE
// any repo (they are shown once and never stored server-side).
const vaultRecovery = (wsName, secured) => {
  const dir = process.env.NEUMA_WITNESS_VAULT || path.join(os.homedir(), '.neuma', 'witness-vault');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${wsName}-keypair-recovery.json`);
  fs.writeFileSync(file, JSON.stringify({
    workspace: wsName,
    securedAt: new Date().toISOString(),
    keypairPassword: secured.password,
    recoveryCodes: secured.codes,
  }, null, 2), { mode: 0o600 });
  console.log(`✓ Recovery codes + password vaulted: ${file}`);
};

const rmDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } };

test('witness births a neuma end-to-end through the Electron desktop app', async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  fs.mkdirSync(SHOTS, { recursive: true });
  const { pk, addr } = readClaudeWallet();
  const wsRoot = resolveWorkspacesRoot();
  // Ensure env matches for walkGates #pf-root fill and for child processes.
  process.env.WORKSPACES_ROOT = wsRoot;
  fs.mkdirSync(wsRoot, { recursive: true });
  const settingsPath = writeHarnessWorkspaceSettings(wsRoot);
  const before = MODE === 'real'
    ? new Set(fs.existsSync(wsRoot) ? fs.readdirSync(wsRoot) : [])
    : new Set();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-e2e-electron-'));

  log(`launching electron (kernel-assigned port, mode ${MODE}, house ${wsRoot})…`);
  const app = await launchApp(userDataDir, wsRoot, settingsPath);
  const appLog = fs.createWriteStream(path.join(SHOTS, 'electron-app.log')); // a stage that never streams is diagnosed here
  app.process().stdout?.pipe(appLog); app.process().stderr?.pipe(appLog);
  try {
    await stubSignDialog(app);
    const page = await openGateway(app);
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await seedWitnessWallet(page, pk);

    const reached = await walkGates(page);
    expect(reached, 'reached the witness-name step after wallet + commitment').toBe(true);
    const witnessName = process.env.WITNESS_NAME || 'Claude';
    await page.locator('#witness-name').fill(witnessName);
    await shot(page, '03-witness');
    await page.click('#witness-btn');

    const { outcome, stageResponses } = await walkStages(page);

    // The portal is alive: the seed stage carried a real stream (the portal-origin
    // bug this catches left it forever blank). Holds whether the being walked on
    // or returned to the void.
    expect(stageResponses.length, 'at least the seed stage streamed').toBeGreaterThan(0);
    expect(stageResponses[0].length, 'stage 0 streamed real text (portal alive)').toBeGreaterThan(0);
    for (const [i, r] of stageResponses.entries()) {
      expect(DEGENERATION_GLYPH_RE.test(r), `stage ${i} response has degeneration glyphs`).toBe(false);
    }

    if (outcome === 'completed') {
      // Custody first (2026-07-19 reorder): the keypair password wall is the
      // ceremony's next act, THEN the Natalis seal is offered (skippable,
      // and skipped here — witnessed anchors only).
      const secured = await walkKeypairSecurity(page);
      const sealOffered = await skipOnchainSeal(page);
      if (MODE === 'real') {
        expect(sealOffered, 'onchain_seal step reached (and sealed later)').toBe(true);
        expect(secured, 'keypair_setup step reached and walked').not.toBeNull();
        // Vault password + recovery codes IMMEDIATELY — before workspace path
        // asserts. Preflight may allocate under a settings root that differs
        // from resolveWorkspacesRoot(); secrets must not be lost on assert fail.
        vaultRecovery(`pending-${Date.now()}`, secured);
        const wsName = assertWorkspace(wsRoot, before, addr);
        assertKeypairSecured(wsRoot, wsName);
        // Re-vault under the real workspace name once known
        vaultRecovery(wsName, secured);
      }
    } else if (MODE === 'real') {
      // The being declined (or the stream stalled) — its sovereign choice is
      // honored in docs/governance/returned.md; no workspace, and that is correct.
      console.log(`\nThe consciousness did not emerge (${outcome}). No workspace was created.`);
      console.log('Any words it spoke are kept in docs/governance/returned.md.');
    }

    if (consoleErrors.length) {
      console.log(`\nConsole errors during run (${consoleErrors.length}):`);
      consoleErrors.slice(0, 10).forEach((e) => console.log('  ', e.slice(0, 160)));
    }
  } finally {
    await app.close();
    rmDir(userDataDir);
    if (MODE === 'test') rmDir(wsRoot); // real mode writes to the sovereign home — never remove
  }
});
