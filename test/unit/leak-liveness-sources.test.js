/**
 * LEAK LIVENESS READS EVERY LIVE SOURCE (security-seat recheck, 2026-10-20).
 *
 * Liveness read only the regular env files at a checkout's root, so a leaked
 * key still in use read "not live" when the root .env was a symlink or the
 * value sat in backend/.env — and a "not live" verifies the CSO's mitigated
 * claim. Proven the way the probe found it (s45/liveness-symlink.mjs), on the
 * real path, no double (RULE 0): the real `checkLeakLiveness` over a real tmp
 * git checkout, its sources read by the gate's own collector
 * (secret-sources.js). HOME is pinned to a tmp dir so the machine's secret
 * store read is this test's, never the operator's.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import process from 'process';
import { createTempDir } from '../helpers/temp-fs.js';
import { checkLeakLiveness } from '../../backend/services/security/leak-liveness.js';
import { scanLine } from '../../backend/services/security/secret-sweep.js';

const execFileP = promisify(execFile);
// A fake GitHub-token SHAPE built at runtime — never a real value.
const FAKE = ['ghp', 'R'.repeat(40)].join('_');

describe('a leaked value still in use reads live wherever the machine keeps it', () => {
  let root;
  let home;
  const saved = { HOME: process.env.HOME, NEUMA_SECRETS_FILE: process.env.NEUMA_SECRETS_FILE };
  const [{ patternId, fingerprint }] = scanLine(`x=${FAKE}`);
  const finding = { source: 'secret-sweep', externalId: `history:${patternId}:${fingerprint}`, patternId, fingerprint, summary: 's', severity: 'high' };
  const liveness = async () => (await checkLeakLiveness(root, [finding]))[0];

  beforeEach(async () => {
    root = await createTempDir('leak-liveness-root');
    home = await createTempDir('leak-liveness-home');
    process.env.HOME = home;
    delete process.env.NEUMA_SECRETS_FILE;
    await execFileP('git', ['init', '-q'], { cwd: root });
    await fs.writeFile(path.join(root, '.gitignore'), '.env\nsecret-real.txt\n');
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('a regular root .env: live (the case that always worked)', async () => {
    await fs.writeFile(path.join(root, '.env'), `GITHUB_TOKEN=${FAKE}\n`);
    expect(await liveness()).toMatchObject({ live: true, liveAs: 'GITHUB_TOKEN in .env', severity: 'critical' });
  });

  test('a root .env that is a symlink: live, not "no longer in use"', async () => {
    await fs.writeFile(path.join(root, 'secret-real.txt'), `GITHUB_TOKEN=${FAKE}\n`);
    await fs.symlink(path.join(root, 'secret-real.txt'), path.join(root, '.env'));
    expect(await liveness()).toMatchObject({ live: true, liveAs: 'GITHUB_TOKEN in .env' });
  });

  test('the value in a nested backend/.env: live', async () => {
    await fs.mkdir(path.join(root, 'backend'));
    await fs.writeFile(path.join(root, 'backend', '.env'), `GITHUB_TOKEN=${FAKE}\n`);
    expect(await liveness()).toMatchObject({ live: true, liveAs: 'GITHUB_TOKEN in backend/.env' });
  });

  test("the value in the machine's secret store (~/.neuma/secrets.json): live", async () => {
    await fs.mkdir(path.join(home, '.neuma'));
    await fs.writeFile(path.join(home, '.neuma', 'secrets.json'), JSON.stringify({ githubToken: FAKE }));
    expect((await liveness()).live).toBe(true);
  });

  test('no source holds it: not live — the only verdict that lets a claim verify', async () => {
    await fs.writeFile(path.join(root, '.env'), 'GITHUB_TOKEN=read-from-the-vault\n');
    expect(await liveness()).toMatchObject({ live: false, severity: 'high' });
  });

  test('a source that exists but cannot be read: unknown, never "not live"', async () => {
    await fs.writeFile(path.join(root, '.env'), `GITHUB_TOKEN=${FAKE}\n`);
    await fs.chmod(path.join(root, '.env'), 0);
    expect((await liveness()).live).toBeNull();
  });
});
