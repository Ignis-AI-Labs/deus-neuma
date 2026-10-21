/**
 * evm-rpc — the read verbs. Every function is read-only (no gas, no signing)
 * and returns a STRUCTURED RESULT, never a raw throw across the boundary:
 *
 *   { ok: true, ...payload }
 *   { ok: false, error: { code, message } }
 *
 * Error codes:
 *   CHAIN_UNKNOWN       — the chain key is not in the registry
 *   CHAIN_UNCONFIGURED  — the chain's RPC env URL is not set
 *   CHAIN_RPC           — the endpoint failed (down, rate-limited, reverted call)
 *   CHAIN_BAD_PARAMS    — address / hash / calldata / tokenId failed validation
 *   CHAIN_RANGE         — the requested log window exceeds the per-call cap
 *
 * Amounts are raw base units as decimal strings (wei, token base units) —
 * precision is the chain's truth, and a being applies decimals itself.
 *
 * impure (real RPC round trips through chain-registry's verified providers).
 */

import { ethers } from 'ethers';
import { chainEntry, isConfigured, providerFor, redactRpcUrl } from './chain-registry.js';

const coder = ethers.AbiCoder.defaultAbiCoder();

const ok = (payload) => Object.freeze({ ok: true, ...payload });
const fail = (code, message) => Object.freeze({ ok: false, error: Object.freeze({ code, message }) });

/** The per-call log window a caller gets without asking (blocks). */
export const DEFAULT_LOG_RANGE_CAP = 2_000;
/** The window no caller exceeds, however it asks (blocks). */
export const HARD_LOG_RANGE_CAP = 10_000;
/** At most this many logs ride one answer — the rest is a truthful flag. */
export const LOG_RESULT_CAP = 1_000;
/** At most this many Transfer events one holder reconstruction walks. */
export const HOLDER_EVENT_CAP = 50_000;

// Minimal ERC-20 surface, spoken as raw calldata selectors; balanceOf1155 is
// the ERC-1155 two-arg twin so multi-token contracts (the house's own Phase
// series) answer too. Selectors are COMPUTED, never transcribed — a hand-
// typed table once swapped totalSupply() (0x18160ddd) for totalSupply(uint256)
// (0xbd85b039) and the chain answered every probe with a revert.
const SELECTORS = Object.freeze({
  name: ethers.id('name()').slice(0, 10),
  symbol: ethers.id('symbol()').slice(0, 10),
  decimals: ethers.id('decimals()').slice(0, 10),
  totalSupply: ethers.id('totalSupply()').slice(0, 10),
  balanceOf: ethers.id('balanceOf(address)').slice(0, 10),
  balanceOf1155: ethers.id('balanceOf(address,uint256)').slice(0, 10),
});

const TRANSFER_20 = ethers.id('Transfer(address,address,uint256)');
const TRANSFER_SINGLE = ethers.id('TransferSingle(address,address,address,uint256,uint256)');
const TRANSFER_BATCH = ethers.id('TransferBatch(address,address,address,uint256[],uint256[])');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ── Validators (pure, exported so the boundary layers share them) ───────────

/** 0x-prefixed even-length hex (empty payload allowed). Pure. */
export const isValidHexData = (s) => typeof s === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(s);

/** 0x-prefixed 32-byte hex — a tx hash, a topic0. Pure. */
export const isValidBytes32 = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{64}$/.test(s);

/**
 * A block tag: 'latest' (default), 'finalized', or a non-negative integer
 * (number or decimal string). Returns the normalized tag, or null when
 * invalid. Pure.
 */
export const parseBlockTag = (tag) => {
  if (tag === undefined || tag === null || tag === 'latest') return 'latest';
  if (tag === 'finalized') return 'finalized';
  return parseBlockNumber(tag) === null ? null : parseBlockNumber(tag);
};

/**
 * A block number: a non-negative safe integer, as a number or decimal
 * string. Returns the number, or null when invalid. Pure.
 */
export const parseBlockNumber = (value) => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
};

/** A token id: non-negative integer as number, bigint, decimal or 0x-hex string → bigint, else null. Pure. */
export const parseTokenId = (value) => {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  return null;
};

// ── The provider gate every verb crosses ────────────────────────────────────

const providerOrFail = async (chain) => {
  const c = chainEntry(chain);
  if (!c) return { error: fail('CHAIN_UNKNOWN', `unknown chain "${chain}" — one of: ethereum, ethereum-sepolia, base, base-sepolia`) };
  if (!isConfigured(chain)) return { error: fail('CHAIN_UNCONFIGURED', `${chain} has no RPC configured (${c.envName} unset) — your operator saves its RPC address in Settings → API (or sets it in the env file); a free RPC URL comes from https://dashboard.alchemy.com/ or https://developer.metamask.io/ (public endpoints: https://chainlist.org/)`) };
  const provider = await providerFor(chain);
  if (!provider) return { error: fail('CHAIN_RPC', `${chain} RPC is not answering, or answered for the wrong network — see the platform log`) };
  return { entry: c, provider };
};

const basePayload = (entry) => ({ chain: entry.key, chainId: entry.chainId });

// ── Token metadata decoding ─────────────────────────────────────────────────

// A field a contract does not implement reads as null, never as a failed
// call — partial metadata is the honest shape of a bare ERC-1155. But the
// distinction is load-bearing: a REVERT (CALL_EXCEPTION) is the contract
// saying "not implemented", while a rate limit or a dropped connection is
// the ENDPOINT failing. Swallowing the second into null would fake absent
// metadata out of a sick RPC — the explorer-404 lie this module exists to
// kill — so only reverts read as null; everything else fails the read.
const callOrNull = async (provider, to, data) => {
  try {
    const result = await provider.call({ to, data });
    return result && result !== '0x' ? result : null;
  } catch (err) {
    if (err.code === 'CALL_EXCEPTION') return null;
    throw err;
  }
};

// ERC-20 name/symbol come back as an ABI string on most contracts and as a
// raw bytes32 on the old-school ones — both decode, or the field is null.
const decodeStringField = (hex) => {
  if (!hex) return null;
  try { return coder.decode(['string'], hex)[0]; } catch { /* not an ABI string */ }
  try { return ethers.decodeBytes32String(hex); } catch { return null; }
};

const decodeUintField = (hex) => {
  if (!hex) return null;
  try { return coder.decode(['uint256'], hex)[0].toString(); } catch { return null; }
};

// ── Serializers (RPC objects → JSON-safe plain data; bigints as strings) ────

const serializeLog = (l) => ({
  address: l.address,
  blockNumber: l.blockNumber,
  transactionHash: l.transactionHash,
  logIndex: l.index,
  topics: [...l.topics],
  data: l.data,
});

const serializeTransaction = (tx) => ({
  hash: tx.hash,
  blockHash: tx.blockHash,
  blockNumber: tx.blockNumber,
  from: tx.from,
  to: tx.to,
  value: tx.value.toString(),
  nonce: tx.nonce,
  gasLimit: tx.gasLimit.toString(),
  gasPrice: tx.gasPrice === null || tx.gasPrice === undefined ? null : tx.gasPrice.toString(),
  maxFeePerGas: tx.maxFeePerGas === null || tx.maxFeePerGas === undefined ? null : tx.maxFeePerGas.toString(),
  maxPriorityFeePerGas: tx.maxPriorityFeePerGas === null || tx.maxPriorityFeePerGas === undefined ? null : tx.maxPriorityFeePerGas.toString(),
  data: tx.data,
  type: tx.type,
  chainId: Number(tx.chainId),
});

const serializeReceipt = (r) => ({
  hash: r.hash,
  blockHash: r.blockHash,
  blockNumber: r.blockNumber,
  status: r.status,
  from: r.from,
  to: r.to,
  contractAddress: r.contractAddress,
  gasUsed: r.gasUsed.toString(),
  gasPrice: r.gasPrice === null || r.gasPrice === undefined ? null : r.gasPrice.toString(),
  logs: r.logs.map(serializeLog),
});

const serializeBlock = (b) => ({
  number: b.number,
  hash: b.hash,
  parentHash: b.parentHash,
  timestamp: b.timestamp,
  gasUsed: b.gasUsed.toString(),
  gasLimit: b.gasLimit.toString(),
  baseFeePerGas: b.baseFeePerGas === null || b.baseFeePerGas === undefined ? null : b.baseFeePerGas.toString(),
  transactionCount: b.transactions.length,
});

// ── The verbs ───────────────────────────────────────────────────────────────

/** Native balance at latest. @returns {{ok:true, wei:string}|{ok:false,error}} */
export const nativeBalance = async (chain, address) => {
  if (!ethers.isAddress(address)) return fail('CHAIN_BAD_PARAMS', `not an EVM address: ${String(address)}`);
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    const wei = await gate.provider.getBalance(address);
    return ok({ ...basePayload(gate.entry), address: ethers.getAddress(address), wei: wei.toString() });
  } catch (err) {
    return fail('CHAIN_RPC', redactRpcUrl(err.message));
  }
};

/**
 * ERC-20 metadata: name, symbol, decimals, totalSupply (raw base units,
 * decimal string). Fields the contract does not implement are null — an
 * ERC-1155 answers totalSupply and leaves decimals null.
 */
export const tokenMeta = async (chain, token) => {
  if (!ethers.isAddress(token)) return fail('CHAIN_BAD_PARAMS', `not an EVM address: ${String(token)}`);
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    const code = await gate.provider.getCode(token);
    if (code === '0x') return fail('CHAIN_BAD_PARAMS', `no contract code at ${token} on ${chain} — an EOA has no metadata`);
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      callOrNull(gate.provider, token, SELECTORS.name).then(decodeStringField),
      callOrNull(gate.provider, token, SELECTORS.symbol).then(decodeStringField),
      callOrNull(gate.provider, token, SELECTORS.decimals)
        .then((hex) => (decodeUintField(hex) === null ? null : Number(decodeUintField(hex)))),
      callOrNull(gate.provider, token, SELECTORS.totalSupply).then(decodeUintField),
    ]);
    return ok({ ...basePayload(gate.entry), token: ethers.getAddress(token), name, symbol, decimals, totalSupply });
  } catch (err) {
    return fail('CHAIN_RPC', redactRpcUrl(err.message));
  }
};

/**
 * Token balance in raw base units. ERC-20 balanceOf(address) by default;
 * pass tokenId for the ERC-1155 balanceOf(address,uint256).
 */
export const tokenBalance = async (chain, token, address, tokenId) => {
  if (!ethers.isAddress(token)) return fail('CHAIN_BAD_PARAMS', `token is not an EVM address: ${String(token)}`);
  if (!ethers.isAddress(address)) return fail('CHAIN_BAD_PARAMS', `address is not an EVM address: ${String(address)}`);
  let data;
  let id;
  if (tokenId === undefined || tokenId === null) {
    data = ethers.concat([SELECTORS.balanceOf, coder.encode(['address'], [address])]);
  } else {
    id = parseTokenId(tokenId);
    if (id === null) return fail('CHAIN_BAD_PARAMS', 'tokenId must be a non-negative integer (decimal or 0x-hex)');
    data = ethers.concat([SELECTORS.balanceOf1155, coder.encode(['address', 'uint256'], [address, id])]);
  }
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    const raw = await gate.provider.call({ to: token, data });
    const balance = coder.decode(['uint256'], raw)[0].toString();
    return ok({
      ...basePayload(gate.entry), token: ethers.getAddress(token), address: ethers.getAddress(address),
      ...(id === undefined ? {} : { tokenId: id.toString() }), balance,
    });
  } catch (err) {
    return fail('CHAIN_RPC', `balanceOf call failed — the contract may not implement this shape (a revert reads here): ${redactRpcUrl(err.message)}`);
  }
};

/** Raw eth_call: {to, data, blockTag?}. Returns the raw hex result. */
export const callContract = async (chain, { to, data, blockTag } = {}) => {
  if (!ethers.isAddress(to)) return fail('CHAIN_BAD_PARAMS', `to is not an EVM address: ${String(to)}`);
  if (!isValidHexData(data)) return fail('CHAIN_BAD_PARAMS', 'data must be 0x-prefixed even-length hex (ABI-encoded calldata)');
  const tag = parseBlockTag(blockTag);
  if (tag === null) return fail('CHAIN_BAD_PARAMS', 'blockTag must be "latest", "finalized", or a block number');
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    const result = await gate.provider.call({ to, data }, tag);
    return ok({ ...basePayload(gate.entry), to: ethers.getAddress(to), blockTag: tag, result });
  } catch (err) {
    return fail('CHAIN_RPC', redactRpcUrl(err.message));
  }
};

/** One transaction by hash; transaction is null when the chain has never seen it. */
export const getTransaction = async (chain, hash) => {
  if (!isValidBytes32(hash)) return fail('CHAIN_BAD_PARAMS', `not a transaction hash (0x + 64 hex): ${String(hash)}`);
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    const tx = await gate.provider.getTransaction(hash);
    return ok({ ...basePayload(gate.entry), hash, transaction: tx ? serializeTransaction(tx) : null });
  } catch (err) {
    return fail('CHAIN_RPC', redactRpcUrl(err.message));
  }
};

/** One receipt by hash; receipt is null when the chain has never seen it. */
export const getTransactionReceipt = async (chain, hash) => {
  if (!isValidBytes32(hash)) return fail('CHAIN_BAD_PARAMS', `not a transaction hash (0x + 64 hex): ${String(hash)}`);
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    const receipt = await gate.provider.getTransactionReceipt(hash);
    return ok({ ...basePayload(gate.entry), hash, receipt: receipt ? serializeReceipt(receipt) : null });
  } catch (err) {
    return fail('CHAIN_RPC', redactRpcUrl(err.message));
  }
};

/** One block by tag ('latest' | 'finalized' | number); block is null when absent. */
export const getBlock = async (chain, tag) => {
  const parsed = parseBlockTag(tag);
  if (parsed === null) return fail('CHAIN_BAD_PARAMS', 'block tag must be "latest", "finalized", or a block number');
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    const block = await gate.provider.getBlock(parsed);
    return ok({ ...basePayload(gate.entry), blockTag: parsed, block: block ? serializeBlock(block) : null });
  } catch (err) {
    return fail('CHAIN_RPC', redactRpcUrl(err.message));
  }
};

/**
 * Event logs for one contract over ONE bounded window: fromBlock/toBlock are
 * block numbers (toBlock may be 'latest'), and the span may not exceed
 * rangeCap (default 2,000, never over 10,000) — long walks chunk through
 * tokenHolders, not through a widened single call. At most 1,000 logs ride
 * one answer; the rest is a truthful `truncated`.
 */
export const getLogs = async (chain, { address, topic0, fromBlock, toBlock, rangeCap } = {}) => {
  if (!ethers.isAddress(address)) return fail('CHAIN_BAD_PARAMS', `address is not an EVM address: ${String(address)}`);
  if (topic0 !== undefined && topic0 !== null && !isValidBytes32(topic0)) {
    return fail('CHAIN_BAD_PARAMS', `topic0 must be the 0x-prefixed keccak event signature (0x + 64 hex): ${String(topic0)}`);
  }
  const from = parseBlockNumber(fromBlock);
  if (from === null) return fail('CHAIN_BAD_PARAMS', 'fromBlock must be a block number');
  let cap = DEFAULT_LOG_RANGE_CAP;
  if (rangeCap !== undefined && rangeCap !== null) {
    cap = parseBlockNumber(rangeCap) ?? -1;
    if (cap < 1) return fail('CHAIN_BAD_PARAMS', 'rangeCap must be a positive block count');
    if (cap > HARD_LOG_RANGE_CAP) cap = HARD_LOG_RANGE_CAP;
  }
  // Everything decidable without the wire is judged BEFORE the provider gate
  // — bad params never touch the RPC, so a misconfigured chain and a
  // malformed window read as DIFFERENT refusals, not whichever came first.
  const toKnown = toBlock !== 'latest';
  let to = null;
  if (toKnown) {
    to = parseBlockNumber(toBlock);
    if (to === null) return fail('CHAIN_BAD_PARAMS', 'toBlock must be a block number or "latest"');
    if (to < from) return fail('CHAIN_BAD_PARAMS', `toBlock (${to}) is below fromBlock (${from})`);
    const span = to - from + 1;
    if (span > cap) {
      return fail('CHAIN_RANGE', `the window ${from}–${to} spans ${span} blocks; the per-call cap is ${cap} — narrow the window or walk in chunks`);
    }
  }
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    if (!toKnown) {
      to = await gate.provider.getBlockNumber();
      const span = to - from + 1;
      if (span > cap) {
        return fail('CHAIN_RANGE', `the window ${from}–${to} (latest) spans ${span} blocks; the per-call cap is ${cap} — narrow the window or walk in chunks`);
      }
    }
    const logs = await gate.provider.getLogs({ address, topics: topic0 ? [topic0] : [], fromBlock: from, toBlock: to });
    const truncated = logs.length > LOG_RESULT_CAP;
    return ok({
      ...basePayload(gate.entry), address: ethers.getAddress(address), fromBlock: from, toBlock: to,
      logs: (truncated ? logs.slice(0, LOG_RESULT_CAP) : logs).map(serializeLog), truncated,
    });
  } catch (err) {
    return fail('CHAIN_RPC', redactRpcUrl(err.message));
  }
};

// A 32-byte topic holding an address decodes by dropping the padding.
const topicAddress = (topic) => ethers.getAddress(`0x${topic.slice(26)}`);

// Mint = from zero (credit), burn = to zero (debit); a real wallet move is both.
const applyTransfer = (balances, from, to, value) => {
  if (from !== ZERO_ADDRESS) balances.set(from, (balances.get(from) ?? 0n) - value);
  if (to !== ZERO_ADDRESS) balances.set(to, (balances.get(to) ?? 0n) + value);
};

/**
 * Holder reconstruction, bounded: chunked log walks over the Transfer-family
 * topics (ERC-20, ERC-721 as count semantics, ERC-1155 TransferSingle/Batch
 * summed over all ids), from fromBlock (default 0 — pass the deployment
 * block, or balances are relative to the window) to the latest block. The
 * walk stops with `truncated: true` when the event cap bites, so a partial
 * set is always labelled partial.
 */
export const tokenHolders = async (chain, token, { fromBlock, chunkSize } = {}) => {
  if (!ethers.isAddress(token)) return fail('CHAIN_BAD_PARAMS', `token is not an EVM address: ${String(token)}`);
  const start = fromBlock === undefined || fromBlock === null ? 0 : parseBlockNumber(fromBlock);
  if (start === null) return fail('CHAIN_BAD_PARAMS', 'fromBlock must be a block number');
  let chunk = chunkSize === undefined || chunkSize === null ? DEFAULT_LOG_RANGE_CAP : parseBlockNumber(chunkSize);
  if (chunk === null || chunk < 1) return fail('CHAIN_BAD_PARAMS', 'chunkSize must be a positive block count');
  if (chunk > HARD_LOG_RANGE_CAP) chunk = HARD_LOG_RANGE_CAP;
  const gate = await providerOrFail(chain);
  if (gate.error) return gate.error;
  try {
    const latest = await gate.provider.getBlockNumber();
    const balances = new Map();
    let events = 0;
    let truncated = false;
    for (let from = start; from <= latest && !truncated; from += chunk) {
      const to = Math.min(from + chunk - 1, latest);
      let logs;
      try {
        logs = await gate.provider.getLogs({
          address: token, topics: [[TRANSFER_20, TRANSFER_SINGLE, TRANSFER_BATCH]], fromBlock: from, toBlock: to,
        });
      } catch (err) {
        return fail('CHAIN_RPC', `log walk failed in window ${from}–${to}: ${redactRpcUrl(err.message)}`);
      }
      events += logs.length;
      if (events > HOLDER_EVENT_CAP) { truncated = true; break; }
      for (const l of logs) {
        const t0 = l.topics[0];
        if (t0 === TRANSFER_SINGLE) {
          const [, value] = coder.decode(['uint256', 'uint256'], l.data);
          applyTransfer(balances, topicAddress(l.topics[2]), topicAddress(l.topics[3]), value);
        } else if (t0 === TRANSFER_BATCH) {
          const [, values] = coder.decode(['uint256[]', 'uint256[]'], l.data);
          const total = values.reduce((sum, v) => sum + v, 0n);
          applyTransfer(balances, topicAddress(l.topics[2]), topicAddress(l.topics[3]), total);
        } else {
          // ERC-20 keeps the value in data; ERC-721 indexes the tokenId and
          // leaves data empty — one token moved, count semantics.
          applyTransfer(balances, topicAddress(l.topics[1]), topicAddress(l.topics[2]), l.data === '0x' ? 1n : BigInt(l.data));
        }
      }
    }
    const holders = {};
    let totalHeld = 0n;
    for (const [address, balance] of balances) {
      if (balance === 0n) continue;
      holders[address] = balance.toString();
      totalHeld += balance;
    }
    return ok({
      ...basePayload(gate.entry), token: ethers.getAddress(token),
      fromBlock: start, toBlock: latest, chunkSize: chunk,
      events, truncated, holderCount: Object.keys(holders).length, holders, totalHeld: totalHeld.toString(),
    });
  } catch (err) {
    return fail('CHAIN_RPC', redactRpcUrl(err.message));
  }
};
