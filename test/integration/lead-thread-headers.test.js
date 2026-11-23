/**
 * A CONVERSATION WITH A LEAD STAYS ONE THREAD (backend/services/sales/email-ledger.js threadFor): the ids of the
 * messages already exchanged with that person — ours as sent, theirs as received — are what the next email names.
 * The real lead ledger on a tmp realm (RULE 0).
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { useTempRealm } from '../helpers/temp-realm.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { recordSent, recordReceived, threadFor } from '../../backend/services/sales/email-ledger.js';

const HOUSE = `0x${'7a'.repeat(20)}`;

describe('the next email to a lead names every message already exchanged with them', () => {
  beforeAll(async () => {
    useTempRealm();
    const ledger = await leadLedgerFor(HOUSE);
    await ledger.add({ name: 'Dana Reyes, Partner at Fund One', contact: 'dana@fundone.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    await ledger.add({ name: 'Otto Brandt, Founder at Outbox', contact: 'otto@outbox.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
  });

  test('nobody written to yet: nothing to name; then ours, theirs and ours again, oldest first', async () => {
    expect(await threadFor(HOUSE, ['dana@fundone.example'])).toEqual([]);
    await recordSent(HOUSE, { to: ['dana@fundone.example'], subject: 'Fund One: a DLMM for your portfolio', by: 'merc', from: 'merc@house.example', messageId: '<first@house.example>' });
    expect(await threadFor(HOUSE, ['Dana@FundOne.example'])).toEqual(['<first@house.example>']);
    await recordReceived(HOUSE, { from: 'dana@fundone.example', ref: 'mail #7', subject: 'Re: Fund One: a DLMM for your portfolio', text: 'Send the deck.', messageId: '<reply@fundone.example>' });
    await recordSent(HOUSE, { to: ['dana@fundone.example'], subject: 'Re: Fund One: a DLMM for your portfolio', by: 'merc', from: 'merc@house.example', messageId: '<second@house.example>' });
    expect(await threadFor(HOUSE, ['dana@fundone.example'])).toEqual(['<first@house.example>', '<reply@fundone.example>', '<second@house.example>']);
  });

  test('an email that may not have left is not named; another lead\'s thread is its own; several recipients or a stranger name nothing', async () => {
    await recordSent(HOUSE, { to: ['otto@outbox.example'], subject: 'Outbox: your build', by: 'merc', from: 'merc@house.example', messageId: '<maybe@house.example>', uncertain: true });
    expect(await threadFor(HOUSE, ['otto@outbox.example'])).toEqual([]);
    expect(await threadFor(HOUSE, ['dana@fundone.example', 'otto@outbox.example'])).toEqual([]);
    expect(await threadFor(HOUSE, ['stranger@nowhere.example'])).toEqual([]);
    expect(await threadFor(HOUSE, 'dana@fundone.example')).toEqual([]);
  });
});
