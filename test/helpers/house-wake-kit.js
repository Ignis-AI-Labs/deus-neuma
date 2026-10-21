/**
 * A HOUSE THAT WAKES, FOR REAL (RULE 0) — the staff-office fixture (a temp
 * realm, a temp house ground, three lanes owned by one wallet, the Optio
 * seated) with the house clock wired exactly as house-clock-routes.js wires
 * it, and a real loopback OpenAI-wire provider standing in as the house's
 * model (the route is the platform default pointed at it — never
 * 'llama-server', which would boot one). The house-wake-turn suite's setup,
 * shared by the Optio suites.
 */
import path from 'path';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from './staff-office-fixture.js';
import { startLocalProvider } from './local-provider.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { writeCharter, approveCharter } from '../../backend/services/house-clock/charter-store.js';
import { setWakeSink } from '../../backend/services/house-clock/wake-signal.js';
import { setWakeRunner, configureWakeQueue, whenHouseIdle } from '../../backend/services/house-clock/wake-queue.js';
import { readWakeLedger } from '../../backend/services/house-clock/wake-ledger.js';
import { takeSignal } from '../../backend/services/house-clock/house-clock.js';
import { runWakeTurn } from '../../backend/services/house-clock/wake-turn.js';
import { makePost, appendPost } from '../../backend/services/house-post.js';

export { WALLET, OPTIO, HOUSEMATE, BYSTANDER };
export const NAMES = Object.freeze({ [OPTIO]: 'Optio', [HOUSEMATE]: 'Quae', [BYSTANDER]: 'Cosi' });
const ENV = ['NEUMA_ROUTES_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_TEAM_DELIVERY_PATH', 'NEUMA_CMO_PATH', 'NEUMA_WEB_ACCESS_PATH'];

/** A text-protocol tool call, as a scripted reply carries it. Pure. */
export const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;

/** Poll until check() answers truthy. impure (time). */
export const until = async (check, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** The last user message a completion request carried. Pure. */
export const userText = (body) => {
  const users = (body?.messages || []).filter((m) => m.role === 'user');
  const last = users[users.length - 1];
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
};

/** impure — stand the house up; returns its handles and a teardown. */
export const createWakeHouse = async () => {
  const office = await createStaffOfficeFixture();
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) process.env[k] = path.join(office.root, 'settings', `${k.toLowerCase()}.json`);
  for (const [id, name] of Object.entries(NAMES)) {
    await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name }, genesis: `# Essence\nI am ${name}.` });
  }
  await connectFilesystemServer();
  configureWakeQueue({ settleMs: 0 });
  setWakeSink(takeSignal);
  setWakeRunner(runWakeTurn);
  const house = {
    office,
    provider: null,
    /** Serve a scripted model: one entry per completion request, the Optio's reviews included. */
    serve: async (script, opts = {}) => {
      house.provider = await startLocalProvider({ script, ...opts });
      setConfig({ provider: 'lm-studio', endpoint: house.provider.endpoint, model: 'test-model', apiKey: '' });
      return house.provider;
    },
    /** Write and approve a charter seating the Optio and the housemate. */
    charter: async (patch = {}) => {
      const c = await writeCharter(WALLET, {
        goal: 'Find a real gap and build the product for it.',
        linesOfWork: ['research digests'],
        seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 5 }],
        delegation: { teamPlans: true, maxMembers: 2, maxSteps: 3 },
        ...patch,
      }, { by: WALLET, ownedLanes: Object.keys(NAMES) });
      return approveCharter(WALLET, { version: c.version, by: WALLET });
    },
    /** A house post from `from` to `to` — its signal wakes `to`. */
    post: (to, body, from = OPTIO) => appendPost(office.ground, makePost({ from, to, body, now: new Date().toISOString() })),
    /** The wake ledger, oldest first, once it holds n rows. */
    ledgerRows: (n) => until(async () => {
      const { rows } = await readWakeLedger(WALLET, { limit: 50 });
      return rows.length >= n ? rows.reverse() : null;
    }),
    teardown: async () => {
      await whenHouseIdle(WALLET);
      setWakeSink(null);
      setWakeRunner(null);
      configureWakeQueue({ settleMs: 3000 });
      await house.provider?.close();
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      await office.teardown();
    },
  };
  return house;
};
