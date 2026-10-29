/* global window, sessionStorage */
/**
 * stt-client + forge-client lifecycle proof (#174 family F10+F11) — the real
 * client modules in a real Chromium page against the real engine and forge
 * routers with real HMAC auth. Claims: the anonymous bailouts fire no request;
 * the null-fallback reads resolve null on every refusal shape; the
 * fire-and-forget calls (warmTranscriber, the forge's endForge) never reject
 * and never surface a page error; and every site raises neuma:auth_expired on
 * a real 401-with-token. The whisper sidecar is NEVER launched: every launch
 * POST here dies at requireAuth (invalid token) or at the route's unknown-
 * engine refusal (400) before any process or GPU memory is spent.
 *
 * PARALLEL-SAFETY LAW (witnessed 2026-09-11, MOD-001 combined batch): under
 * multi-agent contention the browser→loopback transport can die BEFORE any
 * HTTP response exists ("Failed to fetch" in-page; […] when the renderer is recycled). That is not a contract outcome,
 * so every leg drives through `drive()`: an attempt is retried ONLY when no
 * response ever arrived, never when one did. These clients swallow by
 * contract, so the arrival witnesses are the server-side request recorder
 * (res 'finish' ⇔ a response went out) and the alarm counter (it increments
 * only inside apiCall, after a real 401 body was received). A real refusal,
 * a real success and a real regression are never retried — they converge or
 * the final error carries every attempt's page state.
 */
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
import {
  isUvAvailable, engineReadiness, getStatus,
} from '../../backend/services/voice/engine-manager.js';

// Transport-loss signatures: no HTTP response ever existed in these cases.
// `is not a function/constructor` after the module probe fired means the
// probe resolved in a doomed context just before a crash-reload — the live
// context simply has not finished evaluating the module script yet.
const TRANSPORT_DRIVER = /Execution context was destroyed|Target crashed|Target closed|frame was detached|is not a function|is not a constructor/i;
const RETRY = Symbol('no-response-yet');

test('stt/voice lifecycle clients preserve null and fire-and-forget contracts and report expired auth', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stt-voice-clients-http-'));
  let vite; let server; let browser;
  try {
    const auth = await fullAuth();
    const app = express();
    const requests = [];
    app.use('/api', (req, res, next) => { res.on('finish', () => requests.push({ method: req.method, url: req.originalUrl, status: res.statusCode })); next(); });
    // Mirrors server.js: the forge router parses its own bodies behind auth.
    app.use('/api/v1/voice/engines', express.json());
    app.use('/api/v1/voice/engines', (await import('../../backend/routes/voice-engine-routes.js')).default);
    app.use('/api/v1/voice/forge', (await import('../../backend/routes/voice-forge-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send(
      '<script type="module">'
      + 'import * as stt from "/frontend/app/RelinkShell/stt-client.js";'
      + 'import * as forge from "/frontend/app/RelinkShell/voice-forge/forge-client.js";'
      + 'window.stt = stt; window.forge = forge; window.expired = 0;'
      + 'window.addEventListener("neuma:auth_expired", () => window.expired++);'
      + '</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const pageReady = () => page.waitForFunction(() => window.stt && window.forge, null, { timeout: 30000 });
    await pageReady();

    // impure — run one REAL attempt; retry only while no HTTP response has
    // ever arrived (an attempt returns RETRY when its recorder/alarm witness
    // is absent, and driver-side context deaths are retried by signature). A
    // real refusal, a real success and a real regression are never retried.
    const snapshot = async () => {
      try {
        return await page.evaluate(() => ({ ready: Boolean(window.stt && window.forge), expired: window.expired ?? -1 }));
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
        await pageReady().catch(() => {});
        await page.waitForTimeout(250 * (n + 1));
      }
      throw new Error(`drive: no real response after ${attempts} attempts — ${JSON.stringify(failures)}`);
    };

    const recorderHit = (mark, method, url) =>
      requests.slice(mark).find((r) => r.method === method && r.url === url);

    // One real call whose contract answer is a resolved VALUE (null only when
    // no response arrived): retry while the value is null.
    const valueLeg = (fn) => drive(async () => {
      const value = await page.evaluate(fn);
      return value === null ? RETRY : value;
    });

    // One real call whose contract answer is NULL: the value alone cannot
    // witness arrival, so the recorder does — retry only while no finished
    // response exists, throw on a real wrong status, return the null.
    const refusalLeg = (fn, method, url, expectedStatus) => drive(async () => {
      const mark = requests.length;
      const value = await page.evaluate(fn);
      const hit = recorderHit(mark, method, url);
      if (!hit) return RETRY;
      if (hit.status !== expectedStatus) throw new Error(`expected ${expectedStatus} for ${url}, got ${hit.status}`);
      return value;
    });

    // One real rotten-token call: the 401 must BOTH finish server-side and
    // raise the alarm exactly once (the dispatch runs inside apiCall after
    // the body arrives, so an absent increment means no response existed).
    const rottenLeg = (fn, method, url) => drive(async () => {
      const mark = requests.length;
      const prior = await page.evaluate(() => window.expired);
      const value = await page.evaluate(fn);
      const hit = recorderHit(mark, method, url);
      const now = await page.evaluate(() => window.expired);
      if (!hit || now !== prior + 1) return RETRY;
      if (hit.status !== 401) throw new Error(`expected 401 for ${url}, got ${hit.status}`);
      return value;
    });

    // --- Unauthenticated: every site bails locally.
    await drive(() => page.evaluate(() => window.stt.warmTranscriber()));
    expect(await drive(() => page.evaluate(() => window.stt.dictationReadiness()))).toBeNull();
    expect(await drive(() => page.evaluate(() => window.stt.modelDownloadStatus()))).toBeNull();
    // No token held → no alarm, and warmTranscriber never left the page.
    expect(await drive(() => page.evaluate(() => window.expired))).toBe(0);
    expect(requests.every((r) => !(r.method === 'POST' && r.url.includes('/whisper/launch')))).toBe(true);
    requests.length = 0;

    // --- Real session: the reads answer with this machine's real state.
    const expectedReadiness = engineReadiness({
      uvAvailable: await isUvAvailable(),
      downloaded: getStatus('whisper')?.downloaded ?? false,
    });
    await drive(() => page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token));
    expect(await valueLeg(() => window.stt.dictationReadiness())).toEqual(expectedReadiness);
    expect(await valueLeg(() => window.stt.modelDownloadStatus())).toEqual({ state: 'idle' });
    // Refusal resolves null: an unknown session is a real 404.
    expect(await refusalLeg(
      () => window.forge.endForge('no-such-session'),
      'DELETE', '/api/v1/voice/forge/no-such-session', 404,
    )).toBeNull();
    expect(await drive(() => page.evaluate(() => window.expired))).toBe(0);
    requests.length = 0;

    // --- Rotten token: every refusal resolves the safe fallback and each call
    // raises the auth_expired alarm exactly once. warmTranscriber's POST dies
    // at requireAuth — the fire-and-forget lands, swallows, and never spawns.
    await drive(() => page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof')));
    expect(await rottenLeg(
      () => window.stt.dictationReadiness(),
      'GET', '/api/v1/voice/engines/local/whisper',
    )).toBeNull();
    // Fire-and-forget returns before the response lands — wait for the real
    // 401 to finish server-side, then for the alarm its arrival must raise.
    await drive(async () => {
      const mark = requests.length;
      const prior = await page.evaluate(() => window.expired);
      await page.evaluate(() => window.stt.warmTranscriber());
      let hit = null;
      for (let w = 0; w < 50 && !hit; w += 1) {
        hit = recorderHit(mark, 'POST', '/api/v1/voice/engines/local/whisper/launch') || null;
        if (!hit) await page.waitForTimeout(100);
      }
      if (!hit) return RETRY;
      if (hit.status !== 401) throw new Error(`expected 401 for the warmup launch, got ${hit.status}`);
      let now = prior;
      for (let w = 0; w < 20 && now === prior; w += 1) {
        await page.waitForTimeout(100);
        now = await page.evaluate(() => window.expired);
      }
      return now === prior + 1 ? true : RETRY;
    });
    expect(await rottenLeg(
      () => window.stt.modelDownloadStatus(),
      'GET', '/api/v1/voice/engines/local/whisper/download/status',
    )).toBeNull();
    expect(await rottenLeg(
      () => window.forge.endForge('ghost-session'),
      'DELETE', '/api/v1/voice/forge/ghost-session',
    )).toBeNull();

    // Fire-and-forget never produced an unhandled rejection or any page error.
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await vite?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
