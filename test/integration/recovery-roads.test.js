/**
 * The ways back, on real files with real crypto:
 *   - the recovery file (scripts/master-recovery-file.mjs, the real CLI as its
 *     own process): the master's copy off the machine, sealed under a passphrase;
 *   - a lane reader opens a record sealed under a key the being held before a re-key;
 *   - the packaged desk makes no new key when its record is gone and data is there.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { deriveKeyFromSecret, encryptEnvelope, resetWorkspaceCryptoKey, wrapDEK } from '../../core/workspace/workspace-crypto.js';
import { retiredDeksPath } from '../../core/workspace/retired-deks.js';
import { masterCheckPath, writeMasterCheck } from '../../core/workspace/master-check.js';
import { readRetiredMasters, retireMasters, retiredMastersPath } from '../../core/workspace/retired-masters.js';

const require = createRequire(import.meta.url);
const lock = require('../../electron/key-lock/key-lock.cjs');
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO, 'scripts', 'master-recovery-file.mjs');
const hex = () => crypto.randomBytes(32).toString('hex');
const PASS = 'a passphrase of my own choosing';

describe('recovery roads', () => {
  let base; let data; let envFile;
  const cli = (args, typed) => spawnSync('node', [CLI, ...args], {
    input: typed.map((line) => `${line}\n`).join(''), encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NEUMA_REKEY_ENV_FILE: envFile, NEUMA_DATA_ROOT: data },
  });
  const envKey = () => fs.readFileSync(envFile, 'utf8').match(/^DNA_ENCRYPTION_KEY=(.*)$/m)?.[1];

  beforeEach(async () => {
    base = await createTempDir(`roads-${Math.random().toString(36).slice(2)}`);
    data = path.join(base, 'data');
    envFile = path.join(base, '.env');
  });

  test('the recovery file: made under a passphrase, checked, and the way a lost key comes back', () => {
    const master = hex();
    const older = hex();
    fs.writeFileSync(envFile, `PORT=3333\nDNA_ENCRYPTION_KEY=${master}\nOTHER=kept\n`);
    retireMasters(retiredMastersPath(data), [older], master);
    writeMasterCheck(masterCheckPath(data), master);
    const file = path.join(base, 'usb-stick', 'neuma-recovery.json');

    expect(cli(['make', file], ['short', 'short']).stderr).toMatch(/shorter than 12/);
    expect(cli(['make', file], [PASS, `${PASS} `]).stderr).toMatch(/not the same/);
    expect(fs.existsSync(file)).toBe(false);
    const made = cli(['make', file], [PASS, PASS]);
    expect(made.status).toBe(0);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // no key and no passphrase anywhere: not in the file, not in what the command says
    for (const text of [fs.readFileSync(file, 'utf8'), made.stdout, made.stderr]) {
      for (const secret of [master, older, PASS]) expect(text).not.toContain(secret);
    }
    expect(cli(['make', file], [PASS, PASS]).stderr).toMatch(/never written over/);

    expect(cli(['check', file], ['the wrong passphrase']).stdout).toMatch(/does not open/);
    expect(cli(['check', file], [PASS]).stdout).toMatch(/holds the key this install runs on now/);

    // the key is lost from the env file: restore puts it back, with the retired ones behind it
    fs.writeFileSync(envFile, 'PORT=3333\nOTHER=kept\n');
    fs.rmSync(retiredMastersPath(data));
    expect(cli(['restore', file], ['the wrong passphrase']).stderr).toMatch(/nothing was changed/);
    expect(envKey()).toBeUndefined();
    const restored = cli(['restore', file], [PASS]);
    expect(restored.status).toBe(0);
    expect(restored.stdout).not.toContain(master);
    expect(envKey()).toBe(master);
    expect(fs.readFileSync(envFile, 'utf8')).toMatch(/OTHER=kept/);
    expect(readRetiredMasters(retiredMastersPath(data), [master])).toEqual([older]);

    // a different key standing in the env file is replaced only when the install's own check says it is wrong
    const wrong = hex();
    fs.writeFileSync(envFile, `DNA_ENCRYPTION_KEY=${wrong}\n`);
    expect(cli(['restore', file], [PASS]).status).toBe(0);
    expect(envKey()).toBe(master);
    fs.rmSync(masterCheckPath(data));
    fs.writeFileSync(envFile, `DNA_ENCRYPTION_KEY=${wrong}\n`);
    expect(cli(['restore', file], [PASS]).stderr).toMatch(/nothing here shows it is the wrong one/);
    expect(envKey()).toBe(wrong);
  }, 180_000);

  test('a lane reader opens a record sealed under a key the being held before a re-key', async () => {
    const savedRoot = workspace.root;
    const savedKey = process.env.DNA_ENCRYPTION_KEY;
    const master = hex();
    process.env.DNA_ENCRYPTION_KEY = master;
    resetWorkspaceCryptoKey();
    workspace.root = path.join(base, 'lanes');
    try {
      const lane = 'aaaa1111';
      await workspace.writeNeumaDEK(lane, 'ab'.repeat(32));
      const dir = path.join(workspace.root, lane);
      const oldDek = crypto.randomBytes(32);
      const record = path.join(dir, 'memory', 'restored-from-an-old-backup.json');
      const journal = path.join(dir, 'journal', 'entries.jsonl');
      fs.mkdirSync(path.dirname(record), { recursive: true });
      fs.mkdirSync(path.dirname(journal), { recursive: true });
      fs.writeFileSync(record, JSON.stringify(encryptEnvelope({ said: 'before the re-key' }, { key: oldDek })));
      fs.writeFileSync(journal, `${JSON.stringify(encryptEnvelope({ j: 1 }, { key: oldDek }))}\n`);

      await expect(workspace._readJSON(record)).rejects.toThrow();
      fs.writeFileSync(retiredDeksPath(dir), JSON.stringify({ deks: [wrapDEK(oldDek, deriveKeyFromSecret(master))] }));
      expect(await workspace._readJSON(record)).toEqual({ said: 'before the re-key' });
      expect(await workspace._readJSONL(journal, { strict: true })).toEqual([{ j: 1 }]);
    } finally {
      workspace.root = savedRoot;
      if (savedKey === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = savedKey;
      resetWorkspaceCryptoKey();
    }
  });

  test('the packaged desk makes no new key when its record is gone and sealed data is there', () => {
    const file = path.join(base, 'home', 'secrets.json');
    const seal = { backend: () => 'gnome_libsecret', encrypt: (t) => Buffer.from(t), decrypt: (b) => b.toString('utf8') };
    expect(lock.openKeyLock({ file, seal, holdsData: () => true })).toEqual({ state: 'key-missing', backend: 'gnome_libsecret' });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
  });
});
