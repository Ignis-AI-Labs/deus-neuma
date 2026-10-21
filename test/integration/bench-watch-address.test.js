/**
 * THE BENCH WATCH'S CARD GOES TO THE RUN'S OWN OPERATOR (RULE 0; houses are
 * never confused). A real temp harness tree holding a stalled live night and
 * the harness's own pass record for it, a real workspaces root whose only lane
 * belongs to ANOTHER house, the real watch tick, the real notification store
 * in a temp realm. The serving probe is pointed at a closed loopback port, so
 * nothing here reaches the rig's server.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { generateKeypair } from '../../core/weave/keypair.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { benchWatchTick } from '../../backend/services/bench/bench-watchdog.js';
import { readNotifications } from '../../backend/services/notification-store.js';

useTempRealm();
const ENV = ['NEUMA_BENCH_HARNESS_PATH', 'NEUMA_BENCH_SERVING_URL', 'NEUMA_DATA_ROOT', 'NEUMA_BENCH_OPERATOR_WALLET', 'NEUMA_BENCH_WATCH_PATH'];
const NIGHT = 'night-20261019t010000z';
const issuer = generateKeypair().address.toLowerCase();
const otherHouse = generateKeypair().address.toLowerCase();
let root; let tree; let saved; let savedHouse;

const writeNight = async (over = {}) => {
  const file = path.join(tree, 'logs', `${NIGHT}-status.json`);
  await fs.writeFile(file, JSON.stringify({
    status: 'running', startedAt: '2026-10-19T01:00:00Z', deadline: '2099-01-01T00:00:00Z',
    waitingFor: 'model-endpoint', groups: [], steps: [], unstartedGroups: [], ...over,
  }));
  const stale = new Date(Date.now() - 20 * 60 * 1000); // untouched for 20 minutes
  await fs.utimes(file, stale, stale);
};
const cards = async (wallet) => (await readNotifications(wallet)).records.map((r) => r.ref?.condition);

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  savedHouse = getWorkspacesRoot();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-watch-address-'));
  tree = path.join(root, 'harness');
  await fs.mkdir(path.join(tree, 'logs'), { recursive: true });
  await fs.mkdir(path.join(tree, '.night-passes'), { recursive: true });
  await fs.writeFile(path.join(tree, 'bench.mjs'), '// the availability probe only needs it present\n');
  await fs.writeFile(path.join(tree, 'logs', 'serving-incidents.jsonl'), '');
  // the harness's own record of the pass the desk issued for this night (runtime/night-pass.js)
  await fs.writeFile(path.join(tree, '.night-passes', 'pass-20261019010000000-0123456789ab.started.json'), JSON.stringify({
    schema: 1, id: 'pass-20261019010000000-0123456789ab', plan: 'plans/p.json', issuedBy: issuer, logPrefix: NIGHT,
  }));
  await writeNight();
  Object.assign(process.env, {
    NEUMA_BENCH_HARNESS_PATH: tree, NEUMA_BENCH_SERVING_URL: 'http://127.0.0.1:9', NEUMA_DATA_ROOT: path.join(root, 'data'),
  });
  delete process.env.NEUMA_BENCH_OPERATOR_WALLET;
  delete process.env.NEUMA_BENCH_WATCH_PATH;
  // the only claimed lane on this box is another house's — the first lane a scan finds
  setWorkspacesRoot(path.join(root, 'house'));
  await claimOwner(path.join(root, 'house'), 'aaa-other-house-being', otherHouse);
});

afterAll(async () => {
  setWorkspacesRoot(savedHouse);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(root, { recursive: true, force: true });
});

describe('a bench alert is addressed to the run\'s own operator', () => {
  test('a stalled night\'s card goes to the wallet that issued its pass, never another house', async () => {
    const fires = await benchWatchTick();
    expect(fires.map((f) => f.condition)).toContain('endpoint-wait-stall');
    expect(await cards(issuer)).toContain('endpoint-wait-stall');
    expect(await cards(otherHouse)).toEqual([]);
  });

  test('with no live run to own it, an incident is journal only — no house is guessed', async () => {
    await writeNight({ finishedAt: '2026-10-19T02:00:00Z' });
    await fs.appendFile(path.join(tree, 'logs', 'serving-incidents.jsonl'), `${JSON.stringify({ at: '2026-10-19T02:01:00Z', event: 'down', probeFailures: 3 })}\n`);
    const fires = await benchWatchTick();
    expect(fires.map((f) => f.condition)).toContain('serving-incident');
    expect(await cards(otherHouse)).toEqual([]);
    expect(await cards(issuer)).not.toContain('serving-incident');
    const journal = await fs.readFile(path.join(root, 'data', 'benchmarks', 'watch', 'incidents.jsonl'), 'utf8');
    expect(journal).toContain('"condition":"serving-incident"');
  });
});
