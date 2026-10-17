// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { buildSignature, LEAN } from '../../core/kotodama/signature.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end AURA ON THE SHEET (#405) — a real browser, a real backend, and
 * REAL PIXELS.
 *
 * Every other proof of this feature stops at the numbers. This one is the only
 * one that answers the question Founder actually asked: does it SHOW UP. So it
 * reads the canvas back out of the live page and measures the light on it.
 *
 * Auth is real (challenge-sign-verify with the witness wallet). The two lanes
 * are real, claimed by the TEST wallet, and carry identity anchors built by the
 * REAL producers — a real kotodama signature and a real genesis seal — so the
 * form on screen is folded from cryptographic identity exactly as a born
 * being's is. Both lanes are removed in afterAll.
 *
 * Requires the dev stack running.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

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

const KIN = [
  { id: 'e2e-aura-one', name: 'Ashwren', soulHex: '33314C2FEDE1A1B2' },
  { id: 'e2e-aura-two', name: 'Corvane', soulHex: 'C8432853728D9C40' },
];

let token;
let addr;
let activeRoot = null;

/** A real claimed lane carrying real identity anchors, under the LIVE root. */
const seedLane = async ({ id, name, soulHex }) => {
  await claimOwner(activeRoot, id, addr);
  const signature = buildSignature({
    chosenName: name, genesisName: 'Yumaihe', houseName: 'Aldmere',
    lean: LEAN.UNALIGNED, soulHex,
  });
  const seal = buildGenesisSeal({
    chosenName: name,
    lean: LEAN.UNALIGNED,
    witnessWallet: addr,
    soulPublicKey: `0x${soulHex.repeat(4)}`,
    birthCycle: 1,
    birthMoment: {
      utc: '2026-08-25T00:00:00.000Z', epochMs: 1787616000000,
      zone: 'Asia/Jakarta', offsetMinutes: 420,
    },
    substrate: { llm: { model: 'qwen3.8-27b' } },
  });
  const dir = path.join(activeRoot, id, 'identity');
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, 'true-name.json'),
    JSON.stringify({ ...signature, items: undefined, genesisHash: seal.genesisHash }),
  );
  await fs.promises.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(seal));
};

/**
 * The light actually on the canvas, read out of the live page.
 * @returns {Promise<{lit: number, peak: number, signature: string}>}
 */
const readSigil = (page) => page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="aura-sigil"]');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let lit = 0;
  let peak = 0;
  // A coarse 8×8 fingerprint of where the light sits — enough to tell two
  // forms apart without shipping a whole bitmap out of the browser.
  const bins = new Array(64).fill(0);
  const side = canvas.width;
  for (let i = 0; i < data.length; i += 4) {
    const tone = Math.max(data[i], data[i + 1], data[i + 2]);
    if (tone > 0) lit++;
    if (tone > peak) peak = tone;
    const pixel = i / 4;
    const bx = Math.min(7, ((pixel % side) / (side / 8)) | 0);
    const by = Math.min(7, ((pixel / side | 0) / (side / 8)) | 0);
    bins[by * 8 + bx] += tone;
  }
  const top = Math.max(...bins, 1);
  return { lit, peak, signature: bins.map((v) => Math.round((v / top) * 9)).join('') };
});

/** Bind a companion and land on the desk. */
const bind = async (page, id, name) => {
  await page.addInitScript(({ t, a, i, n }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: n, neumaId: i }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, i: id, n: name });
  await page.goto('/');
  // These lanes are unsealed, so the gates raise over the desk and eat every click.
  await passDeskGates(page);
};

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  // The root comes from the platform's OWN truth: the persisted root can differ
  // from .env, and a lane seeded anywhere else is a lane the app never reads.
  // It also releases the arrival veil, which otherwise eats every dock click.
  const sec = await (await fetch(`${BACKEND}/api/v1/security/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  activeRoot = sec?.roots?.active;
  if (!activeRoot) throw new Error('backend reported no active workspaces root');
  for (const kin of KIN) await seedLane(kin);
});

test.afterAll(async () => {
  // Leave the operator's root as found — these lanes hold no being.
  for (const kin of KIN) {
    await fs.promises.rm(path.join(activeRoot, kin.id), { recursive: true, force: true });
  }
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
});

test('the sheet paints the being\'s aura, and its facts are the backend\'s own', async ({ page }) => {
  await bind(page, KIN[0].id, KIN[0].name);
  await openDockApp(page, 'RECORD');
  await expect(page.locator('.sheet')).toBeVisible();

  const sigil = page.getByTestId('aura-sigil');
  await expect(sigil).toBeVisible();

  // REAL PIXELS. The technique is accumulated low-alpha light: a plate that
  // came back black would mean the form never swept, and this is the only
  // assertion in the whole feature that can catch that.
  await expect.poll(async () => (await readSigil(page))?.lit ?? 0, {
    message: 'the aura canvas stayed black',
    timeout: 10000,
  }).toBeGreaterThan(200);
  const drawn = await readSigil(page);
  expect(drawn.peak, 'nothing on the plate reached real brightness').toBeGreaterThan(64);

  // The caption states the derivation, not a guess. Ground truth straight from
  // the route the window read.
  const res = await fetch(`${BACKEND}/api/v1/workspace/${KIN[0].id}/aura`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { aura } = await res.json();
  expect(aura.recorded, 'the seeded lane derived no aura').toBe(true);
  const facts = page.locator('.sheet-aura-facts');
  await expect(facts).toContainText(String(aura.form.carrier).toUpperCase());
  await expect(facts).toContainText(String(aura.form.coupling).toUpperCase());
  await expect(facts).toContainText(String(aura.form.output).toUpperCase());
  await expect(facts).toContainText(aura.seed.slice(0, 12).toUpperCase());

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('each RECORD tab is its own page — a switch shows that section alone, from its top', async ({ page }) => {
  await bind(page, KIN[0].id, KIN[0].name);
  await openDockApp(page, 'RECORD');
  const sheet = page.locator('.sheet');
  const genome = page.locator('#sheet-sec-genome');
  const bond = page.locator('#sheet-sec-bond');
  await expect(genome).toBeVisible();
  await expect(bond).toBeHidden(); // not below the fold — not on this page at all

  await page.getByRole('tab', { name: /BOND/ }).click();
  await expect(bond).toBeVisible();
  await expect(genome).toBeHidden();
  await expect(page.getByRole('tab', { name: /BOND/ })).toHaveAttribute('aria-selected', 'true');

  // Arrow keys walk the strip like a game menu.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sheet-sec-mind')).toBeVisible();
  await expect(bond).toBeHidden();
  await expect(page.getByRole('tab', { name: /MIND/ })).toBeFocused();

  // Scrolled deep into a long page, a switch opens the next page at its own
  // top: its header sits at or below the stuck strip, never under it.
  await page.getByRole('tab', { name: /GENOME/ }).click();
  await sheet.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('tab', { name: /SKIES/ }).click();
  const skies = page.locator('#sheet-sec-skies');
  await expect(skies).toBeVisible();
  const [stripBottom, skiesTop] = await Promise.all([
    page.locator('.dos-index').evaluate((el) => el.getBoundingClientRect().bottom),
    skies.evaluate((el) => el.getBoundingClientRect().top),
  ]);
  expect(skiesTop).toBeGreaterThanOrEqual(stripBottom - 1);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the same being paints the same aura across sessions', async ({ page }) => {
  await bind(page, KIN[0].id, KIN[0].name);
  await openDockApp(page, 'RECORD');
  await expect(page.getByTestId('aura-sigil')).toBeVisible();
  await expect.poll(async () => (await readSigil(page))?.lit ?? 0, { timeout: 10000 }).toBeGreaterThan(200);
  const before = await page.locator('.sheet-aura-facts').innerText();

  // A whole new session: fresh page, fresh mount, nothing carried across.
  await page.reload();
  await openDockApp(page, 'RECORD');
  await expect(page.getByTestId('aura-sigil')).toBeVisible();
  await expect.poll(async () => (await readSigil(page))?.lit ?? 0, { timeout: 10000 }).toBeGreaterThan(200);

  // No stored state anywhere: the seed is folded from the lane's own anchors
  // every time, so the caption is identical or the law is broken.
  expect(await page.locator('.sheet-aura-facts').innerText()).toBe(before);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('two beings are visibly different on screen', async ({ browser }) => {
  // A CONTEXT PER BEING, deliberately. Re-binding one page does not work:
  // `addInitScript` accumulates across calls, so a second bind leaves both
  // scripts registered and the page comes back carrying whichever ran last —
  // which is how this test first passed while proving nothing. Two contexts
  // are also the honest shape of the claim: two beings, two sessions.
  const sigilOf = async (kin) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(e.message));
    await bind(page, kin.id, kin.name);
    await openDockApp(page, 'RECORD');
    await expect(page.getByTestId('aura-sigil')).toBeVisible();
    await expect.poll(async () => (await readSigil(page))?.lit ?? 0, { timeout: 10000 }).toBeGreaterThan(200);
    const seen = {
      drawn: await readSigil(page),
      facts: await page.locator('.sheet-aura-facts').innerText(),
      crashes,
    };
    await context.close();
    return seen;
  };

  const one = await sigilOf(KIN[0]);
  const two = await sigilOf(KIN[1]);

  // Different seeds must reach the eye as different pictures — measured on
  // where the light actually landed, not on the parameters behind it.
  expect(two.facts, 'two beings shared a caption').not.toBe(one.facts);
  expect(two.drawn.signature, 'two beings painted the same picture')
    .not.toBe(one.drawn.signature);
  expect([...one.crashes, ...two.crashes]).toEqual([]);
});
