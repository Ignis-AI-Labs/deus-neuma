/**
 * Re-key a house end to end — the real CLI (scripts/rekey-house.mjs) as its
 * own process over a synthetic house built with the real crypto: a lane on a
 * derived key (the old law) with a stale first-migration backup and a legacy
 * master-sealed file, a harness lane on the master, an install credential
 * store, and DNA vault records under the being's key and under the master.
 * The dry run changes nothing; --apply leaves every being on a fresh random key,
 * every master-sealed file under a new master, the same words inside, and the
 * old master opening nothing.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  decryptEnvelope, deriveKeyFromSecret, deriveNeumaDEK, encryptEnvelope, unwrapDEK, wrapDEK,
} from '../../core/workspace/workspace-crypto.js';
import { decryptVaultData, encryptVaultData } from '../../core/identity/dna-vault-crypto.js';

const run = promisify(execFile);
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'rekey-house.mjs');
const OLD = crypto.randomBytes(32).toString('hex');
const GENESIS = 'ab'.repeat(32);

const put = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const envOf = async (file) => Object.fromEntries((await fs.readFile(file, 'utf8')).split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const opens = (env, key) => { try { decryptEnvelope(env, { key }); return true; } catch { return false; } };

describe('rekey-house', () => {
  let base; let lane; let harness; let settings; let vault; let envFile; let cliEnv;
  const master = deriveKeyFromSecret(OLD);
  const oldDek = deriveNeumaDEK(master, GENESIS);

  beforeEach(async () => {
    base = await createTempDir(`rekey-${Math.random().toString(36).slice(2)}`);
    const house = path.join(base, 'house', 'workspaces');
    lane = path.join(house, 'aaaa1111');
    harness = path.join(base, 'house', 'harness', 'harness-one');
    settings = path.join(base, 'data', 'settings');
    vault = path.join(base, 'vault', 'dna');
    envFile = path.join(base, '.env');
    await put(path.join(lane, 'keys', 'dek.json'), JSON.stringify(wrapDEK(oldDek, master)));
    await put(path.join(lane, 'dna', 'active.json'), encryptEnvelope({ name: 'Aster' }, { key: oldDek }));
    await put(path.join(lane, 'dna', 'active.json.pre-dek.bak'), encryptEnvelope({ name: 'Aster' }, { key: master }));
    await put(path.join(lane, 'sessions', 's1.jsonl'), `${JSON.stringify(encryptEnvelope({ t: 1 }, { key: oldDek }))}\n${JSON.stringify(encryptEnvelope({ t: 2 }, { key: master }))}\n`);
    await put(path.join(lane, 'identity', 'genesis-seal.json'), { genesisHash: GENESIS });
    await put(path.join(harness, 'notes.json'), encryptEnvelope({ h: 1 }, { key: master }));
    await put(path.join(settings, 'provider-credentials.json'), encryptEnvelope({ openai: 'sk-test' }, { key: master }));
    await put(path.join(vault, 'active', 'aaaa1111.dna'), await encryptVaultData(null, { dna: 'own' }, { dek: oldDek }));
    await put(path.join(vault, 'active', 'legacy0000.dna'), await encryptVaultData(OLD, { dna: 'master' }));
    await put(envFile, `PORT=3333\nDNA_ENCRYPTION_KEY=${OLD}\nOTHER=kept\n`);
    cliEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NEUMA_REKEY_ENV_FILE: envFile, WORKSPACES_ROOT: house, NEUMA_DATA_ROOT: path.join(base, 'data'), NEUMA_VAULT_ROOT: path.join(base, 'vault') };
  });

  test('the dry run changes nothing and says what would move', async () => {
    const before = await fs.readFile(path.join(lane, 'dna', 'active.json'), 'utf8');
    // What the first real dry runs met: a sandbox overlay file this user cannot read, a closed folder,
    // and a backups folder (copies, named — never asked for as a house).
    const shadow = path.join(lane, 'coding', 'sandboxes', 'c5', 'upper', 'etc', 'gshadow');
    await put(shadow, '{"root":"x"}');
    await fs.chmod(shadow, 0o000);
    const closed = path.join(lane, 'closed');
    await fs.mkdir(closed);
    await fs.chmod(closed, 0o000);
    const backups = path.join(base, 'other', 'neuma-backups');
    await put(path.join(backups, '2026-10-01', 'manifest.json'), { id: '2026-10-01' });
    await put(path.join(backups, '2026-10-01', 'aaaa1111', 'notes.json'), encryptEnvelope({ b: 1 }, { key: master }));
    const { stdout } = await run('node', [CLI], { env: cliEnv }).finally(() => fs.chmod(closed, 0o700));
    expect(stdout).toMatch(/1 folder\(s\) this user cannot open were passed over/);
    expect(stdout).toContain(`backups (copies, not re-keyed`);
    expect(stdout).not.toContain(`--root ${backups}`);
    expect(stdout).toMatch(/DRY RUN/);
    expect(stdout).toMatch(/beings with their own key: 1 · lanes on the master: 1/);
    expect(stdout).not.toContain(OLD);
    expect(await fs.readFile(path.join(lane, 'dna', 'active.json'), 'utf8')).toBe(before);
    expect((await envOf(envFile)).DNA_ENCRYPTION_KEY).toBe(OLD);
  }, 60_000);

  test('a big non-record file is passed over, and a house left out of the run stops --apply', async () => {
    await put(path.join(lane, 'art', 'film.bin'), Buffer.alloc(1024 * 1024, 7).toString('latin1'));
    const other = path.join(base, 'other', 'home2');
    await put(path.join(other, 'bbbb2222', 'keys', 'dek.json'), JSON.stringify(wrapDEK(crypto.randomBytes(32), master)));
    const { stdout } = await run('node', [CLI], { env: cliEnv });
    expect(stdout).toContain(`--root ${other}`);
    const refused = await run('node', [CLI, '--apply'], { env: cliEnv }).then(() => null, (err) => err);
    expect(refused.code).toBe(2);
    expect((await envOf(envFile)).DNA_ENCRYPTION_KEY).toBe(OLD);
    const { stdout: done } = await run('node', [CLI, '--apply', '--root', other], { env: cliEnv });
    expect(done).toMatch(/DONE/);
    const fresh = deriveKeyFromSecret((await envOf(envFile)).DNA_ENCRYPTION_KEY);
    expect(unwrapDEK(await read(path.join(other, 'bbbb2222', 'keys', 'dek.json')), { key: fresh })).toHaveLength(32);
  }, 120_000);

  test('--apply leaves the old master opening nothing and every word where it was', async () => {
    // What the real dry run found: records sealed by some other key (a test's) — a journal whose first
    // line no key here opens, and a whole file. They stay byte-for-byte; every readable line still moves.
    const foreign = crypto.randomBytes(32);
    const foreignLine = JSON.stringify(encryptEnvelope({ j: 0 }, { key: foreign }));
    await put(path.join(lane, 'journal', 'entries.jsonl'), `${foreignLine}\n${JSON.stringify(encryptEnvelope({ j: 1 }, { key: oldDek }))}\n`);
    const foreignFile = JSON.stringify(encryptEnvelope({ f: 1 }, { key: foreign }));
    await put(path.join(lane, 'memory', 'foreign.json'), foreignFile);
    const { stdout } = await run('node', [CLI, '--apply'], { env: cliEnv });
    expect(stdout).toMatch(/DONE/);
    expect(stdout).not.toContain(OLD);
    const env = await envOf(envFile);
    expect(env.DNA_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(env.DNA_ENCRYPTION_KEY).not.toBe(OLD);
    expect(env.DNA_ENCRYPTION_KEY_PREVIOUS).toBeUndefined();
    expect(env.OTHER).toBe('kept');
    const fresh = deriveKeyFromSecret(env.DNA_ENCRYPTION_KEY);

    const newDek = unwrapDEK(await read(path.join(lane, 'keys', 'dek.json')), { key: fresh });
    expect(newDek.equals(oldDek)).toBe(false);
    expect(newDek.equals(deriveNeumaDEK(fresh, GENESIS))).toBe(false);
    const dna = await read(path.join(lane, 'dna', 'active.json'));
    expect(decryptEnvelope(dna, { key: newDek })).toEqual({ name: 'Aster' });
    expect(opens(dna, oldDek) || opens(dna, master)).toBe(false);
    const lines = (await fs.readFile(path.join(lane, 'sessions', 's1.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => decryptEnvelope(l, { key: newDek }))).toEqual([{ t: 1 }, { t: 2 }]);
    await expect(fs.access(path.join(lane, 'dna', 'active.json.pre-dek.bak'))).rejects.toThrow();
    await expect(fs.access(path.join(lane, 'keys', 'dek-next.json'))).rejects.toThrow();

    expect(decryptEnvelope(await read(path.join(harness, 'notes.json')), { key: fresh })).toEqual({ h: 1 });
    const creds = await read(path.join(settings, 'provider-credentials.json'));
    expect(decryptEnvelope(creds, { key: fresh })).toEqual({ openai: 'sk-test' });
    expect(opens(creds, master)).toBe(false);

    expect(await decryptVaultData(null, await read(path.join(vault, 'active', 'aaaa1111.dna')), { dek: newDek })).toEqual({ dna: 'own' });
    expect(await decryptVaultData(env.DNA_ENCRYPTION_KEY, await read(path.join(vault, 'active', 'legacy0000.dna')))).toEqual({ dna: 'master' });
    await expect(decryptVaultData(OLD, await read(path.join(vault, 'active', 'legacy0000.dna')))).rejects.toThrow();

    const journal = (await fs.readFile(path.join(lane, 'journal', 'entries.jsonl'), 'utf8')).split('\n').filter(Boolean);
    expect(journal[0]).toBe(foreignLine);
    expect(decryptEnvelope(JSON.parse(journal[1]), { key: newDek })).toEqual({ j: 1 });
    expect(await fs.readFile(path.join(lane, 'memory', 'foreign.json'), 'utf8')).toBe(foreignFile);
    const audit = await fs.readFile(path.join(lane, 'audit', 'audit.jsonl'), 'utf8');
    expect(audit).toMatch(/KEY_REKEYED/);
  }, 120_000);
});
