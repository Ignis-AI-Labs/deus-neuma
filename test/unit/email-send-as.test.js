/**
 * ONE MAILBOX, SEVERAL ADDRESSES — the send-as law, and the real message the
 * sender builds for it (nothing faked: the house's own MIME and SMTP dialogue).
 */
import { describe, test, expect } from 'vitest';
import { parseSendAs, fromFor } from '../../backend/services/email/send-as.js';
import { EMAIL_ACCOUNT } from '../../backend/services/email/email-registry.js';
import { resolveChannelCredentials } from '../../backend/services/social/channel-registry.js';

const ACCOUNT = { address: 'Orrin@IgnisLabs.ai', sendAs: 'umbrae = Sales@Umbrae.io, deus-neuma = hello@deusneuma.ai\npress@example.com; nonsense, = orphan@x.io, umbrae = sales@umbrae.io' };

describe('send as', () => {
  test('the list reads company = address, a bare address, any separator; rubbish and repeats drop', () => {
    expect(parseSendAs(ACCOUNT.sendAs)).toEqual([
      { address: 'sales@umbrae.io', company: 'umbrae' }, { address: 'hello@deusneuma.ai', company: 'deus-neuma' },
      { address: 'press@example.com', company: null }, { address: 'orphan@x.io', company: null },
    ]);
    for (const none of ['none', '', null, undefined, 'not an address']) expect(parseSendAs(none)).toEqual([]);
  });

  test('a company\'s email leaves from that company\'s address; any other from the account\'s own', () => {
    expect(fromFor(ACCOUNT, { company: 'umbrae' })).toEqual({ ok: true, from: 'sales@umbrae.io' });
    expect(fromFor(ACCOUNT, { company: 'DEUS-NEUMA' })).toEqual({ ok: true, from: 'hello@deusneuma.ai' });
    expect(fromFor(ACCOUNT, { company: 'ignis' })).toEqual({ ok: true, from: 'orrin@example.com' });
    expect(fromFor(ACCOUNT)).toEqual({ ok: true, from: 'orrin@example.com' });
    expect(fromFor({ address: 'a@b.co', sendAs: 'none' }, { company: 'umbrae' })).toEqual({ ok: true, from: 'a@b.co' });
  });

  test('an address asked for by name must be one the mailbox holds; a stranger is refused, with the list', () => {
    expect(fromFor(ACCOUNT, { from: 'press@example.com', company: 'umbrae' })).toEqual({ ok: true, from: 'press@example.com' });
    expect(fromFor(ACCOUNT, { from: 'ORRIN@example.com' })).toEqual({ ok: true, from: 'orrin@example.com' });
    expect(fromFor(ACCOUNT, { from: 'ceo@bigbank.com' })).toEqual({ ok: false, detail: 'ceo@bigbank.com is not an address this mailbox sends as — it sends as orrin@example.com, sales@umbrae.io, hello@deusneuma.ai, press@example.com, orphan@x.io' });
  });

  test('the field is optional: an account saved before it existed still resolves whole', () => {
    const field = EMAIL_ACCOUNT.fields.find((f) => f.key === 'sendAs');
    expect(field).toMatchObject({ secret: false, fallback: 'none' });
    const old = { address: 'a@b.co', username: 'a@b.co', password: 'pw' };
    expect(resolveChannelCredentials(EMAIL_ACCOUNT, old, {})).toMatchObject({ address: 'a@b.co', sendAs: 'none', smtpHost: 'smtp.gmail.com' });
    expect(resolveChannelCredentials(EMAIL_ACCOUNT, { ...old, sendAs: 'umbrae = s@umbrae.io' }, {}).sendAs).toBe('umbrae = s@umbrae.io');
  });
});
