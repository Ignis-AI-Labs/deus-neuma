// THE PLATFORM door, end to end in a real browser (docs/work/harness-only.md):
// the chooser's first door → the harness door → LOCAL or CLOUD → the local
// pre-flight reads this machine's model servers → one proven live → a harness
// lane opened for this wallet → the desk. Real signed-wallet auth, the REAL
// routing and harness routes, the REAL machine probe behind
// /api/v1/preflight/setup (its port sweep pinned to the house model server,
// read only). No being, no rite, no seal anywhere on the road.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { createSessionToken, generateChallenge, verifySignature } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { getSetupStatus } from '../../backend/services/substrate-setup.js';

const HOUSE_MODEL = 'http://127.0.0.1:8089';
// every store the door writes is this test's own — CONNECT locks a connection
// (NEUMA_CONNECTIONS_PATH), never into the machine's real summon pool
const ENV = ['HARNESS_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT', 'NEUMA_DISCOVERY_PORTS', 'NEUMA_CONNECTIONS_PATH'];

test('the platform door: local or cloud; the local pre-flight finds the running server, opens a harness lane on it, lands on the desk — no being, no rite', async () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-harness-door-'));
  let vite; let server; let browser;
  try {
    const models = await (await fetch(`${HOUSE_MODEL}/v1/models`, { signal: AbortSignal.timeout(3000) })).json()
      .catch(() => null);
    expect(models?.data?.length, 'the house model server must be answering for this proof').toBeGreaterThan(0);

    process.env.HARNESS_ROOT = path.join(root, 'harness');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
    process.env.NEUMA_CONNECTIONS_PATH = path.join(root, 'connections.json');
    process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
    process.env.NEUMA_DISCOVERY_PORTS = new URL(HOUSE_MODEL).port; // the sweep reads only the house server
    setHarnessRoot(process.env.HARNESS_ROOT);
    const { default: routingRouter } = await import('../../backend/routes/routing-routes.js');
    const { default: harnessRouter } = await import('../../backend/routes/harness-routes.js');

    const keypair = generateKeypair();
    const challenge = generateChallenge(keypair.address);
    const token = createSessionToken(verifySignature(keypair.address, challenge, await signMessage(keypair.privateKey, challenge)));

    const repo = fileURLToPath(new URL('../..', import.meta.url));
    vite = await createServer({ configFile: false, root: repo, cacheDir: path.join(root, 'cache'),
      appType: 'custom', esbuild: { jsx: 'automatic' },
      optimizeDeps: { entries: ['test/fixtures/harness-door.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/routing', routingRouter);
    app.use('/api/v1/harness', harnessRouter);
    app.get('/api/v1/preflight/setup', async (_q, res) => res.json(await getSetupStatus()));
    app.get('/', (_q, res) => res.type('html').send('<!doctype html><body style="margin:0"><script type="module" src="/test/fixtures/harness-door.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript((t) => sessionStorage.setItem('authToken', t), token);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);

    // the lightest door leads, and says what it asks
    const first = page.locator('.firstrun-path').first();
    await expect.poll(() => first.textContent()).toContain('Harness');
    expect(await first.textContent()).toContain('no being, no covenant');
    expect(await first.textContent()).toContain('needs: a model or an API key');
    await first.click();

    // a machine that already serves a model starts on LOCAL (the house llama.cpp here is
    // ready): the road is chosen for the person, the cloud one press away
    await page.getByTestId('firstrun-harness').waitFor();
    const local = page.getByRole('radio', { name: /On this machine/ });
    await expect.poll(() => local.getAttribute('aria-checked'), { timeout: 30_000 }).toBe('true');

    // CLOUD: the witness door's catalog, with the machine's own servers left to LOCAL
    await page.getByRole('radio', { name: /A cloud provider/ }).click();
    await page.getByRole('button', { name: 'Harness provider' }).click();
    const offered = await page.getByRole('option').allTextContents();
    expect(offered).toContain('OpenAI');
    expect(offered.filter((o) => ['LM Studio', 'Ollama', 'llama-server'].includes(o))).toEqual([]);
    await page.keyboard.press('Escape');

    // LOCAL: the pre-flight lists the servers — the house llama.cpp ready, the
    // fixed Ollama and LM Studio addresses named whatever their state
    await page.getByRole('radio', { name: /On this machine/ }).click();
    const servers = page.getByRole('radiogroup', { name: 'Local model server' });
    const house = servers.getByRole('radio', { name: /llama\.cpp/ });
    await house.waitFor({ timeout: 30_000 });
    expect(await house.textContent()).toMatch(/READY · \d+ MODELS?/);
    expect(await servers.getByRole('radio', { name: /Ollama/ }).count()).toBe(1);
    expect(await servers.getByRole('radio', { name: /LM Studio/ }).count()).toBe(1);
    await house.click();
    expect(await house.getAttribute('aria-checked')).toBe('true');
    expect(await page.getByLabel('Provider API key').count()).toBe(0);
    await page.getByRole('button', { name: 'CONNECT & OPEN THE DESK' }).click();
    await page.getByTestId('desk').waitFor({ timeout: 60_000 }); // first load builds the door's modules; slow under a parallel run

    const lane = await page.evaluate(() => window.__harnessLane);
    expect(lane.participantKind).toBe('harness');
    expect(lane.laneId).toBe(`harness-${keypair.address.slice(2, 10).toLowerCase()}`);
    expect(lane.providerId).toBe('llama-server');
    expect(lane.model).toBe(models.data[0].id);
    const marker = JSON.parse(await fs.readFile(path.join(process.env.HARNESS_ROOT, lane.laneId, 'lane.json'), 'utf8'));
    expect(marker).toMatchObject({ kind: 'harness', providerId: 'llama-server', model: lane.model });
    // the lock landed in THIS test's store
    expect(Object.keys(JSON.parse(await fs.readFile(process.env.NEUMA_CONNECTIONS_PATH, 'utf8')))).toEqual(['llama-server']);
    // nothing of a being: the workspace skeleton's dna/ and soul/ stand empty,
    // and no seal or keypair exists anywhere in the lane
    const laneDir = path.join(process.env.HARNESS_ROOT, lane.laneId);
    const files = (await fs.readdir(laneDir, { recursive: true, withFileTypes: true }))
      .filter((d) => d.isFile()).map((d) => path.relative(laneDir, path.join(d.parentPath ?? d.path, d.name)));
    expect(files.filter((f) => /^(dna|soul)\//.test(f) || /seal|keypair/i.test(f))).toEqual([]);
  } finally {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await vite?.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
