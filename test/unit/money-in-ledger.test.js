/**
 * money-in ledger — the pure law, called with real inputs (RULE 0: no mock
 * anywhere): the pinned asset table and its validation, ERC-20 Transfer log
 * decoding, the dedupe key, the token cursor's window, period totals and
 * the benchmark numerator, plus the store's append-only dedupe on real tmp
 * disk and the family's read-only-by-construction source law.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { MONEY_IN_ASSETS, validateAssetTable } from '../../backend/services/money-in/asset-table.js';
import {
  TRANSFER_TOPIC, addressTopic, decodeTransferLog, receiptKey, usdValueOf, makeReceipt, priceRows, freshRows,
} from '../../backend/services/money-in/receipt-rows.js';
import { summarizeMoneyIn, totalsByPeriod, filterReceipts } from '../../backend/services/money-in/money-in-summary.js';
import { planWindow } from '../../backend/services/money-in/money-in-scan.js';
import { appendReceipts, readReceipts, appendAttribution, withHouseLock } from '../../backend/services/money-in/money-in-store.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { getRealmRoot } from '../../backend/services/user-realm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const A = ethers.getAddress('0x00000000000000000000000000000000000000a1');
const B = ethers.getAddress('0x00000000000000000000000000000000000000b2');
const SENDER = ethers.getAddress('0x00000000000000000000000000000000000000c3');
const USDC = { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
const ETH = { symbol: 'ETH', kind: 'native', decimals: 18, priceId: 'ethereum' };
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;

const row = (over = {}) => makeReceipt({
  network: 'ethereum', asset: USDC, amountRaw: '1500000', from: SENDER,
  to: { address: A, member: 'lane-a', label: 'Keir' }, block: 100, timestamp: Date.parse('2026-10-01T12:00:00Z') / 1000,
  txHash: hash(1), logIndex: 0, internal: false, detectedAt: '2026-10-01T12:05:00.000Z', ...over,
});

describe('the pinned asset table', () => {
  test('the production table validates', () => {
    expect(validateAssetTable(MONEY_IN_ASSETS)).toEqual({ ok: true, errors: [] });
    expect(MONEY_IN_ASSETS.map((n) => n.network)).toEqual(['ethereum', 'base']);
    for (const net of MONEY_IN_ASSETS) {
      expect(net.assets.map((a) => a.symbol)).toEqual(['ETH', 'USDC', 'USDT', 'DAI']);
    }
  });

  test('a lower-cased paste, a duplicate, an unknown network and two natives all refuse', () => {
    const net = MONEY_IN_ASSETS[0];
    const lowered = [{ ...net, assets: net.assets.map((a) => (a.symbol === 'USDC' ? { ...a, address: a.address.toLowerCase() } : a)) }];
    expect(validateAssetTable(lowered).errors).toEqual(['network ethereum USDC: address must be a checksummed EVM address']);
    const dup = [{ ...net, assets: [...net.assets, { ...net.assets[1], symbol: 'USDC2' }] }];
    expect(validateAssetTable(dup).errors).toEqual(['network ethereum USDC2: duplicate address']);
    expect(validateAssetTable([{ ...net, network: 'solana' }]).errors).toEqual(['network solana: not a chain-registry key']);
    const twoNative = [{ ...net, assets: [...net.assets, { ...ETH, symbol: 'WETH' }] }];
    expect(validateAssetTable(twoNative).errors).toEqual(['network ethereum: exactly one native asset']);
    expect(validateAssetTable([net, net]).errors).toEqual(['network ethereum: listed twice']);
    expect(validateAssetTable([]).ok).toBe(false);
  });
});

describe('Transfer log decoding', () => {
  const iface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);

  test('a real encoded ERC-20 Transfer decodes to exact base units', () => {
    const { topics, data } = iface.encodeEventLog('Transfer', [SENDER, A, 123456789012345678901234567n]);
    expect(topics[0]).toBe(TRANSFER_TOPIC);
    expect(topics[2]).toBe(addressTopic(A));
    expect(decodeTransferLog({ topics, data })).toEqual({ from: SENDER, to: A, amountRaw: '123456789012345678901234567' });
  });

  test('an ERC-721 Transfer (tokenId indexed, empty data) and a foreign event are not money', () => {
    expect(decodeTransferLog({ topics: [TRANSFER_TOPIC, addressTopic(SENDER), addressTopic(A), hash(7)], data: '0x' })).toBeNull();
    expect(decodeTransferLog({ topics: [ethers.id('Approval(address,address,uint256)'), addressTopic(SENDER), addressTopic(A)], data: hash(5) })).toBeNull();
    expect(decodeTransferLog({ topics: [TRANSFER_TOPIC, addressTopic(SENDER), addressTopic(A)], data: '0x12' })).toBeNull();
  });
});

describe('rows, dedupe, USD', () => {
  test('the key is (network, txHash, logIndex); native fills the index slot', () => {
    expect(receiptKey({ network: 'base', txHash: hash(0xab).toUpperCase().replace('0X', '0x'), logIndex: 3 })).toBe(`base:${hash(0xab)}:3`);
    expect(receiptKey({ network: 'base', txHash: hash(1), logIndex: null })).toBe(`base:${hash(1)}:native`);
  });

  test('a row carries exact base units, the decimal string and its member', () => {
    const r = row();
    expect(r).toMatchObject({
      key: `ethereum:${hash(1)}:0`, asset: 'USDC', amountRaw: '1500000', amount: '1.5', to: A, member: 'lane-a',
      timestamp: '2026-10-01T12:00:00.000Z', usd: null, price: null, attribution: null, internal: false,
    });
  });

  test('freshRows drops what the ledger holds and repeats inside the batch', () => {
    const one = row();
    const two = row({ logIndex: 1 });
    expect(freshRows(new Set([one.key]), [one, two, two]).map((r) => r.key)).toEqual([two.key]);
  });

  test('USD: priced rows carry their basis; an unpriced id stays null, never $0', () => {
    expect(usdValueOf('1500000', 6, 0.9998)).toBe(1.4997);
    expect(usdValueOf('1500000', 6, null)).toBeNull();
    const assets = new Map([['ethereum:USDC', USDC], ['ethereum:ETH', ETH]]);
    const [usdc, eth] = priceRows(
      [row(), row({ asset: ETH, amountRaw: '2000000000000000000', logIndex: null })],
      assets, { 'usd-coin': 1.0001 }, { priceAt: '2026-10-01T12:06:00.000Z', source: 'coingecko' },
    );
    expect(usdc.usd).toBe(1.50015);
    expect(usdc.price).toEqual({ usd: 1.0001, basis: 'spot-at-detection', source: 'coingecko', priceAt: '2026-10-01T12:06:00.000Z' });
    expect(eth.usd).toBeNull();
    expect(eth.price).toBeNull();
  });
});

describe('the token cursor', () => {
  test('first sight starts at the head; later windows advance from the cursor, capped', () => {
    expect(planWindow({ cursor: undefined, head: 500, maxBlocks: 100 })).toEqual({ start: 500 });
    expect(planWindow({ cursor: 500, head: 500, maxBlocks: 100 })).toBeNull();
    expect(planWindow({ cursor: 500, head: 530, maxBlocks: 100 })).toEqual({ fromBlock: 501, toBlock: 530 });
    expect(planWindow({ cursor: 500, head: 10_000, maxBlocks: 100 })).toEqual({ fromBlock: 501, toBlock: 600 });
  });
});

describe('the numerator — summarizeMoneyIn and period totals', () => {
  const rows = [
    { ...row(), usd: 1.5 },
    { ...row({ txHash: hash(2), amountRaw: '2500000', timestamp: Date.parse('2026-10-03T00:00:00Z') / 1000 }), usd: 2.5 },
    row({ txHash: hash(3), asset: ETH, amountRaw: '10000000000000000', logIndex: null, to: { address: B, member: null, label: 'tips' }, timestamp: Date.parse('2026-10-09T08:00:00Z') / 1000 }),
    { ...row({ txHash: hash(4), internal: true, timestamp: Date.parse('2026-10-03T01:00:00Z') / 1000 }), usd: 99 },
    { ...row({ txHash: hash(5), timestamp: Date.parse('2026-11-02T00:00:00Z') / 1000 }), usd: 7 },
  ];

  test('per asset exact, USD total, unpriced and internal counted apart, per member', () => {
    const s = summarizeMoneyIn(rows, { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' });
    expect(s.count).toBe(3);
    expect(s.usdTotal).toBe(4);
    expect(s.unpriced).toBe(1);
    expect(s.internalExcluded).toBe(1);
    expect(s.perAsset['ethereum:USDC']).toEqual({ network: 'ethereum', asset: 'USDC', count: 2, unpriced: 0, amountRaw: '4000000', amount: '4.0', usd: 4 });
    expect(s.perAsset['ethereum:ETH']).toMatchObject({ amountRaw: '10000000000000000', amount: '0.01', unpriced: 1, usd: 0 });
    expect(s.perMember['lane-a']).toMatchObject({ member: 'lane-a', count: 2, usd: 4 });
    expect(s.perMember[`address:${B.toLowerCase()}`]).toMatchObject({ member: null, label: 'tips', count: 1 });
  });

  test('filters by member and asset; buckets by UTC day, ISO week and month', () => {
    expect(filterReceipts(rows, { member: 'lane-a', asset: 'USDC' })).toHaveLength(4);
    const days = totalsByPeriod(rows, { granularity: 'day', from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' });
    expect(days.map((d) => [d.from, d.count, d.usdTotal])).toEqual([
      ['2026-10-01T00:00:00.000Z', 1, 1.5], ['2026-10-03T00:00:00.000Z', 1, 2.5], ['2026-10-09T00:00:00.000Z', 1, 0],
    ]);
    const weeks = totalsByPeriod(rows, { granularity: 'week' });
    expect(weeks.map((w) => [w.from, w.count])).toEqual([
      ['2026-09-28T00:00:00.000Z', 2], ['2026-10-05T00:00:00.000Z', 1], ['2026-11-02T00:00:00.000Z', 1],
    ]);
    const months = totalsByPeriod(rows, { granularity: 'month' });
    expect(months.map((m) => [m.from, m.to, m.usdTotal])).toEqual([
      ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 4], ['2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z', 7],
    ]);
  });
});

describe('the store — append-only, deduped, attributions joined (real tmp disk)', () => {
  beforeAll(() => useTempRealm());
  const HOUSE = '0x00000000000000000000000000000000000000d4';

  test('a repeat append lands nothing; an attribution changes no receipt byte', async () => {
    const one = row();
    expect(await withHouseLock(HOUSE, () => appendReceipts(HOUSE, [one]))).toHaveLength(1);
    expect(await withHouseLock(HOUSE, () => appendReceipts(HOUSE, [one, row({ logIndex: 2 })]))).toHaveLength(1);
    const file = path.join(getRealmRoot(), HOUSE, 'money-in', 'receipts.jsonl');
    const before = await fs.readFile(file, 'utf8');
    expect(await appendAttribution(HOUSE, { key: one.key, attribution: 'logo commission', by: HOUSE, at: '2026-10-02T00:00:00Z' })).toBe(true);
    expect(await appendAttribution(HOUSE, { key: 'base:0xnope:0', attribution: 'x', by: HOUSE, at: '2026-10-02T00:00:00Z' })).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    const rows = await readReceipts(HOUSE);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === one.key)).toMatchObject({ attribution: 'logo commission', attributedBy: HOUSE });
  });

  test('a torn last line (a crash mid-append) is dropped, not thrown', async () => {
    const file = path.join(getRealmRoot(), HOUSE, 'money-in', 'receipts.jsonl');
    await fs.appendFile(file, '{"key":"torn');
    expect(await readReceipts(HOUSE)).toHaveLength(2);
  });
});

describe('read-only by construction', () => {
  // Every file the ledger is made of, read as text: no signer, no key
  // store, no spend path, no write verb of any chain may appear in it.
  const FORBIDDEN = [
    /sendTransaction/, /signTransaction/, /signMessage/, /eth_sendRawTransaction/, /\bnew\s+ethers\.Wallet\b/, /\bWallet\(/,
    /privateKey/, /readKeypair/, /readEncryptedKeypair/, /getCachedKey/, /keypair/i, /neuma-wallet/, /neuma-auth-routes/,
    /getSigner/, /\.populateTransaction/, /calldata/i,
  ];

  test('no money-in source file can sign, send, or open a key', async () => {
    const dir = path.join(ROOT, 'backend/services/money-in');
    const files = [...(await fs.readdir(dir)).map((f) => path.join(dir, f)), path.join(ROOT, 'backend/routes/money-in-routes.js')];
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) {
      // Comments may NAME what the code never does; the code itself may not.
      const code = (await fs.readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
      for (const pattern of FORBIDDEN) {
        expect({ file: path.relative(ROOT, file), hit: pattern.test(code) }).toEqual({ file: path.relative(ROOT, file), hit: false });
      }
    }
  });
});
