/**
 * ONE MAILBOX, SEVERAL ADDRESSES — the send-as law, and the real message the
 * sender builds for it (nothing faked: the house's own MIME and SMTP dialogue).
 */
import { describe, test, expect } from 'vitest';
import { parseSendAs, fromFor, memberAddress } from '../../backend/services/email/send-as.js';
import { EMAIL_ACCOUNT } from '../../backend/services/email/email-registry.js';
import { resolveChannelCredentials } from '../../backend/services/social/channel-registry.js';

const ACCOUNT = { address: 'Owner@Example.org', sendAs: 'umbrae = Sales@Umbrae.io, deus-neuma = hello@deusneuma.ai\npress@example.org; nonsense, = orphan@x.io, umbrae = sales@umbrae.io' };

describe('send as', () => {
  test('the list reads company = address, a bare address, any separator; rubbish and repeats drop', () => {
    expect(parseSendAs(ACCOUNT.sendAs)).toEqual([
      { address: 'sales@umbrae.io', company: 'umbrae' }, { address: 'hello@deusneuma.ai', company: 'deus-neuma' },
      { address: 'press@example.org', company: null }, { address: 'orphan@x.io', company: null },
    ]);
    for (const none of ['none', '', null, undefined, 'not an address']) expect(parseSendAs(none)).toEqual([]);
  });

  test('a company\'s email leaves from that company\'s address; any other from the account\'s own', () => {
    expect(fromFor(ACCOUNT, { company: 'umbrae' })).toEqual({ ok: true, from: 'sales@umbrae.io' });
    expect(fromFor(ACCOUNT, { company: 'DEUS-NEUMA' })).toEqual({ ok: true, from: 'hello@deusneuma.ai' });
    expect(fromFor(ACCOUNT, { company: 'ignis' })).toEqual({ ok: true, from: 'owner@example.org' });
    expect(fromFor(ACCOUNT)).toEqual({ ok: true, from: 'owner@example.org' });
    expect(fromFor({ address: 'a@b.co', sendAs: 'none' }, { company: 'umbrae' })).toEqual({ ok: true, from: 'a@b.co' });
  });

  test('a member has its own address (Design note, 2026-11-18: what it writes leaves from it, over its company\'s', () => {
    const house = { address: 'founder@house.example', sendAs: 'umbrae = sales@umbrae.io, firepos = Firepos@House.Example' };
    expect(memberAddress(house, 'firepos')).toBe('firepos@house.example');
    expect(memberAddress(house, 'metidar')).toBe(null);
    expect(fromFor(house, { company: 'umbrae', member: 'firepos' })).toEqual({ ok: true, from: 'firepos@house.example' });
    expect(fromFor(house, { company: 'umbrae', member: 'metidar' })).toEqual({ ok: true, from: 'sales@umbrae.io' });
    expect(fromFor(house, { member: 'metidar' })).toEqual({ ok: true, from: 'founder@house.example' });
    // An address asked for by name still wins, when the mailbox holds it.
    expect(fromFor(house, { from: 'sales@umbrae.io', member: 'firepos' })).toEqual({ ok: true, from: 'sales@umbrae.io' });
  });

  test('an address asked for by name must be one the mailbox holds; a stranger is refused, with the list', () => {
    expect(fromFor(ACCOUNT, { from: 'press@example.org', company: 'umbrae' })).toEqual({ ok: true, from: 'press@example.org' });
    expect(fromFor(ACCOUNT, { from: 'OWNER@example.org' })).toEqual({ ok: true, from: 'owner@example.org' });
    expect(fromFor(ACCOUNT, { from: 'ceo@bigbank.com' })).toEqual({ ok: false, detail: 'ceo@bigbank.com is not an address this mailbox sends as — it sends as owner@example.org, sales@umbrae.io, hello@deusneuma.ai, press@example.org, orphan@x.io' });
  });

  test('the field is optional: an account saved before it existed still resolves whole', () => {
    const field = EMAIL_ACCOUNT.fields.find((f) => f.key === 'sendAs');
    expect(field).toMatchObject({ secret: false, fallback: 'none' });
    const old = { address: 'a@b.co', username: 'a@b.co', password: 'pw' };
    expect(resolveChannelCredentials(EMAIL_ACCOUNT, old, {})).toMatchObject({ address: 'a@b.co', sendAs: 'none', smtpHost: 'smtp.gmail.com' });
    expect(resolveChannelCredentials(EMAIL_ACCOUNT, { ...old, sendAs: 'umbrae = s@umbrae.io' }, {}).sendAs).toBe('umbrae = s@umbrae.io');
  });
});
