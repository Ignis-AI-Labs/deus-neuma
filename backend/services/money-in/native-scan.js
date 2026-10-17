// Native ETH receipts — the honest, cheap approach the plain RPC allows.
//
// An EOA's inbound ETH leaves no log, and no standard RPC lists […]. What the RPC CAN answer exactly is an address's balance and
// nonce at any block. So each watched address keeps a CHECKPOINT
// {block, wei, nonce}, and a scan works like this:
//
//   1. read balance + nonce at the new head. Unchanged (both) ⇒ nothing
//      happened — two RPC calls, done.
//   2. otherwise BISECT the window: a half whose ends agree on balance AND
//      nonce saw no change (no sends, so no rise could be hidden by a fall);
//      a half that differs is split again, down to single blocks.
//   3. at each changed block, read the block's transactions and record every
//      successful top-level tx whose `to` is the address and whose value is
//      above zero — the amount is the tx's own value, exact.
//   4. cross-check: when the nonce did not move in that block (we sent
//      nothing), the balance rise must equal what those txs explain. A rise
//      they do not explain is written as a GAP — block, exact delta, what was
//      explained — never as a guessed receipt.
//
// BLIND SPOTS (named, and surfaced as gaps rather than hidden):
//   - ETH that arrives by an INTERNAL call (a Safe or other contract wallet
//     paying out, an exchange's batch-withdrawal contract, a self-destruct)
//     has no top-level tx to us: it shows as a gap with its exact amount but
//     no receipt row, until the operator records it by hand elsewhere.
//   - in a block where the address ALSO sent (nonce moved), the cross-check
//     cannot run, so an internal receipt in that same block is invisible.
//   - bisection reads historical state; a node that prunes old state cannot
//     answer. A failed read keeps the checkpoint where it was (a passing
//     outage is retried next scan); after FAILURES_BEFORE_GAP failures in a
//     row the unread window becomes one gap with its exact net change and
//     watching resumes at the head.
//   - watching starts at the first scan's head: nothing earlier is counted.
//
// The work is bounded (RPC_BUDGET calls per address per scan). When the
// budget runs out mid-window, the checkpoint advances only to the last
// state fully resolved, and the next scan carries on from there.
//
// impure (RPC through the caller's chain-registry provider).

import { redactRpcUrl } from '../chain/chain-registry.js';

/** RPC calls one address may spend in one scan. */
export const RPC_BUDGET = 400;
/** Consecutive failed scans of one window before it is written off as a gap. */
export const FAILURES_BEFORE_GAP = 3;

const stateAt = async (provider, address, block) => {
  const [wei, nonce] = await Promise.all([
    provider.getBalance(address, block),
    provider.getTransactionCount(address, block),
  ]);
  return { block, wei: wei.toString(), nonce };
};

const sameState = (a, b) => a.wei === b.wei && a.nonce === b.nonce;

// impure — the receipts of one changed block, and its cross-check gap.
const resolveBlock = async (ctx, before, after) => {
  const block = await ctx.provider.getBlock(after.block, true);
  ctx.calls += 1;
  const lower = ctx.address.toLowerCase();
  const candidates = (block?.prefetchedTransactions || [])
    .filter((tx) => tx.to && tx.to.toLowerCase() === lower && tx.value > 0n);
  let explained = 0n;
  // Collected apart and committed together: a read that fails halfway
  // through a block must not leave half its receipts behind.
  const found = [];
  for (const tx of candidates) {
    const receipt = await ctx.provider.getTransactionReceipt(tx.hash);
    ctx.calls += 1;
    if (receipt?.status !== 1) continue; // a reverted tx moved no value
    explained += tx.value;
    found.push({
      from: tx.from, amountRaw: tx.value.toString(), block: after.block,
      timestamp: block.timestamp, txHash: tx.hash, logIndex: null,
    });
  }
  ctx.receipts.push(...found);
  const delta = BigInt(after.wei) - BigInt(before.wei);
  if (before.nonce === after.nonce && delta !== explained) {
    ctx.gaps.push({
      kind: 'native-unexplained', fromBlock: after.block, toBlock: after.block,
      deltaWei: delta.toString(), explainedWei: explained.toString(),
      reason: 'balance changed by more than the top-level transfers in this block explain (an internal transfer, a contract payout, or a self-destruct)',
    });
  }
};

// impure — in-order bisection, so `resolved` only ever moves forward.
const bisect = async (ctx, lo, hi) => {
  if (sameState(lo, hi)) { ctx.resolved = hi; return; }
  if (hi.block - lo.block === 1) {
    await resolveBlock(ctx, lo, hi);
    ctx.resolved = hi;
    return;
  }
  if (ctx.calls + 2 > RPC_BUDGET) { ctx.exhausted = true; return; }
  const mid = await stateAt(ctx.provider, ctx.address, lo.block + Math.floor((hi.block - lo.block) / 2));
  ctx.calls += 2;
  await bisect(ctx, lo, mid);
  if (ctx.exhausted) return;
  await bisect(ctx, mid, hi);
};

/**
 * Scan one address's native receipts from its checkpoint to `head`. impure.
 * @param {object} args
 * @param {import('ethers').JsonRpcProvider} args.provider
 * @param {string} args.address
 * @param {{block: number, wei: string, nonce: number}|null} args.checkpoint
 * @param {number} args.head
 * @returns {Promise<{ checkpoint: object, receipts: object[], gaps: object[], exhausted: boolean, error: string|null }>}
 */
export const scanNativeReceipts = async ({ provider, address, checkpoint, head }) => {
  try {
    if (!checkpoint) {
      // First sight: watching begins here; nothing before it is counted.
      return { checkpoint: await stateAt(provider, address, head), receipts: [], gaps: [], exhausted: false, error: null };
    }
    if (head <= checkpoint.block) return { checkpoint, receipts: [], gaps: [], exhausted: false, error: null };
    const atHead = await stateAt(provider, address, head);
    const ctx = { provider, address, calls: 2, receipts: [], gaps: [], resolved: checkpoint, exhausted: false };
    try {
      await bisect(ctx, checkpoint, atHead);
    } catch (err) {
      const message = redactRpcUrl(err.message);
      const failures = (ctx.resolved.failures ?? 0) + 1;
      if (failures < FAILURES_BEFORE_GAP) {
        return { checkpoint: { ...ctx.resolved, failures }, receipts: ctx.receipts, gaps: ctx.gaps, exhausted: false, error: message };
      }
      return {
        checkpoint: atHead, receipts: ctx.receipts, exhausted: false, error: message,
        gaps: [...ctx.gaps, {
          kind: 'native-unreadable', fromBlock: ctx.resolved.block + 1, toBlock: head,
          deltaWei: (BigInt(atHead.wei) - BigInt(ctx.resolved.wei)).toString(), explainedWei: '0',
          reason: `the node could not answer the window's balance reads ${failures} scans in a row (${message})`,
        }],
      };
    }
    return { checkpoint: ctx.resolved, receipts: ctx.receipts, gaps: ctx.gaps, exhausted: ctx.exhausted, error: null };
  } catch (err) {
    return { checkpoint, receipts: [], gaps: [], exhausted: false, error: redactRpcUrl(err.message) };
  }
};
