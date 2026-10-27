/**
 * THE LIVE SOCIAL CHECK SCRIPT is read-only (campaign plan slice 11): the
 * real `scripts/social-check-live.mjs`, run as its own process against two
 * houses on real tmp disk, prints the house's report and leaves every file of
 * the realm byte-for-byte as it found it — a v1 key store stays v1 (the
 * migration waits for the desk), and `--probes` on a v1 store is refused. No
 * double anywhere (RULE 0); placeholder keys only, the machine's social keys
 * pinned empty (test/setup.js).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { standTwoHouses, HOUSE_A, HOUSE_B, LEGACY_ENV } from '../helpers/house-office-kit.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { setAppFields, setAccountFields, setAccountMeta, writeCredentialStore } from '../../backend/services/social/account-store.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';

const run = promisify(execFile);
const SCRIPT = path.resolve('scripts/social-check-live.mjs');
let houses;
let env;

// impure — every file under a root, with a hash of its bytes.
const snapshot = async (root) => {
  const out = {};
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else out[path.relative(root, p)] = createHash('sha256').update(await fs.readFile(p)).digest('hex');
    }
  };
  await walk(root);
  return out;
};

const script = (args) => run(process.execPath, [SCRIPT, ...args], { env, cwd: path.resolve('.'), timeout: 60000 })
  .then(({ stdout }) => ({ code: 0, stdout }), (err) => ({ code: err.code, stdout: err.stdout, stderr: err.stderr }));

beforeAll(async () => {
  houses = await standTwoHouses({ label: 'social-check-live-script', lanesA: ['core-cmo'], lanesB: [] });
  const doors = {
    NEUMA_SOCIAL_POST_QUEUE_PATH: path.join(houses.settings, 'social-post-queue.json'),
    NEUMA_SOCIAL_BINDINGS_PATH: path.join(houses.settings, 'social-channel-bindings.json'),
    NEUMA_SECTOR_CREW_PATH: path.join(houses.settings, 'sector-crew.json'),
    NEUMA_SOCIAL_CREDENTIALS_PATH: path.join(houses.settings, 'social-channel-credentials.json'),
  };
  Object.assign(process.env, doors);
  await fs.writeFile(doors.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  await writeOwner(houses.rootA, 'core-cmo', HOUSE_A);
  await setAppFields(HOUSE_A, 'x', { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
  await setAccountMeta(HOUSE_A, 'x-1', { companyId: 'ignis', expectedHandle: 'core_voice' }, ['ignis', 'umbrae']);
  await setAccountFields(HOUSE_A, 'x-1', { accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' });
  await channelBindings.bind(HOUSE_A, 'x-1', { neumaId: 'core-cmo' });
  // House B's keys still in the first shape: one entry per platform.
  await writeCredentialStore(HOUSE_B, { x: { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret', accessToken: 'ph-x-token-9', accessSecret: 'ph-x-secret-9' } });
  env = {
    ...process.env,
    NEUMA_DATA_ROOT: path.join(houses.tmp, 'data'),
    NEUMA_REALM_ROOT: houses.realm,
    WORKSPACES_ROOT: houses.rootA,
    ...Object.fromEntries(Object.keys(LEGACY_ENV).map((k) => [k, process.env[k]])),
  };
});

afterAll(() => {
  houses.restore();
  for (const k of ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH']) delete process.env[k];
});

describe('scripts/social-check-live.mjs — the owner\'s house, read-only', () => {
  test('prints the report, migrates nothing, writes nothing; --probes on a v1 store is refused', async () => {
    const before = await snapshot(houses.tmp);

    const a = await script(['--wallet', HOUSE_A]);
    expect(a.code).toBe(0);
    expect(a.stdout).toContain('## HOUSE SOCIAL CHECK — 0 OF 1 ACCOUNTS CLEAR');
    expect(a.stdout).toContain('live probes not run: identity and right-account read NOT PROVEN');
    expect(a.stdout).not.toMatch(/ph-x-/);

    const b = await script(['--wallet', HOUSE_B]);
    expect(b.code).toBe(0);
    expect(b.stdout).toContain('still stand in the old v1 shape');
    expect(b.stdout).toContain('UNSORTED (no company): x-1');

    const refused = await script(['--wallet', HOUSE_B, '--probes']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('still in the old shape (v1)');

    const json = JSON.parse((await script(['--wallet', HOUSE_A, '--json'])).stdout);
    expect(json).toMatchObject({ storeShape: 'v2', probed: false, house: { clear: 0, total: 1 } });

    expect(await snapshot(houses.tmp)).toEqual(before);
  }, 120000);
});
