import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ethers } from 'ethers';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { proveLpReceipt } from './lp-receipt-proof.js';
import { lpWalletAddress } from './lp-wallet.js';

const ACTIVE = new Set(['broadcast', 'unknown']);
const VOLATILE_QUOTE_FIELDS = new Set([
  'activeIdDesired', 'amountOutMin', 'amountXMin', 'amountYMin', 'baseFactor',
  'bidAskRatio', 'centerBinId', 'idSlippage', 'minTotalLiquidity', 'skipActiveBin',
]);
export const actionHash = (tx, asked) => crypto.createHash('sha256').update(JSON.stringify({
  asked: Object.fromEntries(Object.entries(asked).filter(([key]) => !VOLATILE_QUOTE_FIELDS.has(key))),
  to: ethers.getAddress(tx.to),
})).digest('hex');
const fileFor = (neumaId, hash) => path.join(neumaWorkspace._path(neumaId), 'config', 'lp-executions', `${hash}.json`);

const read = async (neumaId, hash) => {
  try {
    return await neumaWorkspace._readTrustedJSON(fileFor(neumaId, hash));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const write = (neumaId, hash, record) => neumaWorkspace._writeJSON(fileFor(neumaId, hash), record);

export const UNKNOWN_DROPPED_AFTER_MS = 15 * 60 * 1000;

// impure — only an old, missing receipt whose account nonce has moved on may be dropped.
const dropIfStale = async (neumaId, record, provider) => {
  if (record.state !== 'unknown' || !Number.isSafeInteger(record.nonce)) return record;
  const updatedMs = Date.parse(record.updatedAt ?? record.signedAt ?? '');
  if (!Number.isFinite(updatedMs) || Date.now() - updatedMs < UNKNOWN_DROPPED_AFTER_MS) return record;
  const from = record.from ?? await lpWalletAddress(neumaId).catch(() => null);
  if (!ethers.isAddress(from)) return record;
  let latestNonce;
  try {
    latestNonce = Number(BigInt(await provider.send('eth_getTransactionCount', [ethers.getAddress(from), 'latest'])));
  } catch {
    return record;
  }
  if (!Number.isSafeInteger(latestNonce) || latestNonce <= record.nonce) return record;
  const next = { ...record, from: ethers.getAddress(from), state: 'dropped', updatedAt: new Date().toISOString() };
  await write(neumaId, record.actionHash, next);
  return next;
};

const reconcile = async (neumaId, record, provider, secondary, minConfirmations) => {
  if (!ACTIVE.has(record.state)) return record;
  let receipt;
  try {
    receipt = await provider.send('eth_getTransactionReceipt', [record.hash]);
  } catch {
    if (record.state !== 'unknown') {
      record = { ...record, state: 'unknown', updatedAt: new Date().toISOString() };
      await write(neumaId, record.actionHash, record);
    }
    return record;
  }
  if (!receipt) return dropIfStale(neumaId, record, provider);
  const proof = Number(receipt.status) === 1
    ? await proveLpReceipt({ primary: provider, secondary, minConfirmations, timeoutMs: 120000, hash: record.hash })
    : { ok: false };
  const next = { ...record, state: proof.ok ? 'confirmed' : Number(receipt.status) === 1 ? 'unknown' : 'reverted', updatedAt: new Date().toISOString() };
  await write(neumaId, record.actionHash, next);
  return next;
};

export const guardLpExecution = async ({ neumaId, tx, asked, provider, secondary, minConfirmations }) => {
  const hash = actionHash(tx, asked);
  const existing = await read(neumaId, hash);
  if (!existing) return { ok: true, actionHash: hash };
  const current = await reconcile(neumaId, existing, provider, secondary, minConfirmations);
  if (ACTIVE.has(current.state)) return { ok: false, uncertain: true, txHash: current.hash, reason: 'This action has an unresolved broadcast. Reconcile its hash before retrying.' };
  return { ok: true, actionHash: hash };
};

export const recordLpBroadcast = async ({ neumaId, actionHash: hash, signed }) => {
  const transaction = ethers.Transaction.from(signed.signedTransaction);
  const record = {
    version: 2, actionHash: hash, hash: signed.hash, nonce: transaction.nonce,
    from: ethers.getAddress(transaction.from), chainId: Number(transaction.chainId),
    state: 'broadcast', signedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const file = fileFor(neumaId, hash);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  await neumaWorkspace._writeJSON(temp, record);
  try {
    await fs.link(temp, file);
    return { ok: true };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const current = await read(neumaId, hash);
    if (current && ACTIVE.has(current.state)) return { ok: false, uncertain: true, txHash: current.hash, reason: 'This action is already broadcasting in another process.' };
    await write(neumaId, hash, record);
    return { ok: true };
  } finally {
    await fs.rm(temp, { force: true });
  }
};

export const settleLpExecution = async ({ neumaId, actionHash: hash, state }) => {
  const current = await read(neumaId, hash);
  if (!current) throw new Error('LP execution record is missing');
  await write(neumaId, hash, { ...current, state, updatedAt: new Date().toISOString() });
};
