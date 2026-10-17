// The money-in scan — one pass over one house: its watch set, on every
// pinned network, for native ETH and the pinned stablecoins, appended to the
// house's ledger exactly once per receipt.
//
// READ-ONLY BY CONSTRUCTION. This family imports no wallet, no key store, no
// signer and no spend path; the only chain surface it touches is
// chain-registry's verified, operator-pinned provider, and only its read
// verbs (block number, balance, nonce, block, receipt, logs). A test pins
// that by reading the family's own source.
//
// The chain-access master switch governs: off means no scan, of any kind.
// A network whose RPC is unset or not answering is skipped and named on the
// result — never a silent zero.
//
// impure (RPC + fs).

import { ethers } from 'ethers';
import { providerFor, isConfigured, redactRpcUrl } from '../chain/chain-registry.js';
import { chainSettings as defaultChainSettings } from '../chain/chain-access.js';
import { MONEY_IN_ASSETS, validateAssetTable } from './asset-table.js';
import { makeReceipt, priceRows } from './receipt-rows.js';
import { walkTokenTransfers, START_CHUNK } from './token-scan.js';
import { scanNativeReceipts } from './native-scan.js';
import { spotUsd, PRICE_SOURCE } from './spot-price.js';
import { houseWatchSet } from './watch-set.js';
import { withHouseLock, readScanState, writeScanState, appendReceipts } from './money-in-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('MoneyIn.Scan');

/** The most blocks one scan walks for token logs per network; the rest waits for the next scan. */
export const MAX_BLOCKS_PER_SCAN = 10_000;

const lower = (a) => String(a).toLowerCase();

/**
 * The token window a scan walks. `null` cursor = first sight: watching
 * starts at the head and nothing earlier is counted. pure.
 * @param {{ cursor: number|null|undefined, head: number, maxBlocks: number }} args
 * @returns {{ start: number }|{ fromBlock: number, toBlock: number }|null}
 */
export const planWindow = ({ cursor, head, maxBlocks }) => {
  if (cursor === null || cursor === undefined) return { start: head };
  if (head <= cursor) return null;
  return { fromBlock: cursor + 1, toBlock: Math.min(head, cursor + maxBlocks) };
};

// A gap is one window of one address; a rescan of the same window (a
// rewound or retried checkpoint) must not file it twice. pure.
const gapId = (g) => `${g.network}:${lower(g.address)}:${g.kind}:${g.fromBlock}:${g.toBlock}`;
const mergeGaps = (prior, fresh) => {
  const seen = new Set(prior.map(gapId));
  return [...prior, ...fresh.filter((g) => !seen.has(gapId(g)) && seen.add(gapId(g)))];
};

// impure — block timestamps, read once per block per scan.
const timestampsFor = async (provider, blocks) => {
  const out = new Map();
  for (const n of new Set(blocks)) out.set(n, (await provider.getBlock(n)).timestamp);
  return out;
};

// impure — the token leg of one network.
const scanTokens = async ({ provider, net, netState, head, watchedBy, houseAddrs, detectedAt, maxBlocks }) => {
  const tokens = net.assets.filter((a) => a.kind === 'erc20');
  const plan = planWindow({ cursor: netState.tokenCursor, head, maxBlocks });
  if (!plan) return { rows: [], window: null, error: null };
  if (plan.start !== undefined) {
    Object.assign(netState, { tokenCursor: plan.start, watchingSince: netState.watchingSince ?? plan.start });
    return { rows: [], window: null, error: null };
  }
  const walk = await walkTokenTransfers({
    provider, tokens, addresses: [...watchedBy.values()].map((w) => w.address),
    fromBlock: plan.fromBlock, toBlock: plan.toBlock, chunk: netState.chunk ?? START_CHUNK,
  });
  const times = await timestampsFor(provider, walk.transfers.map((t) => t.block));
  const byToken = new Map(tokens.map((t) => [lower(t.address), t]));
  const rows = walk.transfers.map((t) => makeReceipt({
    network: net.network, asset: byToken.get(lower(t.token)), amountRaw: t.amountRaw,
    from: t.from, to: watchedBy.get(lower(t.to)), block: t.block, timestamp: times.get(t.block),
    txHash: t.txHash, logIndex: t.logIndex, internal: houseAddrs.has(lower(t.from)), detectedAt,
  }));
  Object.assign(netState, { tokenCursor: walk.scannedTo, chunk: walk.chunk });
  return { rows, window: { fromBlock: plan.fromBlock, toBlock: walk.scannedTo }, error: walk.error };
};

// impure — the native leg of one network, address by address.
const scanNative = async ({ provider, net, state, head, watchedBy, houseAddrs, detectedAt }) => {
  const native = net.assets.find((a) => a.kind === 'native');
  const rows = [];
  const gaps = [];
  const errors = [];
  for (const w of watchedBy.values()) {
    const key = `${net.network}:${lower(w.address)}`;
    const r = await scanNativeReceipts({ provider, address: w.address, checkpoint: state.native[key] ?? null, head });
    state.native[key] = r.checkpoint;
    if (r.error) errors.push(`${w.address}: ${r.error}`);
    for (const g of r.gaps) gaps.push({ ...g, network: net.network, address: w.address, member: w.member ?? null, detectedAt });
    for (const rc of r.receipts) {
      rows.push(makeReceipt({
        network: net.network, asset: native, amountRaw: rc.amountRaw, from: rc.from, to: w,
        block: rc.block, timestamp: rc.timestamp, txHash: rc.txHash, logIndex: null,
        internal: houseAddrs.has(lower(rc.from)), detectedAt,
      }));
    }
  }
  return { rows, gaps, errors };
};

// impure — one network: head, tokens, native.
const scanNetwork = async ({ net, state, watchedBy, houseAddrs, env, detectedAt, maxBlocks }) => {
  const provider = await providerFor(net.network, env);
  if (!provider) {
    return { result: { network: net.network, skipped: isConfigured(net.network, env) ? 'rpc-unavailable' : 'unconfigured' }, rows: [], gaps: [] };
  }
  let latest;
  try {
    latest = await provider.getBlockNumber();
  } catch (err) {
    return { result: { network: net.network, skipped: 'rpc-unavailable', error: redactRpcUrl(err.message) }, rows: [], gaps: [] };
  }
  const head = Math.max(0, latest - net.confirmations);
  const netState = { ...(state.networks[net.network] ?? {}) };
  const tokens = await scanTokens({ provider, net, netState, head, watchedBy, houseAddrs, detectedAt, maxBlocks });
  const native = await scanNative({ provider, net, state, head, watchedBy, houseAddrs, detectedAt });
  const errors = [...(tokens.error ? [`token logs: ${tokens.error}`] : []), ...native.errors];
  state.networks[net.network] = { ...netState, lastHead: head, lastError: errors[0] ?? null };
  return {
    result: { network: net.network, head, tokenWindow: tokens.window, receipts: tokens.rows.length + native.rows.length, gaps: native.gaps.length, errors },
    rows: [...tokens.rows, ...native.rows],
    gaps: native.gaps,
  };
};

/**
 * Scan one house. impure.
 * @param {string} house - the operator's wallet
 * @param {object} [opts]
 * @param {Array<object>} [opts.table] - the asset table (default: the pinned production table)
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {{ isEnabled: () => Promise<boolean> }} [opts.chainSettings]
 * @param {number} [opts.maxBlocks]
 * @returns {Promise<{ ok: true, appended: object[], networks: object[], watched: number, unwatched: object[] }
 *   | { ok: false, code: string, message: string }>}
 */
export const scanHouse = async (house, {
  table = MONEY_IN_ASSETS, env = process.env, chainSettings = defaultChainSettings, maxBlocks = MAX_BLOCKS_PER_SCAN,
} = {}) => {
  if (!ethers.isAddress(house)) return { ok: false, code: 'BAD_HOUSE', message: 'a house is an operator wallet address' };
  if (!(await chainSettings.isEnabled())) {
    return { ok: false, code: 'CHAIN_ACCESS_OFF', message: 'chain access is switched off — the money-in watch does not scan' };
  }
  const valid = validateAssetTable(table);
  if (!valid.ok) return { ok: false, code: 'BAD_ASSET_TABLE', message: valid.errors.join('; ') };
  return withHouseLock(house, async () => {
    const { watched, unwatched } = await houseWatchSet(house);
    const state = await readScanState(house);
    const at = new Date().toISOString();
    if (watched.length === 0) {
      await writeScanState(house, { ...state, lastScan: { at, networks: [], watched: 0 } });
      return { ok: true, appended: [], networks: [], watched: 0, unwatched };
    }
    const watchedBy = new Map(watched.map((w) => [lower(w.address), w]));
    const houseAddrs = new Set(watchedBy.keys());
    const networks = [];
    const rows = [];
    const gaps = [];
    for (const net of table) {
      const out = await scanNetwork({ net, state, watchedBy, houseAddrs, env, detectedAt: at, maxBlocks });
      networks.push(out.result);
      rows.push(...out.rows);
      gaps.push(...out.gaps);
    }
    const assetsByKey = new Map(table.flatMap((net) => net.assets.map((a) => [`${net.network}:${a.symbol}`, a])));
    const prices = rows.length ? await spotUsd([...new Set(rows.map((r) => assetsByKey.get(`${r.network}:${r.asset}`).priceId))]) : {};
    const priced = priceRows(rows, assetsByKey, prices, { priceAt: new Date().toISOString(), source: PRICE_SOURCE });
    // Receipts land before the cursor moves: a crash between the two
    // re-reads the window next scan, and the dedupe key absorbs the repeat.
    const appended = await appendReceipts(house, priced);
    const merged = mergeGaps(state.gaps, gaps);
    const newGaps = merged.length - state.gaps.length;
    await writeScanState(house, { ...state, gaps: merged, lastScan: { at, networks, watched: watched.length } });
    if (appended.length || newGaps) log.info('money in recorded', { house, appended: appended.length, gaps: newGaps });
    return { ok: true, appended, networks, watched: watched.length, unwatched };
  });
};
