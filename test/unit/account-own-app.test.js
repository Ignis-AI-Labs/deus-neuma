/**
 * EVERY ACCOUNT ITS OWN APP (Design note, 2026-11-11: […]):
 * X-2 showed […] because its access token, issued by @DeusNeuma's own developer
 * app, was paired with the house app's consumer key. App keys pasted on an added account now land in
 * that account's own app; the first account keeps the house app. Pure store laws.
 */
import { describe, expect, test } from 'vitest';
import { emptyStore, patchAccount, storedFieldsOf, withoutAccount } from '../../backend/services/social/account-shape.js';

const HOUSE_APP = { apiKey: 'house-consumer-key-000000', apiSecret: 'house-consumer-secret-0000000000' };
const OWN_APP = { apiKey: 'deus-consumer-key-1111111', apiSecret: 'deus-consumer-secret-111111111111' };
const at = '2026-11-11T00:00:00.000Z';

const twoAccounts = () => {
  let store = patchAccount(emptyStore(), 'x-1', { ...HOUSE_APP, accessToken: 'tok-1', accessSecret: 'sec-1' }, { at });
  store = patchAccount(store, 'x-2', { accessToken: 'tok-2', accessSecret: 'sec-2' }, { at });
  return store;
};

describe('each account its own developer app', () => {
  test('an added account with no app keys of its own rides the house app (the OAuth model)', () => {
    const store = twoAccounts();
    expect(storedFieldsOf(store, 'x-2')).toEqual({ ...HOUSE_APP, accessToken: 'tok-2', accessSecret: 'sec-2' });
  });

  test('THE X-2 CASE: its own consumer key is used for it, and the first account is untouched', () => {
    const store = patchAccount(twoAccounts(), 'x-2', OWN_APP, { at });
    expect(store.accounts['x-2'].appId).toBe('x-2');
    expect(storedFieldsOf(store, 'x-2')).toEqual({ ...OWN_APP, accessToken: 'tok-2', accessSecret: 'sec-2' });
    expect(storedFieldsOf(store, 'x-1')).toEqual({ ...HOUSE_APP, accessToken: 'tok-1', accessSecret: 'sec-1' });
    expect(store.apps.x).toEqual(HOUSE_APP);
  });

  test('half an app never mixes with the house app: a key pasted alone stands alone', () => {
    const store = patchAccount(twoAccounts(), 'x-2', { apiKey: OWN_APP.apiKey }, { at });
    expect(store.apps['x-2']).toEqual({ apiKey: OWN_APP.apiKey });
    expect(storedFieldsOf(store, 'x-2').apiSecret).toBeUndefined();
  });

  test('the first account\'s app keys stay the house app', () => {
    const store = patchAccount(twoAccounts(), 'x-1', { apiKey: 'rotated-house-key-2222222' }, { at });
    expect(store.apps.x.apiKey).toBe('rotated-house-key-2222222');
    expect(store.accounts['x-1'].appId).toBeUndefined();
    expect(storedFieldsOf(store, 'x-2').apiKey).toBe('rotated-house-key-2222222');
  });

  test('emptying its own app returns the account to the house app', () => {
    let store = patchAccount(twoAccounts(), 'x-2', OWN_APP, { at });
    store = patchAccount(store, 'x-2', { apiKey: '', apiSecret: '' }, { at });
    expect(store.apps['x-2']).toBeUndefined();
    expect(store.accounts['x-2'].appId).toBeUndefined();
    expect(storedFieldsOf(store, 'x-2').apiKey).toBe(HOUSE_APP.apiKey);
  });

  test('removing the account removes its own app with it, never the house app', () => {
    const store = withoutAccount(patchAccount(twoAccounts(), 'x-2', OWN_APP, { at }), 'x-2');
    expect(store.apps['x-2']).toBeUndefined();
    expect(store.apps.x).toEqual(HOUSE_APP);
  });
});
