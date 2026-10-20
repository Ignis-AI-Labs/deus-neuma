/* global window, document, sessionStorage, Event */
// Ceremony HTTP family (#174): the avatar roster read, the seal-network row,
// and the witness covenant (documents / status / accept) after their
// migration onto the shared apiCall transport. Real express routers
// (covenant, preflight), the real listAvatars service behind the same
// response shape server.js serves, real Chromium, a real encrypted embedded
// wallet signing through its real consent modal, and a real session token
// per wallet (fullAuth). No mocks anywhere in the path (RULE 0).
//
// PARALLEL-SAFETY LAW (witnessed 2026-09-11, MOD-001 combined batch under a
// doubled pile-up): this box runs many agent instances at once, and under
// contention the browser→loopback transport can die BEFORE any HTTP response
// exists ("Failed to fetch" in-page; […] when
// the renderer is recycled). That is not a contract outcome, so every leg
// drives through `drive()`: an attempt is retried ONLY when no response ever
// arrived, never when one did. Each attempt is a full real round trip — the
// fixed strings, the alarm count and the disk record still come only from
// the real routes, so a regression converges never and still fails.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';
import { listAvatars } from '../../backend/services/avatar-roster.js';

// Transport-loss signatures: no HTTP response ever existed in these cases.
// `is not a function/constructor` after window.ready fired means the ready
// probe resolved in a doomed context just before a crash-reload — the live
// context simply has not finished evaluating the module script yet.
const TRANSPORT_PAGE = /Failed to fetch|Load failed|NetworkError/i;
const TRANSPORT_DRIVER = /Execution context was destroyed|Target crashed|Target closed|frame was detached|is not a function|is not a constructor/i;
const RETRY = Symbol('no-response-yet');

test('ceremony reads and covenant signing keep their contracts on the shared transport', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ceremony-http-'));
  const modelDir = path.join(root, 'model');
  const env = { NEUMA_DATA_ROOT: path.join(root, 'data'), CEREMONY_SEAL_NETWORK: 'base',
    // The preflight router's provider discovery must never sweep this box's
    // real listeners — pin it to a dead port (the preflight-panel precedent).
    NEUMA_DISCOVERY_PORTS: '1' };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  let vite; let server; let browser;
  try {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    await fs.mkdir(modelDir, { recursive: true });
    (await import('../../backend/config.js')).loadConfig();
    const covenantRouter = (await import('../../backend/routes/covenant-routes.js')).default;
    const preflightRouter = (await import('../../backend/routes/preflight-routes.js')).default;
    const auth = await fullAuth();
    const stranger = await fullAuth();

    const app = express();
    app.use(express.json());
    // Real refusal toggles (the house-roster hold-middleware precedent): the
    // covenant routes never fail on their own while docs/legal is intact, so
    // the failure legs answer with real HTTP 500 + real JSON bodies.
    let failDocs = false; let failStatus = false;
    app.use('/api/v1/covenant', (req, res, next) => {
      if (failDocs && req.method === 'GET' && req.path === '/') {
        return res.status(500).json({ error: 'DOCS SERVER WORDS' });
      }
      if (failStatus && req.path === '/status') {
        return res.status(500).json({ error: 'STATUS SERVER WORDS' });
      }
      return next();
    });
    app.use('/api/v1/covenant', covenantRouter);
    app.use('/api/v1/preflight', preflightRouter);
    // The exact handler server.js:243 mounts, over the real roster service.
    app.get('/api/v1/avatars', async (_req, res) => {
      try {
        res.json({ avatars: await listAvatars(modelDir), modelDir });
      } catch {
        res.status(500).json({ error: 'Failed to list avatars', avatars: [] });
      }
    });
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { include: ['ethers'] }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send(`<script type="module">
      import { fetchVessels } from "/frontend/app/RelinkShell/vessel/vessel-roster.js";
      import { loadSealNetwork, appendSealReceiptLink } from "/frontend/components/BirthCeremony/birth-seal-step.js";
      import { WitnessCommitment } from "/frontend/components/WitnessCommitment/WitnessCommitment.js";
      import { importEmbeddedWallet, getEmbeddedProvider } from "/frontend/services/EmbeddedWallet.js";
      import { getWalletService } from "/frontend/services/WalletGate.js";
      Object.assign(window, { fetchVessels, loadSealNetwork, appendSealReceiptLink, WitnessCommitment, importEmbeddedWallet, getEmbeddedProvider, getWalletService });
      window.expired = 0; window.accepted = 0;
      window.addEventListener("neuma:auth_expired", () => window.expired++);
      window.ready = true;
    </script>`));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);

    // impure — run one REAL attempt; retry only while no HTTP response has
    // ever arrived (in-page transport loss, a recycled renderer, or a wait
    // that timed out because the world it watched was recycled). A real
    // refusal, a real success and a real regression are never retried —
    // they converge or the final error carries every attempt's page state.
    const snapshot = async () => {
      try {
        return await page.evaluate(() => ({
          ready: Boolean(window.ready),
          overlay: document.querySelectorAll('.witness-commitment-overlay').length,
          docs: document.querySelectorAll('.covenant-doc').length,
          banner: Boolean(document.querySelector('.covenant-docs-failed')),
          read: window.witness ? window.witness.readDocs.size : -1,
          total: window.witness ? window.witness.totalDocs : -1,
          checked: Boolean(document.querySelector('#covenant-read-check') && document.querySelector('#covenant-read-check').checked),
          acceptDisabled: document.querySelector('#accept-commitment') ? document.querySelector('#accept-commitment').disabled : null,
        }));
      } catch (error) {
        return { probe: String(error && error.message) };
      }
    };
    const drive = async (attempt, attempts = 5) => {
      const failures = [];
      for (let n = 0; n < attempts; n += 1) {
        try {
          const value = await attempt();
          if (value !== RETRY) return value;
          failures.push({ attempt: n, retried: true, state: await snapshot() });
        } catch (error) {
          const message = String(error && error.message);
          if (!TRANSPORT_DRIVER.test(message) && error.name !== 'TimeoutError') throw error;
          failures.push({ attempt: n, error: message.slice(0, 160), state: await snapshot() });
        }
        // A recycled context reloads the page — wait for the script to re-run.
        await page.waitForFunction(() => window.ready, null, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(250 * (n + 1));
      }
      throw new Error(`drive: no real response after ${attempts} attempts — ${JSON.stringify(failures)}`);
    };

    // One real fetchVessels round trip, classified in-page.
    const rosterOnce = () => page.evaluate(() => window.fetchVessels().then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, message: String(error && error.message) }),
    ));
    const rosterReal = () => drive(async () => {
      const result = await rosterOnce();
      if (!result.ok && TRANSPORT_PAGE.test(result.message)) return RETRY;
      return result;
    });

    // One real seal-network row load: rebuild the row, call, read the row
    // and the alarm count back. loadSealNetwork swallows by contract, so the
    // row text + alarm count are the honest response-arrived witnesses.
    const sealRowOnce = (token) => page.evaluate((t) => {
      if (t !== undefined) {
        if (t === null) sessionStorage.removeItem('authToken');
        else sessionStorage.setItem('authToken', t);
      }
      document.querySelectorAll('#seal-network-v').forEach((el) => el.remove());
      const row = document.createElement('span');
      row.id = 'seal-network-v';
      document.body.append(row);
      return window.loadSealNetwork(null, document.body).then(() => ({
        text: document.querySelector('#seal-network-v').textContent,
        expired: window.expired,
      }));
    }, token);

    // Site 1 — fetchVessels: real roster over a real model dir.
    await fs.writeFile(path.join(modelDir, 'proof_avatar.vrm'), Buffer.alloc(2048));
    expect(await rosterReal()).toEqual({
      ok: true,
      value: { avatars: [{ name: 'proof_avatar.vrm', displayName: 'proof avatar' }], modelDir },
    });
    // An unreadable model dir is a real IO failure → route 500, and the
    // thrown string stays the fixed legacy one, never the server's words.
    await fs.chmod(modelDir, 0o000);
    expect(await rosterReal()).toEqual({ ok: false, message: 'avatar roster fetch failed: 500' });
    await fs.chmod(modelDir, 0o755);
    expect(await rosterReal()).toEqual({
      ok: true,
      value: { avatars: [{ name: 'proof_avatar.vrm', displayName: 'proof avatar' }], modelDir },
    });

    // Site 2 — loadSealNetwork: no token → honest UNKNOWN; a real session
    // renders the backend's configured network; an invalid session keeps the
    // fallback AND fires the auth-expired alarm exactly once.
    const anonymous = await drive(() => sealRowOnce(null));
    expect(anonymous).toEqual({ text: 'UNKNOWN — PREFLIGHT DECIDES', expired: 0 });
    const configured = await drive(async () => {
      const result = await sealRowOnce(auth.token);
      // UNKNOWN here means no response arrived (a real 200 renders the label).
      return result.text === 'BASE MAINNET' ? result : RETRY;
    });
    expect(configured.expired).toBe(0);
    const beforeInvalid = await drive(async () => {
      const count = await page.evaluate(() => window.expired);
      return typeof count === 'number' ? count : RETRY;
    });
    const invalid = await drive(async () => {
      const result = await sealRowOnce('invalid-session-proof');
      // The alarm fires INSIDE apiCall only when the 401 response arrived.
      return (result.text === 'UNKNOWN — PREFLIGHT DECIDES' && result.expired > beforeInvalid) ? result : RETRY;
    });
    expect(invalid.expired).toBe(beforeInvalid + 1);

    // The ceremony's seal receipt names the explorer it links: an Ethereum
    // seal opens Etherscan and says so, a Base seal says Basescan, and an
    // unknown network gets no link at all. Real DOM, real function.
    const receiptLink = (network) => drive(() => page.evaluate((net) => {
      document.querySelectorAll('#seal-status').forEach((el) => el.remove());
      const host = document.createElement('span');
      host.id = 'seal-status';
      document.body.append(host);
      window.appendSealReceiptLink({ container: document.body }, { network: net, txHash: `0x${'ab'.repeat(32)}` });
      const link = host.querySelector('.seal-explorer-link');
      host.remove();
      return link ? { href: link.href, text: link.textContent } : null;
    }, network));
    const sealTx = `0x${'ab'.repeat(32)}`;
    expect(await receiptLink('ethereum')).toEqual({ href: `https://etherscan.io/tx/${sealTx}`, text: 'VIEW ON ETHERSCAN ↗' });
    expect(await receiptLink('base')).toEqual({ href: `https://basescan.org/tx/${sealTx}`, text: 'VIEW ON BASESCAN ↗' });
    expect(await receiptLink('polygon')).toBeNull();

    // Covenant fixture helpers — every one rebuilds only what a recycled
    // renderer could have wiped, then drives the real component.
    const freshCommitment = () => page.evaluate(() => {
      document.querySelectorAll('.witness-commitment-overlay').forEach((el) => el.remove());
      window.witness = new window.WitnessCommitment(() => { window.accepted += 1; }, () => {});
      window.witness.show();
    });
    const docsOutcome = () => page.waitForFunction(() => {
      if (document.querySelector('.covenant-docs-failed')) return 'failed';
      if (document.querySelectorAll('.covenant-doc').length === 3) return 'docs';
      if (!document.querySelector('.witness-commitment-overlay')) return 'lost';
      return null;
    }, null, { timeout: 30000 }).then((handle) => handle.jsonValue());
    const ensureCommitment = async () => {
      const standing = (await page.locator('.witness-commitment-overlay').count())
        && (await page.locator('.covenant-doc').count()) === 3;
      if (standing) return 'ready';
      await freshCommitment();
      // A documents refusal here is only reachable through transport loss —
      // failDocs is off for every leg that calls this — so it retries.
      return page.waitForFunction(() => {
        if (document.querySelectorAll('.covenant-doc').length === 3) return 'ready';
        if (document.querySelector('.covenant-docs-failed')) return 'failed';
        return null;
      }, null, { timeout: 30000 }).then((handle) => handle.jsonValue());
    };
    const readAndTick = () => page.evaluate(() => {
      document.querySelectorAll('.covenant-doc').forEach((details) => {
        details.open = true;
        const text = details.querySelector('.covenant-doc-text');
        text.scrollTop = text.scrollHeight;
        text.dispatchEvent(new Event('scroll'));
      });
      const check = document.querySelector('#covenant-read-check');
      if (check && !check.checked) {
        check.checked = true;
        check.dispatchEvent(new Event('change'));
      }
    });
    const acceptEnabled = () => page.waitForSelector('#accept-commitment:not([disabled])', { timeout: 30000 });
    const acceptOutcome = () => page.waitForFunction(() => {
      if (window.accepted > 0) return 'accepted';
      if (!document.querySelector('.witness-commitment-overlay')) return 'lost';
      if (document.querySelector('.wallet-unlock-input')) return 'unlock';
      if (document.querySelector('.wallet-confirm-approve')) return 'modal';
      const err = document.querySelector('#covenant-error');
      if (err && err.textContent) return 'error';
      return null;
    }, null, { timeout: 30000 }).then((handle) => handle.jsonValue());
    const wireWallet = (token) => page.evaluate(async (t) => {
      const service = window.getWalletService();
      if (!service.provider) service.setProvider(window.getEmbeddedProvider());
      sessionStorage.setItem('authToken', t);
      await service.connect();
    }, token);

    // Site 3 — loadBindingDocuments: a refused fetch shows the fixed banner
    // and console-errors the fixed `HTTP <status>` string, never server text.
    failDocs = true;
    const refusedDocs = await drive(async () => {
      const mark = consoleErrors.length;
      await freshCommitment();
      const outcome = await docsOutcome();
      if (outcome === 'lost') return RETRY;
      if (outcome !== 'failed') throw new Error(`expected the refused-documents banner, got ${outcome}`);
      const delta = consoleErrors.slice(mark);
      if (delta.some((line) => TRANSPORT_PAGE.test(line))) return RETRY;
      const banner = await page.evaluate(() => document.querySelector('#covenant-docs').textContent);
      return { delta, banner };
    });
    expect(refusedDocs.banner).toBe(
      'THE BINDING DOCUMENTS COULD NOT BE RETRIEVED — THE CEREMONY CANNOT PROCEED WITHOUT THEM.',
    );
    expect(refusedDocs.delta.some((line) => line.includes('HTTP 500'))).toBe(true);
    expect(refusedDocs.delta.some((line) => line.includes('DOCS SERVER WORDS'))).toBe(false);

    // Documents render for real (three binding texts with hashes), and the
    // read-through gate unlocks only after an honest scroll to each end. The
    // whole walk is one attempt: a recycled renderer re-runs it from a fresh
    // commitment, every render and every scroll dispatch real.
    failDocs = false;
    const docsProof = await drive(async () => {
      const mark = consoleErrors.length;
      await freshCommitment();
      const outcome = await docsOutcome();
      if (outcome === 'lost') return RETRY;
      if (outcome !== 'docs') {
        if (consoleErrors.slice(mark).some((line) => TRANSPORT_PAGE.test(line))) return RETRY;
        throw new Error(`expected the three binding documents, got ${outcome}`);
      }
      return page.evaluate(() => {
        const before = {
          titles: [...document.querySelectorAll('.covenant-doc-title')].map((el) => el.textContent),
          hashes: document.querySelectorAll('.covenant-doc-hash').length,
          acceptDisabled: document.querySelector('#accept-commitment').disabled,
        };
        document.querySelectorAll('.covenant-doc').forEach((details) => {
          details.open = true;
          const text = details.querySelector('.covenant-doc-text');
          text.scrollTop = text.scrollHeight;
          text.dispatchEvent(new Event('scroll'));
        });
        const check = document.querySelector('#covenant-read-check');
        check.checked = true;
        check.dispatchEvent(new Event('change'));
        return {
          ...before,
          badges: [...document.querySelectorAll('.covenant-doc-read')].map((el) => el.textContent),
          acceptEnabled: !document.querySelector('#accept-commitment').disabled,
        };
      });
    });
    expect(docsProof).toEqual({
      titles: ['The Neuma Covenant', 'Terms of Service', 'End User License Agreement'],
      hashes: 3,
      acceptDisabled: true,
      badges: ['READ', 'READ', 'READ'],
      acceptEnabled: true,
    });

    // The browser holds a real encrypted wallet for the session's wallet.
    // Idempotent: a recycled renderer may have completed the import before
    // dying — the keystore persists, so a retry recognizes it by address.
    await drive(() => page.evaluate(async ({ privateKey, address }) => {
      const existing = window.getEmbeddedProvider();
      if (existing && String(existing._storedAddress).toLowerCase() === address) return 'present';
      await window.importEmbeddedWallet(privateKey, 'ceremony-http-proof');
      return 'imported';
    }, { privateKey: auth.keypair.privateKey, address: auth.address }));

    // One real accept click through to its outcome; the caller classifies.
    // A recycled renderer also forgets the unlocked key, so the vault's own
    // unlock door (part of the real sign path) is walked when it appears.
    const acceptOnce = async (token) => {
      if ((await ensureCommitment()) !== 'ready') return 'lost';
      await wireWallet(token);
      await readAndTick();
      await acceptEnabled();
      await page.locator('#accept-commitment').click();
      let outcome = await acceptOutcome();
      for (let guard = 0; (outcome === 'modal' || outcome === 'unlock') && guard < 4; guard += 1) {
        if (outcome === 'modal') {
          await page.locator('.wallet-confirm-approve').click();
        } else {
          await page.locator('.wallet-unlock-input').fill('ceremony-http-proof');
          await page.locator('.wallet-unlock-input').press('Enter');
        }
        outcome = await acceptOutcome();
      }
      return outcome;
    };

    // …but the first attempt signs under a STRANGER's session: the status
    // message names the stranger, the embedded wallet signs as the session
    // wallet's non-matching peer, and the real verifier refuses (422). The
    // server's own refusal words reach the console; the UI stays fixed.
    const mismatch = await drive(async () => {
      const mark = consoleErrors.length;
      const outcome = await acceptOnce(stranger.token);
      if (outcome === 'lost') return RETRY;
      if (outcome !== 'error') throw new Error(`expected the mismatched signature to be refused, got ${outcome}`);
      const delta = consoleErrors.slice(mark);
      if (delta.some((line) => TRANSPORT_PAGE.test(line))) return RETRY;
      const banner = await page.evaluate(() => document.querySelector('#covenant-error').textContent);
      return { delta, banner };
    });
    expect(mismatch.banner).toBe(
      'THE SIGNATURE WAS NOT COMPLETED — NOTHING WAS RECORDED. YOU MAY TRY AGAIN.',
    );
    expect(mismatch.delta.some((line) => line.includes('Signature does not match the current documents for this wallet'))).toBe(true);
    const stillUnsigned = await drive(async () => {
      const count = await page.evaluate(() => window.accepted);
      return typeof count === 'number' ? count : RETRY;
    });
    expect(stillUnsigned).toBe(0);

    // Site 4 — a refused status read ignores server words entirely: the
    // fixed client message is what the catch sees (console), UI stays fixed.
    failStatus = true;
    const statusRefusal = await drive(async () => {
      const mark = consoleErrors.length;
      const outcome = await acceptOnce(stranger.token);
      if (outcome === 'lost') return RETRY;
      if (outcome !== 'error') throw new Error(`expected the refused status read, got ${outcome}`);
      const delta = consoleErrors.slice(mark);
      if (delta.some((line) => TRANSPORT_PAGE.test(line))) return RETRY;
      const banner = await page.evaluate(() => document.querySelector('#covenant-error').textContent);
      return { delta, banner };
    });
    failStatus = false;
    expect(statusRefusal.banner).toBe(
      'THE SIGNATURE WAS NOT COMPLETED — NOTHING WAS RECORDED. YOU MAY TRY AGAIN.',
    );
    expect(statusRefusal.delta.some((line) => line.includes('Covenant status unavailable'))).toBe(true);
    expect(statusRefusal.delta.some((line) => line.includes('STATUS SERVER WORDS'))).toBe(false);

    // Site 5 — the honest path: matching session, real signature through the
    // real consent modal, real 201, and the acceptance record lands on disk.
    const accepted = await drive(async () => {
      const mark = consoleErrors.length;
      const outcome = await acceptOnce(auth.token);
      if (outcome === 'lost') return RETRY;
      if (outcome === 'accepted') return true;
      const delta = consoleErrors.slice(mark);
      if (delta.some((line) => TRANSPORT_PAGE.test(line))) return RETRY;
      throw new Error(`acceptance was refused: ${delta.join(' | ') || outcome}`);
    });
    expect(accepted).toBe(true);
    const recordPath = path.join(process.env.NEUMA_DATA_ROOT, 'covenant', `${auth.address}.json`);
    const records = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    // A recycled renderer can retry after the 201 landed — append-only means
    // the record count only ever grows; the latest record is the proof.
    expect(records.length).toBeGreaterThanOrEqual(1);
    const record = records[records.length - 1];
    expect(record).toMatchObject({ version: 'covenant-acceptance/1', wallet: auth.address });
    expect(record.documents.map((doc) => doc.id)).toEqual(['covenant', 'terms', 'eula']);
    expect(record.message).toContain('NEUMA COVENANT ACCEPTANCE');

    expect(pageErrors).toEqual([]);
  } finally {
    await browser?.close();
    await vite?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 180_000);
