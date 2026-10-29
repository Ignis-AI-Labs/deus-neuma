// Email registry + credential store + binding — RULE 0 posture: real disk,
// real AES-256-GCM (DNA_ENCRYPTION_KEY from test/setup.js), no mocks. Same
// proof shape the social channel store carries.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { EMAIL_ACCOUNT, getEmailAccount } from '../../backend/services/email/email-registry.js';
import {
  resolveChannelCredentials,
  maskChannelCredentials,
} from '../../backend/services/social/channel-registry.js';
import {
  emailCredentialsPath,
  loadEmailCredentials,
  setEmailCredential,
  removeEmailCredential,
  resolveEmailCredential,
} from '../../backend/services/email/email-credentials.js';
import {
  emailBinding,
  canNeumaUseEmail,
} from '../../backend/services/email/email-binding.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const EMAIL_ENV_KEYS = EMAIL_ACCOUNT.fields.map((f) => f.env);

// The mailbox is a house's own (house-positions.js): one test house, its
// realm on temp disk.
const HOUSE = `0x${'2'.repeat(40)}`;
let tempDir;
let priorRealm;
const savedEnv = {};

beforeEach(async () => {
  tempDir = await createTempDir('email-store');
  process.env.NEUMA_EMAIL_CREDENTIALS_PATH = join(tempDir, 'email-credentials.json');
  process.env.NEUMA_EMAIL_BINDING_PATH = join(tempDir, 'email-binding.json');
  priorRealm = getRealmRoot();
  setRealmRoot(join(tempDir, 'realm'));
  // A dev's live .env must never leak into these proofs.
  for (const key of EMAIL_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  setRealmRoot(priorRealm);
  delete process.env.NEUMA_EMAIL_CREDENTIALS_PATH;
  delete process.env.NEUMA_EMAIL_BINDING_PATH;
  for (const key of EMAIL_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('email registry', () => {
  it('declares the one account with Gmail fallbacks on every host field', () => {
    expect(getEmailAccount('email')).toBe(EMAIL_ACCOUNT);
    expect(getEmailAccount('x')).toBeNull();
    const byKey = Object.fromEntries(EMAIL_ACCOUNT.fields.map((f) => [f.key, f]));
    expect(byKey.smtpHost.fallback).toBe('smtp.gmail.com');
    expect(byKey.smtpPort.fallback).toBe('465');
    expect(byKey.imapHost.fallback).toBe('imap.gmail.com');
    expect(byKey.imapPort.fallback).toBe('993');
    expect(byKey.password.secret).toBe(true);
  });

  it('resolves with just address + username + password (fallback hosts)', () => {
    const entry = { address: 'a@b.co', username: 'a@b.co', password: 'app-pass' };
    const resolved = resolveChannelCredentials(EMAIL_ACCOUNT, entry, {});
    expect(resolved).toMatchObject({ smtpHost: 'smtp.gmail.com', imapPort: '993' });
    expect(resolveChannelCredentials(EMAIL_ACCOUNT, { address: 'a@b.co' }, {})).toBeNull();
  });
});

describe('email credential store', () => {
  it('persists encrypted, restores, and never writes plaintext to disk', async () => {
    await setEmailCredential(HOUSE, { address: 'hazel@example.com', username: 'hazel@example.com', password: 'sekrit-app-pass' });
    const onDisk = await fs.readFile(emailCredentialsPath(HOUSE), 'utf8');
    expect(onDisk).not.toContain('sekrit-app-pass');
    expect(onDisk).not.toContain('hazel@example.com');
    expect(JSON.parse(onDisk)).toHaveProperty('ct');
    const store = await loadEmailCredentials(HOUSE);
    expect(store.email.password).toBe('sekrit-app-pass');
    const resolved = await resolveEmailCredential(HOUSE);
    expect(resolved).toMatchObject({ address: 'hazel@example.com', smtpHost: 'smtp.gmail.com' });
  });

  it('holds the settings dir at 0700 and the store at 0600', async () => {
    await setEmailCredential(HOUSE, { address: 'a@b.co', username: 'a@b.co', password: 'p' });
    const file = await fs.stat(emailCredentialsPath(HOUSE));
    const dir = await fs.stat(dirname(emailCredentialsPath(HOUSE)));
    expect(file.mode & 0o777).toBe(0o600);
    expect(dir.mode & 0o777).toBe(0o700);
  });

  it('clears a field on empty string and removes the account cleanly', async () => {
    await setEmailCredential(HOUSE, { address: 'a@b.co', username: 'a@b.co', password: 'p' });
    await setEmailCredential(HOUSE, { password: '' });
    expect(await resolveEmailCredential(HOUSE)).toBeNull();
    expect(await removeEmailCredential(HOUSE)).toBe(true);
    expect(await removeEmailCredential(HOUSE)).toBe(false);
    expect(await loadEmailCredentials(HOUSE)).toEqual({});
  });

  it('prefers the store over env, and env over fallback', async () => {
    process.env.EMAIL_ADDRESS = 'env@b.co';
    process.env.EMAIL_USERNAME = 'env@b.co';
    process.env.EMAIL_PASSWORD = 'env-pass';
    process.env.EMAIL_SMTP_HOST = 'smtp.own-domain.ai';
    // the machine's .env channel keys serve its install owner's house only (re-audit 2026-10-29, NEW-M3)
    await makeInstallOwner(HOUSE);
    expect(await resolveEmailCredential(HOUSE)).toMatchObject({
      address: 'env@b.co',
      password: 'env-pass',
      smtpHost: 'smtp.own-domain.ai',
      imapHost: 'imap.gmail.com',
    });
    await setEmailCredential(HOUSE, { password: 'store-pass' });
    expect((await resolveEmailCredential(HOUSE)).password).toBe('store-pass');
  });

  it('masks state for the API without ever exposing a value', async () => {
    await setEmailCredential(HOUSE, { address: 'a@b.co', username: 'a@b.co', password: 'hidden' });
    const masked = maskChannelCredentials(EMAIL_ACCOUNT, (await loadEmailCredentials(HOUSE)).email, process.env);
    expect(masked.configured).toBe(true);
    expect(JSON.stringify(masked)).not.toContain('hidden');
    const password = masked.fields.find((f) => f.key === 'password');
    expect(password).toMatchObject({ secret: true, set: true, source: 'store' });
    const smtpHost = masked.fields.find((f) => f.key === 'smtpHost');
    expect(smtpHost.source).toBe('default');
  });
});

describe('email binding', () => {
  it('defaults to deny: no binding, wrong neuma, or empty id never pass', async () => {
    expect(canNeumaUseEmail({}, 'hazel-1')).toBe(false);
    expect(canNeumaUseEmail({ email: { neumaId: 'hazel-1' } }, 'cedar-2')).toBe(false);
    expect(canNeumaUseEmail({ email: { neumaId: 'hazel-1' } }, '')).toBe(false);
    expect(canNeumaUseEmail({ email: { neumaId: 'hazel-1' } }, 'hazel-1')).toBe(true);
  });

  it('binds one holder, rebinds by replacement, releases to default deny', async () => {
    const bound = await emailBinding.bind(HOUSE, 'email', { neumaId: 'hazel-1' });
    expect(bound).toMatchObject({ neumaId: 'hazel-1', boundBy: HOUSE });
    expect(await emailBinding.bindingFor(HOUSE, 'email')).toMatchObject({ neumaId: 'hazel-1' });
    await emailBinding.bind(HOUSE, 'email', { neumaId: 'cedar-2' });
    expect(canNeumaUseEmail(await emailBinding.load(HOUSE), 'hazel-1')).toBe(false);
    expect(canNeumaUseEmail(await emailBinding.load(HOUSE), 'cedar-2')).toBe(true);
    expect(await emailBinding.unbind(HOUSE, 'email')).toBe(true);
    expect(await emailBinding.bindingFor(HOUSE, 'email')).toBeNull();
  });

  it('refuses foreign position ids, invalid neuma ids, and a caller with no house', async () => {
    await expect(emailBinding.bind(HOUSE, 'x', { neumaId: 'hazel-1' }))
      .rejects.toThrow('Unknown channel: x');
    await expect(emailBinding.bind(HOUSE, 'email', { neumaId: '../escape' }))
      .rejects.toThrow('Invalid neumaId');
    expect(() => emailBinding.bind('0xwitness', 'email', { neumaId: 'hazel-1' })).toThrow('house');
  });

  it('writes the binding file 0600 in the house\'s realm dir', async () => {
    await emailBinding.bind(HOUSE, 'email', { neumaId: 'hazel-1' });
    const file = await fs.stat(join(getRealmRoot(), HOUSE, 'email-binding.json'));
    expect(file.mode & 0o777).toBe(0o600);
  });
});
