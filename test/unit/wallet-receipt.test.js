// Unit tests for the pure transaction-breakdown grammar. The shapes here are
// real Base RPC responses (hex-quantity strings), not invented fixtures — the
// same bytes eth_getTransactionByHash / eth_getTransactionReceipt return.

import { describe, it, expect } from 'vitest';
import { buildTxBreakdown, explorerTxUrl, explorerAddressUrl } from '../../frontend/app/RelinkShell/wallet-receipt.js';

const HASH = '0x' + 'ab'.repeat(32);
const FROM = '0x' + 'a1'.repeat(20);
const TO = '0x' + 'b2'.repeat(20);

// A real-shaped Base transfer: 0.01 ETH, 21000 gas at 0.05 gwei effective.
const TX = {
  hash: HASH, from: FROM, to: TO,
  value: '0x2386f26fc10000',       // 0.01 ETH
  nonce: '0x7',
  gasPrice: '0x2faf080',           // 0.05 gwei (pre-receipt estimate)
};
const RECEIPT = {
  status: '0x1',
  from: FROM, to: TO,
  blockNumber: '0x2e54d20',        // 48 581 920
  gasUsed: '0x5208',               // 21 000
  effectiveGasPrice: '0x2faf080',  // 0.05 gwei
};

describe('buildTxBreakdown', () => {
  it('derives the complete breakdown from tx + receipt', () => {
    const b = buildTxBreakdown({ tx: TX, receipt: RECEIPT });
    expect(b.status).toBe('success');
    expect(b.from).toBe(FROM);
    expect(b.to).toBe(TO);
    expect(b.nonce).toBe(7);
    expect(b.block).toBe(48581920);
    expect(b.valueEth).toBe('0.01');
    expect(b.gasUsed).toBe('21000');
    expect(b.gasPriceGwei).toBe('0.05');
    // fee = 21000 × 0.05 gwei = 1 050 000 gwei = 0.00000105 ETH
    expect(b.feeEth).toBe('0.00000105');
    expect(b.totalEth).toBe('0.01000105');
  });

  it('reads a missing receipt as an honest pending state', () => {
    const b = buildTxBreakdown({ tx: TX, receipt: null });
    expect(b.status).toBe('pending');
    expect(b.valueEth).toBe('0.01');
    expect(b.block).toBe(null);
    expect(b.gasUsed).toBe(null);
    expect(b.feeEth).toBe(null);
    expect(b.totalEth).toBe(null);
  });

  it('reads status 0x0 as reverted', () => {
    const b = buildTxBreakdown({ tx: TX, receipt: { ...RECEIPT, status: '0x0' } });
    expect(b.status).toBe('reverted');
  });

  it('survives both legs missing — nothing invented, everything null', () => {
    const b = buildTxBreakdown({ tx: null, receipt: null });
    expect(b.status).toBe('pending');
    expect(b.from).toBe(null);
    expect(b.to).toBe(null);
    expect(b.valueEth).toBe(null);
  });

  it('falls to the receipt for endpoints when the tx read lags', () => {
    const b = buildTxBreakdown({ tx: null, receipt: RECEIPT });
    expect(b.from).toBe(FROM);
    expect(b.to).toBe(TO);
    expect(b.status).toBe('success');
  });
});

describe('explorerTxUrl', () => {
  it('routes each network to its own Basescan', () => {
    expect(explorerTxUrl('base', HASH)).toBe(`https://basescan.org/tx/${HASH}`);
    expect(explorerTxUrl('base-sepolia', HASH)).toBe(`https://sepolia.basescan.org/tx/${HASH}`);
  });
  it('falls to Base mainnet on an unknown key — never a dead link', () => {
    expect(explorerTxUrl(undefined, HASH)).toBe(`https://basescan.org/tx/${HASH}`);
  });
});

describe('explorerAddressUrl', () => {
  it('links the address page — the wallet\'s complete history', () => {
    expect(explorerAddressUrl('base', FROM)).toBe(`https://basescan.org/address/${FROM}`);
    expect(explorerAddressUrl('base-sepolia', FROM)).toBe(`https://sepolia.basescan.org/address/${FROM}`);
    expect(explorerAddressUrl(null, FROM)).toBe(`https://basescan.org/address/${FROM}`);
  });
});
