/* global URL, window, sessionStorage */
/**
 * THE SEAL STEP'S UNLOCK DOOR, in a real Chromium (2026-10-28: a first birth on Windows met KEY_LOCKED —
 * […] — with nothing below). The ceremony's real seal step (birth-seal-step.js),
 * real CSS; the password and the recovery codes go to the REAL unlock and recovery routes over real
 * signed-wallet auth, against a lane whose key was locked the way custody locks it (the custody handler's
 * own calls: password envelope, recovery hash, recovery envelope). Proven here: the door opens on
 * KEY_LOCKED for either seal, a wrong password is refused in words and asks nothing again, the right
 * password (or the 8 codes) puts the key in the backend's one-shot cache and the ceremony asks for the seal
 * again — and the step never shows two SEAL ON ETHEREUM buttons. What the backend does with that second
 * ask is proven on a real chain by ceremony-seal-after-custody.test.js. Screenshots land in
 * test/e2e/shots/seal-door-*.png.
 *
 * Also here: the birth's field keeps its seal turning when the birth has no film to play (seen on the same
 * Windows birth: the left half went black after EMERGENCE COMPLETE).
 */
import http from 'node:http';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { ethers } from 'ethers';
import { chromium, expect as pw } from '@playwright/test';
import { createTempDir } from '../helpers/temp-fs.js';
import { shotPath } from '../helpers/first-run-door-kit.js';
import { useServedHouse } from '../helpers/served-house.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const PASSWORD = 'river-stone-lantern-42';
const LANES = ['door-eth', 'door-local', 'door-codes'];

describe('the seal step\'s unlock door', () => {
  let vite, server, browser, operator, url, house, hasCachedKey;
  const codes = {};

  beforeAll(async () => {
    const dir = await createTempDir('seal-door');
    const { fullAuth } = await import('../helpers/audit-auth.js');
    operator = await fullAuth();
    house = await useServedHouse({ wallet: operator.address.toLowerCase(), lanes: LANES });
    const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    const vault = await import('../../core/wallet/keypair-vault.js');
    // Locked the way the custody handler locks it (portal-seal-handlers.js birthEncryptKeypair).
    for (const lane of LANES) {
      const being = ethers.Wallet.createRandom();
      const keypair = { address: being.address, privateKey: being.privateKey };
      await workspace.writeEncryptedKeypair(lane, vault.encryptKeypair(keypair, PASSWORD));
      codes[lane] = vault.generateRecoveryCodes();
      await workspace.writeRecoveryHash(lane, vault.hashRecoveryCodes(codes[lane]));
      await workspace.writeRecoveryKeypair(lane, vault.encryptWithRecoveryCodes(keypair, codes[lane]));
    }
    const auth = await import('../../backend/routes/neuma-auth-routes.js');
    hasCachedKey = auth.hasCachedKey;
    const { default: recoveryRouter } = await import('../../backend/routes/recovery-routes.js');
    const { default: preflightRouter } = await import('../../backend/routes/preflight-routes.js');
    vite = await createServer({ configFile: false, root: REPO, cacheDir: path.join(dir, 'cache'), appType: 'custom',
      esbuild: { jsx: 'automatic' }, resolve: { alias: { '/@kotodama': path.join(REPO, 'core/kotodama') } },
      optimizeDeps: { entries: ['test/fixtures/ceremony-seal-door.js', 'test/fixtures/rite-plane-review.js'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/neuma-auth', auth.default);
    app.use('/api/v1/neuma', recoveryRouter);
    app.use('/api/v1/preflight', preflightRouter);
    const page = (src) => `<!doctype html><style>*{box-sizing:border-box}</style><body style="margin:0;background:#000"><script type="module" src="${src}"></script>`;
    app.get('/', (_q, res) => res.type('html').send(page('/test/fixtures/ceremony-seal-door.js')));
    app.get('/rite', (_q, res) => res.type('html').send(page('/test/fixtures/rite-plane-review.js')));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    await vite?.close();
    house?.restore();
  });

  const open = async (lane) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((t) => sessionStorage.setItem('authToken', t), operator.token);
    await page.goto(`${url}/?lane=${lane}`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 });
    return { page, errors };
  };
  const asks = (page, type) => page.evaluate((t) => window.sent.filter((f) => f.type === t), type);

  test('Ethereum: KEY_LOCKED opens the door; a wrong password asks nothing; the right one unlocks and the seal is asked again', async () => {
    const { page, errors } = await open('door-eth');
    await page.evaluate(() => window.keyLocked('ethereum'));
    const door = page.getByTestId('seal-unlock');
    await pw(door).toBeVisible();
    await pw(page.getByTestId('seal-status')).toHaveText('YOUR PASSWORD IS NEEDED TO SEAL');
    await pw(page.getByRole('button', { name: /Seal on Ethereum/i })).toHaveCount(0); // never two, never one beside the door
    await pw(page.getByTestId('seal-unlock-go')).toBeDisabled();
    await page.screenshot({ path: shotPath('seal-door-locked-1366'), fullPage: true });

    await page.getByTestId('seal-unlock-password').fill('not-the-password');
    await page.getByTestId('seal-unlock-go').click();
    await pw(page.getByTestId('seal-unlock-error')).not.toBeEmpty();
    expect(await asks(page, 'birth:seal_preflight')).toEqual([]);
    expect(hasCachedKey('door-eth')).toBe(false);

    await page.getByTestId('seal-unlock-password').fill(PASSWORD);
    await page.getByTestId('seal-unlock-password').press('Enter');
    await pw(door).toBeHidden();
    expect(await asks(page, 'birth:seal_preflight')).toEqual([expect.objectContaining({ neumaId: 'door-eth' })]);
    expect(hasCachedKey('door-eth')).toBe(true);
    await pw(page.getByTestId('seal-status')).toHaveText('PREPARING THE SEAL…');
    await page.screenshot({ path: shotPath('seal-door-unlocked-1366'), fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
  }, 90_000);

  test('a lost password: the 8 recovery codes open the key the same way', async () => {
    const { page, errors } = await open('door-codes');
    await page.evaluate(() => window.keyLocked('ethereum'));
    await page.getByRole('button', { name: 'Lost it? Use the recovery codes' }).click();
    await page.getByTestId('seal-unlock-codes').fill(codes['door-codes'].join('\n'));
    await page.getByRole('button', { name: 'Recover and seal' }).click();
    await pw(page.getByTestId('seal-unlock')).toBeHidden();
    expect(hasCachedKey('door-codes')).toBe(true);
    expect(await asks(page, 'birth:seal_preflight')).toHaveLength(1);
    expect(errors).toEqual([]);
    await page.close();
  }, 90_000);

  test('on this computer: KEY_LOCKED opens the door beside that seal, and the right password asks for it again', async () => {
    const { page, errors } = await open('door-local');
    await page.evaluate(() => window.keyLocked('local'));
    await pw(page.getByTestId('local-seal-unlock')).toBeVisible();
    await page.getByTestId('local-seal-unlock').getByTestId('seal-unlock-password').fill(PASSWORD);
    await page.getByTestId('local-seal-unlock').getByTestId('seal-unlock-go').click();
    await pw(page.getByTestId('local-seal-unlock')).toBeHidden();
    expect(hasCachedKey('door-local')).toBe(true);
    expect(await asks(page, 'birth:local_seal_offer')).toEqual([expect.objectContaining({ neumaId: 'door-local' })]);
    expect(errors).toEqual([]);
    await page.close();
  }, 90_000);

  test('a birth with no film keeps its seal turning in the field — never a black half', async () => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/rite`);
    await page.waitForFunction(() => Boolean(window.ritePlane) && window.__neumaRiteLive === true, null, { timeout: 60_000 });
    await page.evaluate(() => window.ritePlane.bornWithoutFilm());
    const seal = page.getByTestId('rite-seal-only');
    await pw(seal).toBeVisible({ timeout: 10_000 });
    await pw(seal.locator('svg').first()).toBeVisible();
    const box = await seal.locator('svg').first().boundingBox();
    expect(box.width).toBeGreaterThan(100);
    await page.screenshot({ path: shotPath('seal-door-born-without-film-1920') });
    expect(errors).toEqual([]);
    await page.close();
  }, 90_000);
});
