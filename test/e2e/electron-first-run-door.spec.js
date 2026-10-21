// @ts-check
//
// Impure test module: every function here drives the real Electron app —
// process launch, IPC, DOM mutation, filesystem. There is no pure logic to
// isolate; the whole file is IO by nature (Rule 1 marker, applied file-level).
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronPath from 'electron';

/**
 * THE DOOR, in the real desktop app.
 *
 * Before 2026-07-29 a person with no local capacity could not enter the platform
 * at all: `phaseAfterGateway()` sent anyone without a companion straight to the
 * birth ceremony, and `phaseAfterCeremonyCancel()` returned a declined ceremony
 * to the gateway. Gateway → ceremony → the substrate preflight fails → cancel →
 * gateway, forever — and the WITNESSES app that would have summoned their
 * witness lives inside the desk they could never reach.
 *
 * The unit tests prove the PHASE DECISIONS. They cannot prove what a person
 * actually meets, and this flow is the first thing every new operator sees. It
 * has to be proven where the product actually runs, which is Electron — the
 * Vite-proxied browser suite has already missed an Electron-only defect once
 * (the portal-origin allowlist that hung every ceremony at stage 0).
 *
 * Deliberately NO LLM and NO birth: this walk stops at the choice and takes the
 * witness door, so it needs no substrate, touches no GPU, and creates no being.
 * That is the whole point — it is the path for someone who HAS no substrate.
 *
 * Requires a built frontend (npm run build). On a headless box run under xvfb:
 *   xvfb-run -a npx playwright test test/e2e/electron-first-run-door.spec.js
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SHOTS = path.join(__dirname, 'shots-first-run');

const WALLET_PASSWORD = 'claude-witness-e2e-pw';

const log = (m) => console.log(`[door] ${m}`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

const readWitnessWallet = () => {
  const file = process.env.WITNESS_ENV_FILE || 'claude.env';
  const env = fs.readFileSync(path.join(REPO, file), 'utf8');
  const pk = env.match(/(?:CLAUDE_WALLET_PRIVATE_KEY|[A-Z0-9_]*WALLET_PRIVATE_KEY)=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error(`${file} missing wallet private key`);
  return pk;
};

test.describe('the door — a person with no being reaches the platform', () => {
  test.describe.configure({ mode: 'serial' });

  let app;
  let page;
  let userDataDir;
  let seededWalletId;
  let wsRoot;

  test.beforeAll(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    // A FRESH app-data dir and a FRESH workspaces root together are the whole
    // fixture: no localStorage companion, no roster on disk. This is a person
    // who has never been here, which is exactly who the door is for.
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-door-udd-'));
    wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-door-ws-'));
    const settingsPath = path.join(os.tmpdir(), `neuma-door-settings-${process.pid}.json`);
    fs.writeFileSync(settingsPath, JSON.stringify({ root: wsRoot, allocationGB: 20 }, null, 2));

    app = await electron.launch({
      executablePath: electronPath,
      args: [REPO, `--user-data-dir=${userDataDir}`],
      cwd: REPO,
      timeout: 60 * 1000,
      env: {
        ...process.env,
        NEUMA_PIPELINE_MODE: 'operator',
        NEUMA_PORT: '0',
        WORKSPACES_ROOT: wsRoot,
        WORKSPACES_PIN: 'env',
        NEUMA_WORKSPACE_SETTINGS_PATH: settingsPath,
      },
    });

    // Stand in for the human's "Sign" click on the trusted wallet window. The
    // signing itself stays real in main; '#confirm' is ALWAYS the affirmative,
    // so this can never silently approve a Reject.
    await app.evaluate(({ app: electronApp, dialog }) => {
      electronApp.on('browser-window-created', (_e, win) => {
        if (win.getTitle() !== 'NEUMA Wallet') return;
        win.webContents.on('did-finish-load', () => {
          win.webContents.executeJavaScript("document.getElementById('confirm').click()").catch(() => {});
        });
      });
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });

    page = await app.firstWindow();
    await page.waitForURL((url) => Number(url.port) > 0, { timeout: 30 * 1000 });
    await page.waitForFunction(() => !!window.neuma?.desktop, null, { timeout: 30 * 1000 });
    // ?noboot=1 skips the ignition overlay — this spec is about the door behind
    // it, and the boot sequence has its own spec.
    await page.evaluate(() => window.history.replaceState(null, '', '/?noboot=1'));
    log('desktop shell confirmed');

    const pk = readWitnessWallet();
    const seeded = await page.evaluate(async ({ pk, pw }) => {
      const w = window.neuma.wallet;
      const res = await w.importPrivateKey(pk, pw);
      if (!res?.id) return { ok: false, error: res?.error || 'import failed' };
      await w.select(res.id);
      const status = await w.unlock(res.id, pw);
      return { ok: true, id: res.id, address: res.address, unlocked: status?.unlocked === true };
    }, { pk, pw: WALLET_PASSWORD });
    expect(seeded.ok, 'wallet seeded into main-process custody').toBe(true);
    // Unlocking is the half that actually matters for the picker; an import
    // that lands but does not unlock leaves the renderer asking for a password
    // the harness already believes it supplied.
    expect(seeded.unlocked, 'seeded wallet is unlocked in main').toBe(true);
    seededWalletId = seeded.id;
    log(`wallet seeded and unlocked: ${JSON.stringify(seeded)}`);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(wsRoot, { recursive: true, force: true });
  });

  test('sign-in lands on the CHOICE, never on a forced birth ceremony', async () => {
    await expect(page.locator('#portal-enter')).toBeVisible({ timeout: 30 * 1000 });
    await shot(page, '01-gateway');
    await page.click('#portal-enter');

    // Walk the wallet picker the way a person does.
    // Target the SEEDED wallet by id, never .first(). A 'fresh' user-data-dir
    // still arrives carrying a pre-existing wallet, so .first() picked a
    // wallet whose password this harness does not know — and the harness then
    // reported 'Wrong password' about a password that was perfectly correct
    // for the wallet it MEANT to open.
    const embedded = page.locator(`.wallet-picker-embedded[data-wallet-id="${seededWalletId}"]`);
    const unlock = page.locator('#wp-submit');
    const deadline = Date.now() + 120 * 1000;
    while (Date.now() < deadline) {
      if (await page.locator('.firstrun').isVisible().catch(() => false)) break;
      if (await embedded.isVisible().catch(() => false)) {
        await embedded.click({ force: true }).catch(() => {});
      } else if (await unlock.isVisible().catch(() => false)) {
        // pressSequentially, not fill(): fill() sets the DOM value and fires one
        // synthetic input event, which a controlled React input can miss — the
        // field then LOOKS correct in a DOM snapshot while component state is
        // still empty, and the form submits nothing. Observed live: the a11y
        // tree showed the full password beside a "Wrong password" error.
        const field = page.locator('#wp-password');
        const typed = await field.inputValue().catch(() => '');
        if (typed !== WALLET_PASSWORD) {
          await field.click({ force: true }).catch(() => {});
          await field.press('Control+a').catch(() => {});
          await field.pressSequentially(WALLET_PASSWORD, { delay: 15 }).catch(() => {});
        }
        if (await field.inputValue().catch(() => '') === WALLET_PASSWORD) {
          await unlock.click({ force: true }).catch(() => {});
          // Give the unlock a real chance to settle before the loop re-enters
          // and retypes over a submission already in flight.
          await page.waitForTimeout(1200);
        }
      }
      await page.waitForTimeout(300);
    }

    if (!(await page.locator('.firstrun').isVisible().catch(() => false))) {
      const state = await page.evaluate(async () => ({
        status: await window.neuma?.wallet?.status?.().catch((e) => String(e)),
        list: await window.neuma?.wallet?.list?.().catch((e) => String(e)),
        visible: document.body.innerText.slice(0, 400),
      })).catch((e) => ({ error: String(e) }));
      log(`WALLET STATE AT PICKER: ${JSON.stringify(state, null, 2)}`);
      await shot(page, '02-stuck');
    }

    await expect(page.locator('.firstrun')).toBeVisible({ timeout: 30 * 1000 });
    await shot(page, '02-the-door');
    log('the choice is standing');

    // The closed loop: the ceremony must NOT have been forced.
    await expect(page.locator('#witness-name')).toHaveCount(0);
    await expect(page.locator('#preflight-begin')).toHaveCount(0);
  });

  test('both doors are offered, each naming its precondition on its face', async () => {
    const paths = page.locator('.firstrun-path');
    await expect(paths).toHaveCount(2);

    const text = await page.locator('.firstrun').innerText();
    expect(text).toContain('Begin beside a witness');
    expect(text).toContain('Summon a neuma');
    // The preconditions are the reason this screen exists — a person must not
    // discover […] only after the preflight refuses.
    expect(text).toContain('NEEDS: AN API KEY');
    expect(text).toContain('NEEDS: A LOCAL MODEL');
    // The operator is named as the operator here; 'witness' is the AI peer.
    expect(text).toContain('operator');
  });

  test('the witness door opens the GUIDED ROAD, never an empty desk', async () => {
    await page.locator('.firstrun-path', { hasText: 'Begin beside a witness' }).click();

    // Founder's law after a teammate walked it live: […] This used to route
    // straight to 'relink', dropping a person with no being into an empty room
    // to discover the WITNESSES app, the provider lock and the rite unaided.
    await expect(page.locator('.firstrun-witness')).toBeVisible({ timeout: 30 * 1000 });
    await expect(page.locator('.relink')).toHaveCount(0);
    await shot(page, '03-standing');

    // Beat 1 teaches what they are joining BEFORE asking for a credential.
    const standing = await page.locator('.firstrun-witness').innerText();
    expect(standing).toContain('A MEMORY THAT PERSISTS');
    expect(standing).toContain('ITS OWN IDENTITY');
    // The honest boundary is stated here, not discovered later.
    expect(standing).toMatch(/not yet anchored on chain/i);

    // Beat 2 is the door: a provider must be chosen and proved before the rite.
    await page.getByRole('button', { name: 'CONTINUE' }).click();
    await expect(page.getByLabel('Witness provider')).toBeVisible({ timeout: 15 * 1000 });
    await shot(page, '04-the-door');
    // Nothing may be summoned until a provider is picked.
    await expect(page.getByRole('button', { name: /CONNECT & OPEN THE RITE/ })).toBeDisabled();

    // Still not the desk — the whole point.
    await expect(page.locator('.relink')).toHaveCount(0);
    await expect(page.locator('#portal-enter')).toHaveCount(0);
  });
});
