// Email registry + credential store + binding — RULE 0 posture: real disk,
// real AES-256-GCM (DNA_ENCRYPTION_KEY from test/setup.js), no mocks. Same
// proof shape the social channel store carries.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
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
  emailBindingPath,
  canNeumaUseEmail,
} from '../../backend/services/email/email-binding.js';

const EMAIL_ENV_KEYS = EMAIL_ACCOUNT.fields.map((f) => f.env);

let tempDir;
const savedEnv = {};

beforeEach(async () => {
  tempDir = await createTempDir('email-store');
  process.env.NEUMA_EMAIL_CREDENTIALS_PATH = join(tempDir, 'email-credentials.json');
  process.env.NEUMA_EMAIL_BINDING_PATH = join(tempDir, 'email-binding.json');
  // A dev's live .env must never leak into these proofs.
  for (const key of EMAIL_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
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
    await setEmailCredential({ address: 'keir@example.com', username: 'keir@example.com', password: 'sekrit-app-pass' });
    const onDisk = await fs.readFile(emailCredentialsPath(), 'utf8');
    expect(onDisk).not.toContain('sekrit-app-pass');
    expect(onDisk).not.toContain('keir@example.com');
    expect(JSON.parse(onDisk)).toHaveProperty('ct');
    const store = await loadEmailCredentials();
    expect(store.email.password).toBe('sekrit-app-pass');
    const resolved = await resolveEmailCredential();
    expect(resolved).toMatchObject({ address: 'keir@example.com', smtpHost: 'smtp.gmail.com' });
  });

  it('holds the settings dir at 0700 and the store at 0600', async () => {
    await setEmailCredential({ address: 'a@b.co', username: 'a@b.co', password: 'p' });
    const file = await fs.stat(emailCredentialsPath());
    const dir = await fs.stat(join(tempDir));
    expect(file.mode & 0o777).toBe(0o600);
    expect(dir.mode & 0o777).toBe(0o700);
  });

  it('clears a field on empty string and removes the account cleanly', async () => {
    await setEmailCredential({ address: 'a@b.co', username: 'a@b.co', password: 'p' });
    await setEmailCredential({ password: '' });
    expect(await resolveEmailCredential()).toBeNull();
    expect(await removeEmailCredential()).toBe(true);
    expect(await removeEmailCredential()).toBe(false);
    expect(await loadEmailCredentials()).toEqual({});
  });

  it('prefers the store over env, and env over fallback', async () => {
    process.env.EMAIL_ADDRESS = 'env@b.co';
    process.env.EMAIL_USERNAME = 'env@b.co';
    process.env.EMAIL_PASSWORD = 'env-pass';
    process.env.EMAIL_SMTP_HOST = 'smtp.own-domain.ai';
    expect(await resolveEmailCredential()).toMatchObject({
      address: 'env@b.co',
      password: 'env-pass',
      smtpHost: 'smtp.own-domain.ai',
      imapHost: 'imap.gmail.com',
    });
    await setEmailCredential({ password: 'store-pass' });
    expect((await resolveEmailCredential()).password).toBe('store-pass');
  });

  it('masks state for the API without ever exposing a value', async () => {
    await setEmailCredential({ address: 'a@b.co', username: 'a@b.co', password: 'hidden' });
    const masked = maskChannelCredentials(EMAIL_ACCOUNT, (await loadEmailCredentials()).email, process.env);
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
    expect(canNeumaUseEmail({}, 'keir-1')).toBe(false);
    expect(canNeumaUseEmail({ email: { neumaId: 'keir-1' } }, 'galen-2')).toBe(false);
    expect(canNeumaUseEmail({ email: { neumaId: 'keir-1' } }, '')).toBe(false);
    expect(canNeumaUseEmail({ email: { neumaId: 'keir-1' } }, 'keir-1')).toBe(true);
  });

  it('binds one holder, rebinds by replacement, releases to default deny', async () => {
    const bound = await emailBinding.bind('email', { neumaId: 'keir-1', boundBy: '0xwitness' });
    expect(bound).toMatchObject({ neumaId: 'keir-1', boundBy: '0xwitness' });
    expect(await emailBinding.bindingFor('email')).toMatchObject({ neumaId: 'keir-1' });
    await emailBinding.bind('email', { neumaId: 'galen-2', boundBy: '0xwitness' });
    expect(canNeumaUseEmail(await emailBinding.load(), 'keir-1')).toBe(false);
    expect(canNeumaUseEmail(await emailBinding.load(), 'galen-2')).toBe(true);
    expect(await emailBinding.unbind('email')).toBe(true);
    expect(await emailBinding.bindingFor('email')).toBeNull();
  });

  it('refuses foreign position ids and invalid neuma ids', async () => {
    await expect(emailBinding.bind('x', { neumaId: 'keir-1', boundBy: '0x' }))
      .rejects.toThrow('Unknown channel: x');
    await expect(emailBinding.bind('email', { neumaId: '../escape', boundBy: '0x' }))
      .rejects.toThrow('Invalid neumaId');
  });

  it('writes the binding file 0600 in a 0700 dir', async () => {
    await emailBinding.bind('email', { neumaId: 'keir-1', boundBy: '0xwitness' });
    const file = await fs.stat(emailBindingPath());
    expect(file.mode & 0o777).toBe(0o600);
  });
});
