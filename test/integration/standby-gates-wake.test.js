/**
 * A RESTING HOUSE MODEL IS ASLEEP, NOT OFFLINE — the run gates wake it.
 *
 * Standby is on by default: after its idle window the monitor stops the
 * house's supervised llama-server to give the hardware back, and the next
 * turn relights it. The gates in front of a team run, a trial, a capacity
 * scan and the birth flight check only asked testConnection — so during
 * ordinary standby they answered "offline" (503 / unreachable) for a model
 * that wakes on use. They now ask through reachSubstrate, which wakes it
 * the way a turn does.
 *
 * Real supervisor, a real stand-in server process on a real port, the real
 * idle monitor putting it to rest (RULE 0). Nothing here reaches the
 * machine's own serving: every door is pinned (house-serving-stand-in.js).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useHouseServing } from '../helpers/house-serving-stand-in.js';
import { closedProviderEndpoint } from '../helpers/local-provider.js';

// A gate that does NOT wake falls through to the flight check's discovery of
// other servers: pin the sweep, the credential store and the choice file so
// that path can only ever find nothing — never the machine's own servers.
const DIR = mkdtempSync(path.join(os.tmpdir(), 'neuma-standby-gates-'));
process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(DIR, 'provider-credentials.json');
process.env.NEUMA_PROVIDER_CHOICE_PATH = path.join(DIR, 'llm-provider-choice.json');

let house;
let sup;
let idle;
let provider;
let busy;
beforeAll(async () => {
  const dead = await closedProviderEndpoint();
  process.env.NEUMA_DISCOVERY_PORTS = String(dead.port);
  const { setCredential } = await import('../../backend/services/provider-credentials.js');
  await setCredential('ollama', { endpoint: dead.endpoint });
  await setCredential('lm-studio', { endpoint: dead.endpoint });
  house = await useHouseServing();
  sup = await import('../../backend/services/llama-server-supervisor.js');
  idle = await import('../../backend/services/substrate-idle.js');
  provider = await import('../../backend/services/llm-provider.js');
  ({ substrateBusy: busy } = await import('../../backend/services/substrate-lifecycle.js'));
  provider.setConfig({ provider: 'llama-server', endpoint: house.endpoint, model: 'stand-in-model' });
  expect((await sup.startSupervised(sup.activeLaunchConfig(process.env), { waitMs: 15000 })).status).toBe('serving');
}, 30000);
afterAll(async () => {
  await sup.stopSupervised();
  await house.restore();
  delete process.env.NEUMA_DISCOVERY_PORTS;
  rmSync(DIR, { recursive: true, force: true });
});

// impure — let the real idle monitor put the house model to rest, as standby does.
const putToRest = async () => {
  const stop = idle.startIdleMonitor({
    idleMs: 1,
    intervalMs: 50,
    check: async () => {
      const launch = sup.activeLaunchConfig(process.env);
      const st = await sup.supervisorStatus(launch);
      return { serving: st.serving, owned: st.owned, busy: st.serving ? await busy(launch) : false };
    },
    unload: () => sup.stopSupervised(),
  });
  try {
    const deadline = Date.now() + 15000;
    while (!idle.deliberateStandby().standby && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    stop();
  }
  expect(idle.deliberateStandby().standby).toBe(true);
  expect(await sup.isServing(house.port)).toBe(false);
  expect(await provider.testConnection()).toBe(false);
};

describe('the gates during standby', () => {
  test('the team / trial gate reach wakes the resting model and reads it reachable', async () => {
    await putToRest();
    const { reachSubstrate } = await import('../../backend/services/substrate-reach.js');
    expect(await reachSubstrate()).toBe(true);
    expect(await sup.isServing(house.port)).toBe(true);
    expect(idle.deliberateStandby().standby).toBe(false);
  }, 40000);

  test('the birth flight check passes on a resting model instead of failing it as unreachable', async () => {
    await putToRest();
    const { checkSubstrate } = await import('../../backend/routes/preflight-checks.js');
    const row = await checkSubstrate();
    expect(row.status).toBe('pass');
  }, 40000);

  test('the capacity scan measures a resting model instead of refusing it as unreachable', async () => {
    await putToRest();
    const { runCapacityScan } = await import('../../backend/services/capacity-scan.js');
    const result = await runCapacityScan({
      ladder: [1], repeats: 1, substrate: {}, runAt: new Date().toISOString(),
    });
    expect(result).toBeTruthy();
  }, 40000);
});
