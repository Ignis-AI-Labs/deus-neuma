/**
 * THE CMO KEEPS THE HOUSE'S ACCOUNTS (Design note, 2026-11-12, after the CMO reported it
 * had no tool to record a handle or seat a holder: […]). RULE 0: filed intents settled by the REAL
 * sweep, the real ACTS card over a real WebSocket pair, the real account store
 * and bindings on temp disk — no mock.
 *
 * Proven: the seated CMO records an account's @handle with no card; seating a
 * holder and moving an account to a company ride the operator's card (DENY
 * changes nothing); a lane of another house, an unknown account or company, and
 * a lane that is not the CMO are refused before any card.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { listAccounts } from '../../backend/services/social/account-store.js';
import { listCompanies } from '../../backend/services/marketing/companies.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { viaIntent } from '../helpers/intent-path.js';
import { buildMandateHouse, teardownMandateHouse, resetHouse, HOUSE, CMO } from '../helpers/mandate-house-kit.js';

let h;
beforeAll(async () => { h = await buildMandateHouse(); }, 30000);
afterAll(async () => { await teardownMandateHouse(h); });
beforeEach(async () => { await resetHouse(h); });

const carded = () => h.clientLog.filter((m) => m.type === 'tool:approval_request');
const account = async (id) => (await listAccounts(HOUSE)).find((a) => a.id === id);

describe('marketing/account-handle', () => {
  test('the seated CMO records an account\'s @handle with no card', async () => {
    const [receipt] = await viaIntent(h.connection, 'marketing/account-handle', { account: 'x-1', handle: '@neuma_house' });
    expect(receipt.status).toBe('ok');
    expect(receipt.content).toContain('x-1 now reads as @neuma_house');
    expect(carded()).toEqual([]);
    expect((await account('x-1')).expectedHandle).toBe('neuma_house');
  });

  test('refused before anything: an account the house does not have, a handle that is no handle, a lane that is not the CMO', async () => {
    const [unknown] = await viaIntent(h.connection, 'marketing/account-handle', { account: 'x-9', handle: 'a' });
    expect(unknown.error).toContain('"x-9" is not an account of this house');
    const [bad] = await viaIntent(h.connection, 'marketing/account-handle', { account: 'x-1', handle: 'two words' });
    expect(bad.error).toContain('handle must be the account\'s @name');
    const other = { ...h.connection, companion: { name: 'Else', neumaId: 'someoneelse' } };
    const [notCmo] = await viaIntent(other, 'marketing/account-handle', { account: 'x-1', handle: 'x' });
    expect(notCmo).toMatchObject({ status: 'denied' });
    expect(notCmo.error).toContain('kept by its seated CMO');
    expect((await account('x-1')).expectedHandle).not.toBe('x');
  });
});

describe('marketing/account-holder and marketing/account-company ride the operator\'s card', () => {
  test('ALLOW seats the holder; DENY leaves it as it was', async () => {
    await channelBindings.unbind(HOUSE, 'x-1');
    h.decide = () => 'deny';
    const [denied] = await viaIntent(h.connection, 'marketing/account-holder', { account: 'x-1', holder: CMO });
    expect(denied.status).not.toBe('ok');
    expect(carded()).toHaveLength(1);
    expect((await channelBindings.load(HOUSE))['x-1']).toBeFalsy();
    h.decide = () => 'allow';
    const [seated] = await viaIntent(h.connection, 'marketing/account-holder', { account: 'x-1', holder: CMO });
    expect(seated.status).toBe('ok');
    expect((await channelBindings.load(HOUSE))['x-1']).toMatchObject({ neumaId: CMO });
  });

  test('a lane of no house of this wallet is refused before any card', async () => {
    h.decide = () => 'allow';
    const [refused] = await viaIntent(h.connection, 'marketing/account-holder', { account: 'x-1', holder: 'strangerlane' });
    expect(refused.error).toContain('"strangerlane" is not a lane of this house');
    expect(carded()).toEqual([]);
  });

  test('ALLOW moves the account to the company; an unknown company is refused before any card', async () => {
    const [company] = await listCompanies(HOUSE);
    h.decide = () => 'allow';
    const [unknown] = await viaIntent(h.connection, 'marketing/account-company', { account: 'x-1', company: 'no-such-co' });
    expect(unknown.error).toContain('"no-such-co" is not a company of this house');
    expect(carded()).toEqual([]);
    const [moved] = await viaIntent(h.connection, 'marketing/account-company', { account: 'x-1', company: company.id });
    expect(moved.status).toBe('ok');
    expect(carded()).toHaveLength(1);
    expect((await account('x-1')).companyId).toBe(company.id);
  });
});
