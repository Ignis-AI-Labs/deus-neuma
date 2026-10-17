// Unit tests for the pure EIP-1193 request helpers.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pickPersonalSignMessage, parseTypedData, isReadMethod, toChainIdHex } = require('../../electron/wallet/eip1193-helpers.cjs');

const ADDR = '0x1111111111111111111111111111111111111111';

describe('pickPersonalSignMessage', () => {
  it('returns data when called the spec way [data, address]', () => {
    expect(pickPersonalSignMessage(['gm from the void', ADDR])).toBe('gm from the void');
  });

  it('returns data when called [address, data]', () => {
    expect(pickPersonalSignMessage([ADDR, 'gm from the void'])).toBe('gm from the void');
  });

  it('handles a single message arg', () => {
    expect(pickPersonalSignMessage(['just a message'])).toBe('just a message');
  });

  it('throws on empty params', () => {
    expect(() => pickPersonalSignMessage([])).toThrow();
  });
});

describe('parseTypedData', () => {
  const payload = {
    domain: { name: 'NEUMA', version: '1', chainId: 8453 },
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }],
      Mail: [{ name: 'contents', type: 'string' }],
    },
    primaryType: 'Mail',
    message: { contents: 'hello' },
  };

  it('strips EIP712Domain from types and surfaces domain + value', () => {
    const out = parseTypedData([ADDR, payload]);
    expect(out.types.EIP712Domain).toBeUndefined();
    expect(out.types.Mail).toBeDefined();
    expect(out.domain.name).toBe('NEUMA');
    expect(out.value).toEqual({ contents: 'hello' });
  });

  it('parses a JSON-string payload', () => {
    const out = parseTypedData([ADDR, JSON.stringify(payload)]);
    expect(out.types.Mail).toBeDefined();
    expect(out.value.contents).toBe('hello');
  });

  it('throws on a malformed payload', () => {
    expect(() => parseTypedData([ADDR, { nope: true }])).toThrow();
  });
});

describe('isReadMethod', () => {
  it('flags read methods and not signing/sending ones', () => {
    expect(isReadMethod('eth_getBalance')).toBe(true);
    expect(isReadMethod('eth_call')).toBe(true);
    expect(isReadMethod('eth_sendTransaction')).toBe(false);
    expect(isReadMethod('personal_sign')).toBe(false);
  });
});

describe('toChainIdHex', () => {
  it('normalizes Base mainnet from a number', () => {
    expect(toChainIdHex(8453)).toBe('0x2105');
  });

  it('passes through a 0x string', () => {
    expect(toChainIdHex('0x2105')).toBe('0x2105');
  });

  it('throws on an invalid chain id', () => {
    expect(() => toChainIdHex(0)).toThrow();
  });
});
