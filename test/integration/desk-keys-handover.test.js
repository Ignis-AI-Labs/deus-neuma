/**
 * The desk hands the at-rest keys to a real backend-shaped child over a real
 * IPC channel (child_process.fork), never its environment: the child asks, gets
 * the keys into its own env, puts the Recovery Kit on the owner's waiting
 * account, and drops it when the desk says the kit is saved. Provisioning
 * refuses to mint a key over a locked record.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { ensureSecrets } from '../../backend/services/secret-provisioning.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, '..', 'helpers', 'desk-keys-child.mjs');

const keys = () => ({ dnaEncryptionKey: crypto.randomBytes(32).toString('hex'), authSecret: crypto.randomBytes(32).toString('hex') });

describe('desk keys handover', () => {
  test('the child asks once, gets the keys, and its spawn env never held them', async () => {
    const sent = keys();
    const child = fork(CHILD, [], { env: { ...process.env, NEUMA_KEYS_VIA_IPC: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const reports = [];
    let requests = 0;
    const done = new Promise((resolve, reject) => {
      child.on('message', (m) => {
        if (m?.type === 'neuma:at-rest-keys?') {
          requests += 1;
          child.send({ type: 'neuma:at-rest-keys', keys: sent, backend: 'gnome_libsecret', kitPending: true });
        } else if (m?.type === 'report') {
          reports.push(m);
          if (reports.length === 1) child.send({ type: 'neuma:kit-saved' });
          if (reports.length === 2) resolve();
        }
      });
      child.on('exit', (code) => (code ? reject(new Error(`child exited ${code}`)) : null));
    });
    await done;
    child.kill();
    expect(requests).toBe(1);
    const [first, second] = reports;
    expect(first.env).toEqual({ DNA_ENCRYPTION_KEY: sent.dnaEncryptionKey, AUTH_SECRET: sent.authSecret, NEUMA_KEYS_VIA_IPC: null });
    expect(first.spawnEnvHeldKey).toBe(false);
    expect(first.state).toMatchObject({ source: 'keychain', backend: 'gnome_libsecret', kitPending: true });
    expect(first.waiting.map((i) => i.id)).toEqual(['key-lock:recovery-kit']);
    expect(first.waiting[0].where).toEqual({ app: 'settings', focus: 'security' });
    expect(second.state.kitPending).toBe(false);
    expect(second.waiting).toEqual([]);
  }, 30_000);

  test('provisioning never mints a key over a keychain-locked record', async () => {
    const file = path.join(await createTempDir(`locked-${Math.random().toString(36).slice(2)}`), 'secrets.json');
    const locked = JSON.stringify({ v: 2, device: { backend: 'gnome_libsecret', blob: 'AA==' }, recovery: { kdf: 'scrypt' }, kit: null });
    fs.writeFileSync(file, locked);
    process.env.NEUMA_SECRETS_FILE = file;
    try {
      expect(() => ensureSecrets({ env: {} })).toThrow(/locked by the desk's keychain/);
      expect(fs.readFileSync(file, 'utf8')).toBe(locked);
    } finally {
      delete process.env.NEUMA_SECRETS_FILE;
    }
  });
});
