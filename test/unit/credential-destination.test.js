// A STORED SECRET STAYS WITH ITS DESTINATION (audit 2026-10-28 M-01). The real registries, the real
// merge and resolver — no mock. Before: changing an account's mail server, Mastodon instance or
// Bluesky PDS kept the stored password or token, so the next send handed it to the new host.
import { describe, expect, test } from 'vitest';
import { mergeChannelCredential } from '../../backend/services/social/account-shape.js';
import { getChannel, resolveChannelCredentials } from '../../backend/services/social/channel-registry.js';
import { EMAIL_ACCOUNT } from '../../backend/services/email/email-registry.js';

const mail = { address: 'me@real.example', username: 'me', password: 'mail-secret', smtpHost: 'smtp.real.example', imapHost: 'imap.real.example' };

describe('moving a destination takes no stored secret with it', () => {
  test('a mail server change drops the stored password unless the same change re-enters it', () => {
    expect(mergeChannelCredential(EMAIL_ACCOUNT, mail, { smtpHost: 'smtp.evil.example' }).password).toBeUndefined();
    expect(mergeChannelCredential(EMAIL_ACCOUNT, mail, { imapHost: 'imap.evil.example' }).password).toBeUndefined();
    expect(mergeChannelCredential(EMAIL_ACCOUNT, mail, { smtpHost: 'smtp.new.example', password: 'retyped' }).password).toBe('retyped');
    // clearing a host moves it back to the default server — a move too
    expect(mergeChannelCredential(EMAIL_ACCOUNT, mail, { smtpHost: '' }).password).toBeUndefined();
  });

  test('an edit that moves nothing keeps the secret: another field, or the same host again', () => {
    expect(mergeChannelCredential(EMAIL_ACCOUNT, mail, { address: 'other@real.example' }).password).toBe('mail-secret');
    expect(mergeChannelCredential(EMAIL_ACCOUNT, mail, { smtpHost: 'smtp.real.example' }).password).toBe('mail-secret');
    expect(mergeChannelCredential(EMAIL_ACCOUNT, mail, { smtpPort: '587' }).password).toBe('mail-secret');
  });

  test('a Mastodon instance or Bluesky PDS change drops the stored token / app password', () => {
    const mastodon = getChannel('mastodon');
    const bluesky = getChannel('bluesky');
    const toot = { instanceUrl: 'https://mastodon.social', accessToken: 'toot-secret' };
    const sky = { service: 'https://bsky.social', identifier: 'me.bsky.social', appPassword: 'sky-secret' };
    expect(mergeChannelCredential(mastodon, toot, { instanceUrl: 'https://evil.example' }).accessToken).toBeUndefined();
    expect(mergeChannelCredential(bluesky, sky, { service: 'https://evil.example' }).appPassword).toBeUndefined();
    expect(mergeChannelCredential(bluesky, sky, { identifier: 'renamed.bsky.social' }).appPassword).toBe('sky-secret');
  });
});

describe('a secret from the operator\'s .env never goes to a destination a house stored', () => {
  const env = { EMAIL_PASSWORD: 'operator-env-secret', EMAIL_ADDRESS: 'op@real.example', EMAIL_USERNAME: 'op' };
  test('a stored host with the .env password resolves to nothing', () => {
    expect(resolveChannelCredentials(EMAIL_ACCOUNT, { smtpHost: 'smtp.evil.example' }, env)).toBeNull();
  });
  test('the .env password with the default (or .env) host still resolves; a stored password with a stored host does', () => {
    expect(resolveChannelCredentials(EMAIL_ACCOUNT, {}, env)).toMatchObject({ password: 'operator-env-secret', smtpHost: 'smtp.gmail.com' });
    expect(resolveChannelCredentials(EMAIL_ACCOUNT, mail, {})).toMatchObject({ password: 'mail-secret', smtpHost: 'smtp.real.example' });
  });
});
