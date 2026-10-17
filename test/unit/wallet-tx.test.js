// Unit tests for the pure witness-send helpers. These are the bytes the live
// send flow and the Base fork test both build, so they get strict coverage.

import { describe, it, expect } from 'vitest';
import {
  isAddress, parseEthToWei, validateSendForm, buildSendTx,
  trimEth, allocAmount, allocFraction,
} from '../../frontend/app/RelinkShell/wallet-tx.js';

const ADDR = '0x' + 'a1'.repeat(20); // valid 20-byte hex address
const ONE_ETH_HEX = '0xde0b6b3a7640000'; // 10^18 wei

describe('isAddress', () => {
  it('accepts a valid 0x address and trims surrounding space', () => {
    expect(isAddress(ADDR)).toBe(true);
    expect(isAddress(`  ${ADDR}  `)).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isAddress('')).toBe(false);
    expect(isAddress(null)).toBe(false);
    expect(isAddress('0x123')).toBe(false); // too short
    expect(isAddress('a1'.repeat(20))).toBe(false); // no 0x prefix
    expect(isAddress('0x' + 'zz'.repeat(20))).toBe(false); // non-hex
  });
});

describe('parseEthToWei', () => {
  it('parses whole and fractional ETH to wei', () => {
    expect(parseEthToWei('1')).toEqual({ ok: true, wei: 1_000_000_000_000_000_000n });
    expect(parseEthToWei('0.5')).toEqual({ ok: true, wei: 500_000_000_000_000_000n });
    expect(parseEthToWei(2)).toEqual({ ok: true, wei: 2_000_000_000_000_000_000n });
  });

  it('rejects empty, non-numeric, zero, and negative amounts', () => {
    expect(parseEthToWei('').ok).toBe(false);
    expect(parseEthToWei('   ').ok).toBe(false);
    expect(parseEthToWei('abc').ok).toBe(false);
    expect(parseEthToWei('0').ok).toBe(false);
    expect(parseEthToWei('-0.5').ok).toBe(false);
  });

  it('rejects sub-wei precision', () => {
    expect(parseEthToWei('0.0000000000000000001').ok).toBe(false);
  });

  it('parses large values without precision loss', () => {
    expect(parseEthToWei('1000000')).toEqual({ ok: true, wei: 1_000_000_000_000_000_000_000_000n });
  });
});

describe('validateSendForm', () => {
  it('passes a well-formed transfer', () => {
    expect(validateSendForm({ to: ADDR, amountEth: '1' })).toEqual({ ok: true, wei: 1_000_000_000_000_000_000n });
  });

  it('rejects a bad recipient before looking at the amount', () => {
    expect(validateSendForm({ to: '0xnope', amountEth: '1' })).toEqual({
      ok: false, error: 'Enter a valid 0x recipient address.',
    });
  });

  it('rejects a bad amount', () => {
    expect(validateSendForm({ to: ADDR, amountEth: '0' }).ok).toBe(false);
  });

  it('rejects a value above balance, but allows value at/under it', () => {
    expect(validateSendForm({ to: ADDR, amountEth: '2', balanceEth: '1' })).toEqual({
      ok: false, error: 'Amount exceeds your balance.',
    });
    expect(validateSendForm({ to: ADDR, amountEth: '1', balanceEth: '1' }).ok).toBe(true);
    expect(validateSendForm({ to: ADDR, amountEth: '0.4', balanceEth: '1' }).ok).toBe(true);
  });

  it('skips the balance check when balance is unknown', () => {
    expect(validateSendForm({ to: ADDR, amountEth: '9999', balanceEth: null }).ok).toBe(true);
  });

  it('accepts a whitespace-padded recipient', () => {
    expect(validateSendForm({ to: `  ${ADDR}  `, amountEth: '1' }).ok).toBe(true);
  });

  it('accepts balanceEth passed as a number', () => {
    expect(validateSendForm({ to: ADDR, amountEth: '1', balanceEth: 1 }).ok).toBe(true);
    expect(validateSendForm({ to: ADDR, amountEth: '1', balanceEth: 0.5 }).ok).toBe(false);
  });
});

describe('buildSendTx', () => {
  it('builds a frozen eth_sendTransaction params object with hex wei value', () => {
    const tx = buildSendTx({ from: ADDR, to: ADDR, wei: 1_000_000_000_000_000_000n });
    expect(tx).toEqual({ from: ADDR, to: ADDR, value: ONE_ETH_HEX });
    expect(Object.isFrozen(tx)).toBe(true);
  });
});

describe('trimEth', () => {
  it('renders compact amounts — 6 decimals max, trailing zeros trimmed', () => {
    expect(trimEth(0.01)).toBe('0.01');
    expect(trimEth(0.0198)).toBe('0.0198');
    expect(trimEth(1)).toBe('1');
    expect(trimEth(0.1234567)).toBe('0.123457');
  });
  it('renders zero for nothing spendable', () => {
    expect(trimEth(0)).toBe('0');
    expect(trimEth(-1)).toBe('0');
    expect(trimEth(NaN)).toBe('0');
  });
});

describe('allocAmount', () => {
  it('takes clean fractions of the balance', () => {
    expect(allocAmount('0.02', 0.25)).toBe('0.005');
    expect(allocAmount('0.02', 0.5)).toBe('0.01');
    expect(allocAmount('0.02', 0.75)).toBe('0.015');
  });
  it('MAX spends everything above the gas reserve', () => {
    expect(allocAmount('0.02', 1, 0.0002)).toBe('0.0198');
  });
  it('clamps partial fractions under the reserve ceiling', () => {
    // 75% of 0.0002 balance would exceed spendable 0.0001 with a 0.0001 reserve
    expect(allocAmount('0.0002', 0.75, 0.0001)).toBe('0.0001');
  });
  it('returns 0 when nothing is spendable or inputs are unusable', () => {
    expect(allocAmount(null, 0.5)).toBe('0');
    expect(allocAmount('0', 1)).toBe('0');
    expect(allocAmount('0.0001', 1, 0.0002)).toBe('0');
    expect(allocAmount('1', 0)).toBe('0');
  });
});

describe('allocFraction', () => {
  it('reads the amount back as a fraction of the balance', () => {
    expect(allocFraction('0.01', '0.02')).toBe(0.5);
    expect(allocFraction('0.005', '0.02')).toBe(0.25);
  });
  it('clamps at 1 and reads unusable inputs as 0', () => {
    expect(allocFraction('5', '0.02')).toBe(1);
    expect(allocFraction('', '0.02')).toBe(0);
    expect(allocFraction('0.01', null)).toBe(0);
  });
});
