/* global window, sessionStorage */
// Team-client reads (MOD-001 family F17): the seven GET reads of
// frontend/app/RelinkShell/team-client.js proven through the REAL team router
// and a REAL Chromium page — no mocks anywhere in the path (RULE 0). Every
// read is never-throw and discriminated: unauthenticated and failure both
// resolve { ok:false, … } with the slot emptied (null or []), and a 401
// against a held token raises neuma:auth_expired (the D2a rot alarm).
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
import teamRouter from '../../backend/routes/team-routes.js';
import { createRun } from '../../backend/services/team-run-store.js';
import { writeTrial } from '../../backend/services/team-trial-store.js';
import { snapshotDelivery } from '../../backend/services/team-delivery.js';
import { listBenches as packShelf } from '../../backend/services/bench-pack.js';

test('team-client reads keep their discriminated never-throw contract through the real routes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-client-http-'));
  const paths = { NEUMA_DATA_ROOT: 'data', WORKSPACES_ROOT: 'lanes',
    NEUMA_TEAM_RUN_PATH: 'runs', NEUMA_TEAM_TRIAL_PATH: 'trials', NEUMA_TEAM_DELIVERY_PATH: 'deliveries' };
  const saved = Object.fromEntries(Object.keys(paths).map(key => [key, process.env[key]]));
  let vite; let server; let browser;
  try {
    for (const [key, file] of Object.entries(paths)) process.env[key] = path.join(root, file);
    const auth = await fullAuth();
    const runAt = '2026-09-10T12:00:00.000Z';
    const runId = await createRun({
      by: auth.address, runAt, name: 'TEAM ALPHA', goal: 'prove the reads', status: 'done',
      steps: [{ id: 'a', neumaId: 'kin', task: 'do the thing', needs: [] }],
      completed: { a: 'the work' }, statuses: { a: 'stood here' }, torches: {},
      order: ['a'], failures: {}, failure: null, finishedAt: '2026-09-10T12:01:00.000Z',
    });
    const trialId = await writeTrial({
      trial: 'brickworks', version: 3, by: auth.address, runAt: '2026-09-09T12:00:00.000Z',
      score: { points: 8, max: 8, verdict: 'PASS' }, artifact: '<html>game</html>',
    });
    const arena = path.join(root, 'arena');
    await fs.mkdir(arena, { recursive: true });
    await fs.writeFile(path.join(arena, 'notes.txt'), 'the delivered notes');
    await snapshotDelivery({ id: 'delivery-proof', by: auth.address, root: arena });

    const app = express();
    const requests = [];
    app.use('/api', (req, res, next) => { res.on('finish', () => requests.push({ method: req.method, url: req.originalUrl, status: res.statusCode })); next(); });
    app.use('/api/v1/team', teamRouter);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">'
      + 'import { listRuns, readRun, loadTrialSpec, readTrial, listTrials, listBenches, readRunDelivery } from "/frontend/app/RelinkShell/team-client.js";'
      + 'window.team = { listRuns, readRun, loadTrialSpec, readTrial, listTrials, listBenches, readRunDelivery };'
      + 'window.expired = 0; window.addEventListener("neuma:auth_expired", () => window.expired++);'
      + '</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.team);

    // Unauthenticated: every read resolves its failure shape WITHOUT a request.
    const unauth = await page.evaluate(() => Promise.all([
      window.team.listRuns(), window.team.readRun('x'), window.team.loadTrialSpec(),
      window.team.readTrial('x'), window.team.listTrials(), window.team.listBenches(),
      window.team.readRunDelivery('x'),
    ]));
    expect(unauth).toEqual([
      { ok: false, runs: [] }, { ok: false, run: null }, { ok: false, spec: null },
      { ok: false, trial: null }, { ok: false, trials: [] }, { ok: false, benches: [] },
      { ok: false, delivery: null },
    ]);
    expect(requests).toEqual([]);

    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);

    // The real records come back whole through the real router.
    const runs = await page.evaluate(() => window.team.listRuns());
    expect(runs.ok).toBe(true);
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]).toMatchObject({ id: runId, name: 'TEAM ALPHA', status: 'done', steps: 1, completed: 1 });

    const run = await page.evaluate(id => window.team.readRun(id), runId);
    expect(run.ok).toBe(true);
    expect(run.run).toMatchObject({ id: runId, goal: 'prove the reads', completed: { a: 'the work' } });
    expect(await page.evaluate(() => window.team.readRun('no-such-run'))).toEqual({ ok: false, run: null });

    const spec = await page.evaluate(() => window.team.loadTrialSpec());
    expect(spec.ok).toBe(true);
    expect(spec.spec).toMatchObject({ trial: 'brickworks', version: 3 });
    expect(spec.spec.roles).toHaveLength(4);

    const trial = await page.evaluate(id => window.team.readTrial(id), trialId);
    expect(trial.ok).toBe(true);
    expect(trial.trial).toMatchObject({ id: trialId, artifact: '<html>game</html>' });
    expect(await page.evaluate(() => window.team.readTrial('no-such-trial'))).toEqual({ ok: false, trial: null });

    const trials = await page.evaluate(() => window.team.listTrials());
    expect(trials.ok).toBe(true);
    expect(trials.trials).toHaveLength(1);
    expect(trials.trials[0].id).toBe(trialId);
    expect(trials.trials[0].hasArtifact).toBe(true);
    expect(trials.trials[0].artifact).toBeUndefined(); // summaries never carry it

    const benches = await page.evaluate(() => window.team.listBenches());
    expect(benches.ok).toBe(true);
    // the shelf is the benchmarks repository's brickworks pack — exactly what it holds
    expect(benches.benches.map((bench) => bench.id)).toEqual(packShelf().map((bench) => bench.id));
    expect(benches.benches.every(bench => bench.task === undefined)).toBe(true); // meta only

    const delivery = await page.evaluate(() => window.team.readRunDelivery('delivery-proof'));
    expect(delivery.ok).toBe(true);
    expect(delivery.delivery.files).toEqual([{ file: 'notes.txt', bytes: 19, kind: 'text' }]);
    expect(await page.evaluate(() => window.team.readRunDelivery('absent'))).toEqual({ ok: false, delivery: null });
    expect(await page.evaluate(() => window.expired)).toBe(0);

    // A 401 against a held token: failure shape AND the rot alarm, per read.
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    expect(await page.evaluate(() => window.team.listRuns())).toEqual({ ok: false, runs: [] });
    expect(await page.evaluate(() => window.team.readRun('x'))).toEqual({ ok: false, run: null });
    expect(await page.evaluate(() => window.expired)).toBe(2);
    expect(requests.filter(request => request.status === 401).length).toBe(2);

    // Recovery: the real token reads again.
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect((await page.evaluate(() => window.team.listRuns())).runs).toHaveLength(1);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
