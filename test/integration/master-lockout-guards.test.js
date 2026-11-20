/**
 * The other roads to a locked-out install, each on real files with real crypto:
 *   - a missing secrets file on an install that already holds sealed data makes
 *     no new key (it stops and says where the key has to come from);
 *   - the start writes the master check, and says so when the key in hand is
 *     not the one the data was sealed under;
 *   - the packaged desk's key record has a copy beside it: a deleted record is
 *     read from the copy, never taken for a fresh install;
 *   - a chat copy whose sealed turns do not open says so instead of reading short.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { ensureSecrets } from '../../backend/services/secret-provisioning.js';
import { deriveKeyFromSecret, encryptEnvelope } from '../../core/workspace/workspace-crypto.js';
import { masterCheckPath, masterCheckState } from '../../core/workspace/master-check.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const lock = require('../../electron/key-lock/key-lock.cjs');
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hex = () => crypto.randomBytes(32).toString('hex');

// A real keychain-shaped seal: AES-256-GCM under a key only this object holds (as test/unit/key-lock.test.js).
const aesSeal = () => {
  const key = crypto.randomBytes(32);
  return {
    backend: () => 'gnome_libsecret',
    encrypt: (text) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]);
    },
    decrypt: (blob) => {
      const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
      d.setAuthTag(blob.subarray(12, 28));
      return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
    },
  };
};

// One backend-shaped process: the start's master check, then a read of a chat copy.
const child = async (script, env) => {
  const { stdout, stderr } = await run('node', ['--input-type=module', '-e', script], { cwd: REPO, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  return `${stdout}\n${stderr}`;
};

describe('master lockout guards', () => {
  let base; let data; let secrets; let saved;

  beforeEach(async () => {
    base = await createTempDir(`lockout-${Math.random().toString(36).slice(2)}`);
    data = path.join(base, 'data');
    secrets = path.join(base, 'home', 'secrets.json');
    saved = process.env.NEUMA_SECRETS_FILE;
    process.env.NEUMA_SECRETS_FILE = secrets;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.NEUMA_SECRETS_FILE; else process.env.NEUMA_SECRETS_FILE = saved;
  });

  test('no new master is made over an install that already holds sealed data', () => {
    // a fresh install: nothing sealed yet, keys are made as before
    const fresh = { NEUMA_DATA_ROOT: data };
    expect(ensureSecrets({ env: fresh }).generated.sort()).toEqual(['AUTH_SECRET', 'DNA_ENCRYPTION_KEY']);

    // the same install later: a store sealed under that master, and the secrets file gone
    fs.mkdirSync(path.join(data, 'settings'), { recursive: true });
    fs.writeFileSync(path.join(data, 'settings', 'provider-credentials.json'), JSON.stringify(encryptEnvelope({ k: 1 }, { key: deriveKeyFromSecret(fresh.DNA_ENCRYPTION_KEY) })));
    fs.rmSync(secrets);
    const lost = { NEUMA_DATA_ROOT: data };
    expect(() => ensureSecrets({ env: lost })).toThrow(/will not make a new key over it/);
    expect(lost.DNA_ENCRYPTION_KEY).toBeUndefined();
    expect(fs.existsSync(secrets)).toBe(false);

    // the key put back in the environment: the start goes on, and nothing is generated for it
    const restored = { NEUMA_DATA_ROOT: data, DNA_ENCRYPTION_KEY: fresh.DNA_ENCRYPTION_KEY, AUTH_SECRET: fresh.AUTH_SECRET };
    expect(ensureSecrets({ env: restored }).generated).toEqual([]);
  });

  test('the start writes the master check once, and names a master that is not the one the data was sealed under', async () => {
    const BOOT = `
import { standMasterCheckAtBoot } from './backend/services/retired-masters-boot.js';
process.stdout.write('STATE=' + standMasterCheckAtBoot());
`;
    const master = hex();
    expect(await child(BOOT, { DNA_ENCRYPTION_KEY: master, NEUMA_DATA_ROOT: data })).toContain('STATE=written');
    expect(masterCheckState(masterCheckPath(data), [master])).toBe('opens');
    expect(fs.statSync(masterCheckPath(data)).mode & 0o777).toBe(0o600);
    const bytes = fs.readFileSync(masterCheckPath(data), 'utf8');
    expect(await child(BOOT, { DNA_ENCRYPTION_KEY: master, NEUMA_DATA_ROOT: data })).toContain('STATE=opens');

    const swapped = await child(BOOT, { DNA_ENCRYPTION_KEY: hex(), NEUMA_DATA_ROOT: data });
    expect(swapped).toContain('STATE=foreign');
    expect(swapped).toMatch(/NOT the one this install's data was sealed under/);
    expect(fs.readFileSync(masterCheckPath(data), 'utf8')).toBe(bytes);

    // and that mark alone stops a new key being made when the secrets file is gone
    expect(() => ensureSecrets({ env: { NEUMA_DATA_ROOT: data } })).toThrow(/will not make a new key over it/);
  }, 60_000);

  test('a deleted key record is read from its copy — the same keys, never a fresh install', () => {
    const seal = aesSeal();
    const first = lock.openKeyLock({ file: secrets, seal });
    expect(first.state).toBe('unlocked');
    expect(fs.statSync(`${secrets}.bak`).mode & 0o777).toBe(0o600);
    fs.rmSync(secrets);
    const again = lock.openKeyLock({ file: secrets, seal });
    expect(again.state).toBe('unlocked');
    expect(again.keys).toEqual(first.keys);
    // saving the kit drops the code from the copy too
    lock.confirmKit({ file: secrets });
    expect(JSON.parse(fs.readFileSync(`${secrets}.bak`, 'utf8')).kit).toBeNull();
  });

  test('a chat copy whose sealed turns do not open says so, and still shows the turns that do', async () => {
    const wallet = `0x${'ab'.repeat(20)}`;
    const realm = path.join(base, 'realm');
    const master = hex();
    const file = path.join(realm, wallet, 'chats', 'being.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(encryptEnvelope({ role: 'user', content: 'lost' }, { key: crypto.randomBytes(32) }))}\n${JSON.stringify(encryptEnvelope({ role: 'user', content: 'kept' }, { key: deriveKeyFromSecret(master) }))}\n`);
    const out = await child(`
import { readChat, setRealmRoot } from './backend/services/user-realm.js';
setRealmRoot(process.env.REALM);
process.stdout.write('TURNS=' + JSON.stringify((await readChat(process.env.WALLET, 'being')).map((t) => t.content)));
`, { DNA_ENCRYPTION_KEY: master, REALM: realm, WALLET: wallet, NEUMA_DATA_ROOT: data });
    expect(out).toContain('TURNS=["kept"]');
    expect(out).toMatch(/sealed turns in this chat copy do not open/);
  }, 60_000);
});
