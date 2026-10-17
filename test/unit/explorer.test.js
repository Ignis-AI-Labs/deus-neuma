/**
 * Explorer links — pure mapping from on-chain facts to their public record.
 * The one rule that matters: an unknown network or malformed hash yields
 * NULL (plain text), never a link to a guessed host.
 */
import { describe, test, expect } from 'vitest';
import { explorerTxUrl, isTxHash, shortTxHash } from '../../frontend/utils/explorer.js';

// aether-2's real mainnet anchor (block 48836412) — the live receipt this
// surface was built for.
const REAL_TX = '0xa9ec7fac4d168c03410cabd7d27126361c950aa96852b241728f4b3e05e44d89';

describe('explorerTxUrl', () => {
  test('base mainnet → basescan', () => {
    expect(explorerTxUrl('base', REAL_TX)).toBe(`https://basescan.org/tx/${REAL_TX}`);
  });
  test('base-sepolia → sepolia.basescan', () => {
    expect(explorerTxUrl('base-sepolia', REAL_TX)).toBe(`https://sepolia.basescan.org/tx/${REAL_TX}`);
  });
  test('unknown network or malformed hash → null, never a guessed host', () => {
    expect(explorerTxUrl('polygon', REAL_TX)).toBeNull();
    expect(explorerTxUrl(undefined, REAL_TX)).toBeNull();
    expect(explorerTxUrl('base', '0xdeadbeef')).toBeNull();
    expect(explorerTxUrl('base', `javascript:alert(1)//${REAL_TX}`)).toBeNull();
    expect(explorerTxUrl('base', null)).toBeNull();
  });
});

describe('isTxHash / shortTxHash', () => {
  test('recognizes a 32-byte hash and nothing else', () => {
    expect(isTxHash(REAL_TX)).toBe(true);
    expect(isTxHash(REAL_TX.slice(0, 60))).toBe(false);
    expect(isTxHash(`${REAL_TX}00`)).toBe(false);
    expect(isTxHash(42)).toBe(false);
  });
  test('short form keeps both ends; non-hashes pass through as text', () => {
    expect(shortTxHash(REAL_TX)).toBe('0xa9ec7f…e44d89');
    expect(shortTxHash('pending')).toBe('pending');
    expect(shortTxHash(null)).toBe('');
  });
});
