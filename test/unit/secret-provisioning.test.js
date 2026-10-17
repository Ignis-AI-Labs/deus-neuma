/**
 * Secret provisioning — a fresh (packaged) install self-provisions stable
 * at-rest secrets, an operator's env always wins, and subsequent runs reuse the
 * same keys. Runs against a real temp secrets file (no mocked fs).
 */

import fs from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { ensureSecrets } from '../../backend/services/secret-provisioning.js';

const HEX64 = /^[0-9a-f]{64}$/;

describe('secret-provisioning', () => {
  let file;

  beforeEach(async () => {
    const dir = await createTempDir(`secrets-${Math.random().toString(36).slice(2)}`);
    file = path.join(dir, 'secrets.json');
    process.env.NEUMA_SECRETS_FILE = file;
  });

  afterEach(() => {
    delete process.env.NEUMA_SECRETS_FILE;
  });

  test('generates both secrets on a fresh install and persists them', () => {
    const env = {};
    const r = ensureSecrets({ env });
    expect(r.generated.sort()).toEqual(['AUTH_SECRET', 'DNA_ENCRYPTION_KEY']);
    expect(env.DNA_ENCRYPTION_KEY).toMatch(HEX64);
    expect(env.AUTH_SECRET).toMatch(HEX64);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(stored.dnaEncryptionKey).toBe(env.DNA_ENCRYPTION_KEY);
    expect(stored.authSecret).toBe(env.AUTH_SECRET);
  });

  test('creates a MISSING parent dir (the ~/.neuma first-run case) and lands the secrets there', async () => {
    // The Electron shell now defaults NEUMA_SECRETS_FILE to ~/.neuma/secrets.json,
    // a dir that does not exist on a fresh machine. Prove provisioning creates it.
    const base = await createTempDir(`secrets-fresh-${Math.random().toString(36).slice(2)}`);
    const neumaHome = path.join(base, '.neuma'); // absent — mirrors ~/.neuma on first run
    const freshFile = path.join(neumaHome, 'secrets.json');
    expect(fs.existsSync(neumaHome)).toBe(false);
    process.env.NEUMA_SECRETS_FILE = freshFile;

    ensureSecrets({ env: {} });

    expect(fs.existsSync(freshFile)).toBe(true); // parent dir created + secrets written
    expect(JSON.parse(fs.readFileSync(freshFile, 'utf8')).dnaEncryptionKey).toMatch(HEX64);
  });

  test('reuses persisted secrets on subsequent runs (stable across restarts)', () => {
    const first = {};
    ensureSecrets({ env: first });
    const second = {};
    const r = ensureSecrets({ env: second });
    expect(r.generated).toEqual([]);
    expect(second.DNA_ENCRYPTION_KEY).toBe(first.DNA_ENCRYPTION_KEY);
    expect(second.AUTH_SECRET).toBe(first.AUTH_SECRET);
  });

  test('explicit env always wins and is never overwritten or persisted', () => {
    const env = { DNA_ENCRYPTION_KEY: 'operator-key', AUTH_SECRET: 'operator-secret' };
    const r = ensureSecrets({ env });
    expect(r.generated).toEqual([]);
    expect(env.DNA_ENCRYPTION_KEY).toBe('operator-key');
    expect(fs.existsSync(file)).toBe(false);
  });

  test('generates only the missing secret (partial env)', () => {
    const env = { DNA_ENCRYPTION_KEY: 'operator-key' };
    const r = ensureSecrets({ env });
    expect(r.generated).toEqual(['AUTH_SECRET']);
    expect(env.DNA_ENCRYPTION_KEY).toBe('operator-key');
    expect(env.AUTH_SECRET).toMatch(HEX64);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(stored.authSecret).toBe(env.AUTH_SECRET);
    expect(stored.dnaEncryptionKey).toBeUndefined(); // operator key stays out of the file
  });

  test('skips entirely under NODE_ENV=test', () => {
    const env = { NODE_ENV: 'test' };
    const r = ensureSecrets({ env });
    expect(r).toEqual({ generated: [], file: null });
    expect(env.DNA_ENCRYPTION_KEY).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });

  test('the secrets file is not readable by group or other', () => {
    ensureSecrets({ env: {} });
    expect(fs.statSync(file).mode & 0o077).toBe(0);
  });
});
