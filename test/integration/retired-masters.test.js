/**
 * Retired masters — a re-key never destroys the key a store it missed still
 * needs (2026-10-26 and 2026-11-17: the house's channel keys locked for good).
 *
 * The real CLI (scripts/rekey-house.mjs) runs as its own process over a
 * synthetic install; one sealed store stands OUTSIDE everything the re-key
 * walks. After --apply the old master is gone from the env file, the store is
 * still under it — and a fresh process holding only the new master opens it:
 * any process (the keyring is read where the fallback keys are read), with the
 * backend's own start step counting what it admitted. Twice over: the
 * second re-key carries the first one's keyring forward.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { decryptEnvelope, deriveKeyFromSecret, deriveNeumaDEK, encryptEnvelope, wrapDEK } from '../../core/workspace/workspace-crypto.js';
import { readRetiredMasters, retireMasters, retiredMastersPath } from '../../core/workspace/retired-masters.js';
import { readRetiredDeks, retiredDeksPath } from '../../core/workspace/retired-deks.js';

const run = promisify(execFile);
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO, 'scripts', 'rekey-house.mjs');
const OLD = crypto.randomBytes(32).toString('hex');

const put = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const envOf = async (file) => Object.fromEntries((await fs.readFile(file, 'utf8')).split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const opens = (env, secret) => { try { decryptEnvelope(env, { key: deriveKeyFromSecret(secret) }); return true; } catch { return false; } };

// A fresh backend-shaped process holding ONLY the current master: does the store open before the
// start step, and after it? The start step is the backend's own (retired-masters-boot.js).
const BOOT_PROBE = `
import fs from 'fs';
import { parseAndDecrypt } from './core/workspace/workspace-crypto.js';
import { admitRetiredMastersAtBoot } from './backend/services/retired-masters-boot.js';
const raw = fs.readFileSync(process.env.STORE, 'utf8');
const tryOpen = () => { try { return parseAndDecrypt(raw); } catch { return null; } };
const before = tryOpen();
const admitted = admitRetiredMastersAtBoot();
process.stdout.write(JSON.stringify({ before, admitted, after: tryOpen() }));
`;
// The backend's heal step, in its own process holding only the current master.
const HEAL_PROBE = `
import { healStrandedStores } from './backend/services/retired-masters-heal.js';
process.stdout.write(JSON.stringify(await healStrandedStores({ roots: [process.env.ROOT] })));
`;
const bootProbe = async (master, dataRoot, store) => {
  const { stdout } = await run('node', ['--input-type=module', '-e', BOOT_PROBE], {
    cwd: REPO,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DNA_ENCRYPTION_KEY: master, NEUMA_DATA_ROOT: dataRoot, STORE: store, LOG_LEVEL: 'silent' },
  });
  return JSON.parse(stdout.slice(stdout.lastIndexOf('{"before"')));
};

describe('retired masters', () => {
  let base; let data; let envFile; let cliEnv; let missed; let ring;

  beforeEach(async () => {
    base = await createTempDir(`retired-${Math.random().toString(36).slice(2)}`);
    data = path.join(base, 'data');
    envFile = path.join(base, '.env');
    missed = path.join(base, 'somewhere-the-rekey-never-walks', 'channel-keys.json');
    ring = retiredMastersPath(data);
    const master = deriveKeyFromSecret(OLD);
    await put(path.join(data, 'settings', 'provider-credentials.json'), encryptEnvelope({ openai: 'sk-test' }, { key: master }));
    await put(missed, encryptEnvelope({ x: 'the house\'s keys' }, { key: master }));
    await fs.mkdir(path.join(base, 'house', 'workspaces'), { recursive: true });
    await put(envFile, `PORT=3333\nDNA_ENCRYPTION_KEY=${OLD}\n`);
    cliEnv = {
      PATH: process.env.PATH, HOME: process.env.HOME, NEUMA_REKEY_ENV_FILE: envFile,
      WORKSPACES_ROOT: path.join(base, 'house', 'workspaces'), NEUMA_DATA_ROOT: data,
      NEUMA_REALM_ROOT: path.join(base, 'realm'), NEUMA_VAULT_ROOT: path.join(base, 'vault'),
    };
  });

  test('a store the re-key never walked still opens after the old master leaves the env file — across two re-keys', async () => {
    const first = await run('node', [CLI, '--apply'], { env: cliEnv });
    expect(first.stdout).toMatch(/DONE/);
    expect(first.stdout).toContain(ring);
    expect(first.stdout).not.toContain(OLD);
    const one = (await envOf(envFile)).DNA_ENCRYPTION_KEY;
    expect(one).not.toBe(OLD);
    expect((await envOf(envFile)).DNA_ENCRYPTION_KEY_PREVIOUS).toBeUndefined();

    // the missed store is exactly where the re-key left it: under the old master only
    expect(opens(await read(missed), OLD)).toBe(true);
    expect(opens(await read(missed), one)).toBe(false);
    // the keyring holds the old master, sealed: its bytes carry no key, and only the new master opens it
    expect(await fs.readFile(ring, 'utf8')).not.toContain(OLD);
    expect(opens(await read(ring), OLD)).toBe(false);
    expect(readRetiredMasters(ring, [one])).toEqual([OLD]);
    expect((await fs.stat(ring)).mode & 0o777).toBe(0o600);

    const afterFirst = await bootProbe(one, data, missed);
    // any process holding the new master opens it — a script or the CLI never ran the start step
    expect(afterFirst.before).toEqual({ x: 'the house\'s keys' });
    expect(afterFirst.admitted).toBe(1);
    expect(afterFirst.after).toEqual({ x: 'the house\'s keys' });

    const second = await run('node', [CLI, '--apply'], { env: cliEnv });
    expect(second.stdout).toMatch(/DONE/);
    expect(second.stdout).not.toContain(OLD);
    expect(second.stdout).not.toContain(one);
    const two = (await envOf(envFile)).DNA_ENCRYPTION_KEY;
    expect(two).not.toBe(one);
    expect(opens(await read(ring), one)).toBe(false);
    expect(readRetiredMasters(ring, [two]).sort()).toEqual([OLD, one].sort());

    const afterSecond = await bootProbe(two, data, missed);
    expect(afterSecond.before).toEqual({ x: 'the house\'s keys' });
    // and a process pointed at a data root with no keyring does not
    expect((await bootProbe(two, path.join(base, 'empty-data'), missed)).before).toBeNull();
    expect(afterSecond.admitted).toBe(2);
    expect(afterSecond.after).toEqual({ x: 'the house\'s keys' });
  }, 180_000);

  test('the start heals a missed store: it is sealed under the current master, once, and the kept-aside locked file is not touched', async () => {
    await run('node', [CLI, '--apply'], { env: cliEnv });
    const one = (await envOf(envFile)).DNA_ENCRYPTION_KEY;
    const root = path.dirname(missed);
    const aside = path.join(root, 'social-channel-credentials.locked-2026-11-17T08-56-55-375Z.json');
    const asideBytes = JSON.stringify(encryptEnvelope({ kept: 'aside' }, { key: deriveKeyFromSecret(OLD) }));
    await put(aside, asideBytes);
    await put(path.join(root, 'chats', 'being.jsonl'), `${JSON.stringify(encryptEnvelope({ t: 1 }, { key: deriveKeyFromSecret(OLD) }))}\n${JSON.stringify(encryptEnvelope({ t: 2 }, { key: deriveKeyFromSecret(one) }))}\n`);
    const heal = async () => {
      const { stdout } = await run('node', ['--input-type=module', '-e', HEAL_PROBE], {
        cwd: REPO,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, DNA_ENCRYPTION_KEY: one, NEUMA_DATA_ROOT: data, ROOT: root, LOG_LEVEL: 'silent' },
      });
      return JSON.parse(stdout.slice(stdout.lastIndexOf('{"healed"')));
    };
    const first = await heal();
    expect(first).toMatchObject({ healed: true, moved: 2, left: 0 });
    // no keyring needed any more: the current master alone opens it, the old one does not
    expect(decryptEnvelope(await read(missed), { key: deriveKeyFromSecret(one) })).toEqual({ x: 'the house\'s keys' });
    expect(opens(await read(missed), OLD)).toBe(false);
    expect((await fs.stat(missed)).mode & 0o777).toBe(0o600);
    const lines = (await fs.readFile(path.join(root, 'chats', 'being.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => decryptEnvelope(l, { key: deriveKeyFromSecret(one) }))).toEqual([{ t: 1 }, { t: 2 }]);
    expect(await fs.readFile(aside, 'utf8')).toBe(asideBytes);
    expect(await heal()).toMatchObject({ healed: false, why: 'already healed' });
  }, 120_000);

  test('a being\'s old key is kept in its lane across re-keys: a record the lane walk never reached still has its key', async () => {
    const master = deriveKeyFromSecret(OLD);
    const oldDek = deriveNeumaDEK(master, 'ab'.repeat(32));
    const lane = path.join(base, 'house', 'workspaces', 'aaaa1111');
    await put(path.join(lane, 'keys', 'dek.json'), JSON.stringify(wrapDEK(oldDek, master)));
    await put(path.join(lane, 'dna', 'active.json'), encryptEnvelope({ name: 'Aster' }, { key: oldDek }));
    const outside = path.join(base, 'another-vault-root', 'aaaa1111.copy.json');
    await put(outside, encryptEnvelope({ dna: 'a copy the walk never sees' }, { key: oldDek }));

    for (const round of [1, 2]) {
      const { stdout } = await run('node', [CLI, '--apply'], { env: cliEnv });
      expect(stdout).toMatch(/DONE/);
      const current = deriveKeyFromSecret((await envOf(envFile)).DNA_ENCRYPTION_KEY);
      const kept = await readRetiredDeks(lane, [{ key: current }]);
      expect(kept).toHaveLength(round);
      expect(kept[0].equals(oldDek)).toBe(true);
      // wrapped, never in the clear, and only the current master unwraps it
      expect(await fs.readFile(retiredDeksPath(lane), 'utf8')).not.toContain(oldDek.toString('base64'));
      expect(await readRetiredDeks(lane, [{ key: master }])).toHaveLength(0);
      expect((await fs.stat(retiredDeksPath(lane))).mode & 0o777).toBe(0o600);
      expect(decryptEnvelope(await read(outside), { key: kept[0] })).toEqual({ dna: 'a copy the walk never sees' });
    }
  }, 180_000);

  test('a keyring no key here opens is never written over, never read as empty, and stops the re-key before it changes anything', async () => {
    const foreign = JSON.stringify(encryptEnvelope({ masters: [{ secret: 'someone-else' }] }, { key: crypto.randomBytes(32) }));
    await put(ring, foreign);
    const next = crypto.randomBytes(32).toString('hex');
    expect(() => readRetiredMasters(ring, [OLD, next])).toThrow(/does not open with any key/);
    expect(() => retireMasters(ring, [OLD], next)).toThrow(/does not open with any key/);
    expect(await fs.readFile(ring, 'utf8')).toBe(foreign);

    const refused = await run('node', [CLI, '--apply'], { env: cliEnv }).then(() => null, (err) => err);
    expect(refused.stderr).toMatch(/does not open with any key/);
    expect((await envOf(envFile)).DNA_ENCRYPTION_KEY).toBe(OLD);
    expect(await fs.readFile(ring, 'utf8')).toBe(foreign);

    // the backend's start never dies on it: it comes up on its current key and admits nothing
    const boot = await bootProbe(OLD, data, missed);
    expect(boot.admitted).toBe(0);
    expect(boot.after).toEqual({ x: 'the house\'s keys' });
  }, 120_000);
});
