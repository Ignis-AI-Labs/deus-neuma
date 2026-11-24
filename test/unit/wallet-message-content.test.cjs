const { describe, expect, test } = require('vitest');
const { describeTypedData } = require('../../electron/wallet/message-content.cjs');

describe('PR20 M-09: typed-data booleans match display and signature', () => {
  const types = { Authorization: [{ name: 'authorized', type: 'bool' }] };

  test('the string "false" is refused instead of displayed false and signed true', () => {
    expect(() => describeTypedData({}, types, { authorized: 'false' })).toThrow('must be a boolean');
  });

  test('a real boolean is rendered canonically and only true raises the grant warning', () => {
    expect(describeTypedData({}, types, { authorized: true })).toMatchObject({ body: 'Authorization\nauthorized: true', grantee: 'another address' });
    expect(describeTypedData({}, types, { authorized: false })).toMatchObject({ body: 'Authorization\nauthorized: false', grantee: null });
  });
});
