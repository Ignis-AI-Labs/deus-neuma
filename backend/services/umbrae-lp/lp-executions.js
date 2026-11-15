import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ethers } from 'ethers';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';

const ACTIVE = new Set(['broadcast', 'unknown']);
const actionHash = (tx, asked) => crypto.createHash('sha256').update(JSON.stringify({
  asked, to: ethers.getAddress(tx.to),
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

const reconcile = async (neumaId, record, provider) => {
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
  if (!receipt) return record;
  const next = { ...record, state: Number(receipt.status) === 1 ? 'confirmed' : 'reverted', updatedAt: new Date().toISOString() };
  await write(neumaId, record.actionHash, next);
  return next;
};

export const guardLpExecution = async ({ neumaId, tx, asked, provider }) => {
  const hash = actionHash(tx, asked);
  const existing = await read(neumaId, hash);
  if (!existing) return { ok: true, actionHash: hash };
  const current = await reconcile(neumaId, existing, provider);
  if (ACTIVE.has(current.state)) return { ok: false, uncertain: true, txHash: current.hash, reason: 'This action has an unresolved broadcast. Reconcile its hash before retrying.' };
  return { ok: true, actionHash: hash };
};

export const recordLpBroadcast = async ({ neumaId, actionHash: hash, signed }) => {
  const transaction = ethers.Transaction.from(signed.signedTransaction);
  const record = {
    version: 1, actionHash: hash, hash: signed.hash, nonce: transaction.nonce,
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
