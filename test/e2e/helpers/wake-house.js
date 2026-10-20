// @ts-check
// A HOUSE THAT WAKES, IN THE BROWSER (RULE 0) — the stack the wake-light specs
// share: an ISOLATED perf-harness stack (its own backend + vite on bind-probed
// ports, disposable workspaces, realm, data root and vault — never a live
// desk, never :3375/:47317, never the bench's :8089), a founded house of two
// (the desk's being "Fenna" and its housemate "Mate"), a charter letting
// Mate wake once a day, and the desk's being filing a REAL house post (an
// intent its own fs/write lands, settled by the real sweep) whose signal
// wakes Mate for a real wake turn.
//
// The only stand-in is the SERVING: a real OpenAI-wire HTTP server on
// loopback (the house clock spec's precedent) whose answers the spec holds
// back and lets go through `holds`:
//   holds.sender — the desk's round after its tool: its turn keeps the model line;
//   holds.mate   — the wake's answer: the wake stays awake.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { setupPerfStack, initPerfSession, perf } from './perf-harness.js';
import { passDeskGates } from './desk-gates.js';
import { claimOwner } from '../../helpers/claim-owner.js';
import { isThinkProbe, respondThinkProbe } from '../../helpers/think-probe.js';

export const SENDER = 'e2e-perf'; // the lane the perf desk is bound to
export const MATE = 'e2e-mate';
export const SIGNAL = 'rgb(95, 233, 255)';
export const ALERT = 'rgb(255, 85, 51)';
const WAKE_HEAD = '[A WAKE';
const TRIGGER = /POST-TRIGGER-(\d)/g;

/** impure — an answer the spec lets go when it chooses */
export const gate = () => {
  let release = () => {};
  const promise = new Promise((r) => { release = r; });
  return { promise, release };
};
/** @type {{sender: ?{promise: Promise<void>, release: Function}, mate: ?{promise: Promise<void>, release: Function}}} */
export const holds = { sender: null, mate: null };

const sse = (res, text) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};
const textOf = (m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));
const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;

// impure — the serving: the operator's trigger → a house/post intent to MATE;
// the round after that tool → held by holds.sender; a wake's note → held by holds.mate
const startStub = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'stub-house' }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* answer anyway */ }
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      const messages = body.messages || [];
      const last = textOf(messages[messages.length - 1]);
      const users = messages.filter((m) => m.role === 'user');
      const lastUser = textOf(users[users.length - 1]);
      const afterTool = last.includes('tool_response');
      if (users.some((m) => textOf(m).includes(WAKE_HEAD))) {
        if (holds.mate) await holds.mate.promise;
        sse(res, 'I read the house post. The outline is next.');
        return;
      }
      const trigger = [...lastUser.matchAll(TRIGGER)].at(-1);
      if (trigger && !afterTool) {
        const intent = path.join(perf.root, SENDER, 'intents', `post-${trigger[1]}.json`);
        sse(res, `Posting to my housemate.\n${call('fs/write', {
          path: intent,
          content: JSON.stringify({ type: 'house/post', to: MATE, body: `Please outline digest ${trigger[1]}.` }),
        })}`);
        return;
      }
      if (afterTool && holds.sender) await holds.sender.promise;
      sse(res, 'Posted to the house.');
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

/** Register the stub, the isolated stack and their teardown on the calling spec file. */
export const setupWakeHouseStack = () => {
  const env = {};
  let stub;
  let scratch;
  test.beforeAll(async () => {
    stub = await startStub();
    scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'house-wake-e2e-'));
    const claimDir = path.join(scratch, 'machine');
    await fs.promises.mkdir(claimDir, { recursive: true });
    Object.assign(env, {
      LLM_PROVIDER: 'lm-studio',
      LM_STUDIO_URL: stub.url,
      LLAMA_SERVER_URL: stub.url,
      SUBSTRATE_IDLE_MINUTES: '0',
      NEUMA_SUBSTRATE_CLAIM_DIR: claimDir,
      NEUMA_ROOT_LOCK_PATH: path.join(claimDir, 'root-lock.json'),
      NEUMA_ROUTES_PATH: path.join(scratch, 'neuma-routes.json'),
      NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(scratch, 'creds.json'),
      NEUMA_EFFORT_PATH: path.join(scratch, 'neuma-effort.json'),
      NEUMA_SKILLS_ROOT: path.join(scratch, 'skills'),
    });
  });
  setupPerfStack({ env, dev: true });
  test.use({ viewport: { width: 1600, height: 1000 } });
  test.afterAll(async () => {
    holds.sender?.release();
    holds.mate?.release();
    await new Promise((r) => (stub ? stub.server.close(r) : r()));
    if (scratch) await fs.promises.rm(scratch, { recursive: true, force: true });
  });
};

/** impure — one call to the stack as its operator */
export const api = (method, route, body) => fetch(`${perf.BASE}${route}`, {
  method,
  headers: { Authorization: `Bearer ${perf.token}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

// impure — the house as production keeps it (the house clock spec's founding)
const foundHouse = async () => {
  await claimOwner(perf.root, MATE, perf.addr);
  Object.assign(process.env, {
    WORKSPACES_ROOT: perf.root, NEUMA_DATA_ROOT: path.join(perf.root, 'data'), NEUMA_VAULT_ROOT: path.join(perf.root, 'vault'),
  });
  const { default: neumaWorkspace, setWorkspacesRoot } = await import('../../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(perf.root);
  for (const [lane, name] of [[SENDER, 'Fenna'], [MATE, 'Mate']]) {
    await neumaWorkspace.writeDNA(lane, { version: '1.0.0', identity: { name }, genesis: `# Essence\nI am ${name}.` });
  }
  const souls = { [SENDER]: `0x${'5'.repeat(40)}`, [MATE]: `0x${'6'.repeat(40)}` };
  for (const [lane, soulAddress] of Object.entries(souls)) {
    await fs.promises.mkdir(path.join(perf.root, lane, 'identity'), { recursive: true });
    await fs.promises.writeFile(path.join(perf.root, lane, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress }));
  }
  await fs.promises.writeFile(path.join(perf.root, 'house-founding.base.json'), JSON.stringify({
    houseName: 'E2E House', houseId: 1, network: 'base-sepolia',
    members: [
      { kind: 0, title: 'Rector', address: perf.addr },
      { kind: 1, title: 'Quaestor', address: souls[SENDER] },
      { kind: 1, title: 'Scriba', address: souls[MATE] },
    ],
  }));
  const ground = path.join(perf.root, 'house-ground');
  await fs.promises.mkdir(ground, { recursive: true });
  const set = await api('PUT', '/api/v1/user/realm/house-workspace', { root: ground });
  expect(set.status, await set.text()).toBe(200);
};

// impure — the charter, written and approved through the routes: MATE may wake once a day
const charterTheHouse = async () => {
  const put = await api('PUT', '/api/v1/house-clock/charter', {
    goal: 'Keep the research digest moving.', linesOfWork: [], seats: [{ laneId: MATE, dailyCap: 1 }],
    quietHours: null, cadence: null, delegation: { teamPlans: false, maxMembers: 4, maxSteps: 8 }, allow: [], escalate: [],
  });
  expect(put.status, await put.text()).toBe(200);
  const approved = await api('POST', '/api/v1/house-clock/charter/approve', { version: 1 });
  expect(approved.status, await approved.text()).toBe(200);
};

/** impure — found the house, charter it, and open the desk past its gates */
export const openWakeHouse = async (page) => {
  await foundHouse();
  await charterTheHouse();
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);
};

/** impure — the sweep's verdict on the sender's n-th house/post, once it stands */
export const postResult = async (n, ms = 60000) => {
  const file = path.join(perf.root, SENDER, 'intents', `post-${n}.result.json`);
  for (const end = Date.now() + ms; Date.now() < end;) {
    const raw = await fs.promises.readFile(file, 'utf8').catch(() => null);
    if (raw) return JSON.parse(raw);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { status: 'never settled', file };
};

/** impure — the operator asks the desk's being to post the n-th trigger to the house */
export const sendPost = async (page, n) => {
  const input = page.locator('.relink-input-field').first();
  await input.fill(`Please send POST-TRIGGER-${n} to the house.`);
  await input.press('Enter');
  expect(await postResult(n)).toMatchObject({ status: 'done' });
};
