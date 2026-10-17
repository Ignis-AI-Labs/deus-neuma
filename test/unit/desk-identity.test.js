// desk-identity: real files on a real tmp data root, real keys, real
// certificate parse on reload. The fingerprint is the phone's pin — it must
// be byte-stable across restarts, and 0600 is the law.
import fs from 'fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureDeskIdentity, base32, deskIdFromFingerprint } from '../../backend/services/remote/desk-identity.js';

let root;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-desk-id-'));
  process.env.NEUMA_DATA_ROOT = root;
});

afterAll(async () => {
  delete process.env.NEUMA_DATA_ROOT;
  await fs.rm(root, { recursive: true, force: true });
});

describe('ensureDeskIdentity', () => {
  it('generates the pair on first enable, 0600, and the cert parses', async () => {
    const identity = await ensureDeskIdentity();
    const cert = new crypto.X509Certificate(identity.certPem);
    expect(cert.subject).toContain('Neuma Desk');
    const keyFile = path.join(root, 'settings', 'remote-tunnel', 'desk-key.pem');
    const certFile = path.join(root, 'settings', 'remote-tunnel', 'desk-cert.pem');
    const [keyMode, certMode] = await Promise.all([
      fs.stat(keyFile).then((s) => s.mode & 0o777),
      fs.stat(certFile).then((s) => s.mode & 0o777),
    ]);
    expect(keyMode).toBe(0o600);
    expect(certMode).toBe(0o600);
    // The fingerprint is the SPKI hash of the key the file holds.
    const spki = crypto.createPublicKey(crypto.createPrivateKey(await fs.readFile(keyFile, 'utf8')))
      .export({ type: 'spki', format: 'der' });
    expect(identity.fingerprint).toBe(crypto.createHash('sha256').update(spki).digest('hex'));
  });

  it('reloads the SAME identity — the phone pinned that fingerprint', async () => {
    const first = await ensureDeskIdentity();
    const second = await ensureDeskIdentity();
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.deskId).toBe(first.deskId);
    expect(second.certPem).toBe(first.certPem);
  });

  it('desk ids are 16 lowercase base32 characters', () => {
    expect(base32(Buffer.from([0, 1, 2, 250, 254, 255]))).toMatch(/^[a-z2-7]+$/);
    expect(base32(Buffer.alloc(0))).toBe('');
    expect(deskIdFromFingerprint('ab'.repeat(32))).toMatch(/^[a-z2-7]{16}$/);
  });
});
