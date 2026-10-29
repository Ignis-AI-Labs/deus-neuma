// The Quaestor's READ — treasury_board, the house's money whole, for the
// house's seated CFO alone (money is the office's to oversee; another being
// reads its own wallet through wallet_view). Advertised to the seat and
// re-verified on every call. The office's ACTS (review, flag) are intents
// (intents/treasury-acts.js). Nothing here can move money.

import { gateAct } from '../act-gate.js';
import { cfoDesignation } from './cfo-designation.js';
import { readTreasuryBoard } from './treasury-board.js';

export const TREASURY_BOARD_TOOL = Object.freeze({
  name: 'treasury_board',
  server: 'treasury',
  description: 'QUAESTOR ONLY. Read the house\'s money whole — no args: every wallet (yours, the operator\'s, every being\'s) with its balance on Base and Ethereum read live, every pending spend (with the ids treasury/review takes), the spend history with each being\'s reason, money in, the campaigns\' planning budgets, what the cost meter reads, open flags, and the treasury flight check. Read-only: you hold no key and sign nothing.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

/** Does a parsed call target the treasury office? Pure. */
export const isTreasuryTool = (match) => match?.toolName === TREASURY_BOARD_TOOL.name
  || String(match?.tool || '').replace(/^treasury\//, '') === TREASURY_BOARD_TOOL.name;

/** The read rides with the seated Quaestor alone. impure. */
export const treasuryToolsFor = async (connection) => {
  const laneId = connection.companion?.neumaId;
  if (!laneId) return [];
  return (await cfoDesignation.holds(connection.walletAddress, laneId).catch(() => false)) ? [TREASURY_BOARD_TOOL] : [];
};

const eth = (v) => (v === null || v === undefined ? 'unread' : `${v} ETH`);

/**
 * The board as the office reads it. Pure.
 * @param {object} board - readTreasuryBoard's
 */
export const boardText = (board) => [
  `Read ${board.readAt}. Seat: ${board.seat ? `${board.seat.name || board.seat.laneId} (Quaestor)` : 'EMPTY'}.`,
  '',
  'WALLETS (Base · Ethereum):',
  ...board.wallets.map((w) => `- ${w.kind === 'operator' ? 'the operator' : (w.name || w.neumaId)} ${w.address || '(no wallet)'}: ${eth(w.balances.base)} · ${eth(w.balances.ethereum)}`
    + (w.kind === 'being' ? ` — sends without a signature up to ${w.thresholdEth} ETH; ${w.recipients.length} approved recipient(s); key ${w.custody}` : '')),
  '',
  `PENDING SPENDS (${board.pending.length}) — each waits on the operator's own signature:`,
  ...(board.pending.length ? board.pending.map((c) => `- [${c.neumaId} · ${c.id}] ${c.amount} ${c.asset} on ${c.chain} to ${c.recipient.address}${c.recipient.label ? ` (${c.recipient.label})` : ''}`
    + `${c.recipient.firstTime ? ' FIRST TIME' : ` (${c.recipient.priorSends} before)`}${c.recipient.standing === 'removed' ? ' RECIPIENT REMOVED' : ''}`
    + ` — from ${eth(c.from.balanceEth)}, after ${eth(c.from.balanceAfterEth)}; expires ${c.expiresAt}`
    + ` — reason: ${c.reason ? `"${c.reason}"` : 'none given'}${c.review ? ` — your review: ${c.review.recommend}` : ' — NOT YET REVIEWED'}`) : ['- none']),
  '',
  `HISTORY (latest ${Math.min(board.history.length, 20)} of ${board.history.length}):`,
  ...board.history.slice(0, 20).map((h) => `- ${h.resolvedAt || h.requestedAt} ${h.name || h.neumaId}: ${h.status}${h.autonomous ? ' (under its threshold)' : ''} ${h.amount} ${h.asset} to ${h.to}`
    + `${h.reason ? ` — "${h.reason}"` : ''}${h.note ? ` — operator: "${h.note}"` : ''}${h.txHash ? ` — tx ${h.txHash}` : ''}`),
  '',
  `MONEY IN: ${board.moneyIn.count} receipt(s); ${Object.values(board.moneyIn.perAsset).map((a) => `${a.amount} ${a.asset} on ${a.network}`).join(', ') || 'nothing received yet'}${board.moneyIn.unpriced ? ` (${board.moneyIn.unpriced} unpriced)` : ''}.`,
  `BUDGETS (planning, never spent by anyone): ${board.budgets.map((b) => `${b.name}: ${b.money ?? '—'} money, ${b.hours ?? '—'} hours`).join('; ') || 'none set'}.`,
  `COSTS: GPU drawing ${board.costs.gpuPowerW ?? 'unread'} W now. Not measured yet: ${board.costs.missing.join('; ')}.`,
  `FLAGS OPEN: ${board.flags.map((f) => `[${f.id}] ${f.title}`).join('; ') || 'none'}.`,
  '',
  'FLIGHT CHECK:',
  ...board.marks.map((m) => `- ${m.label}: ${m.state.toUpperCase()} — ${m.line}`),
  ...(board.gaps.length ? ['', `NOT READ: ${board.gaps.map((g) => g.part).join(', ')}`] : []),
].join('\n');

/** Execute the treasury read through the one act gate. impure. */
export const handleTreasuryTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports = {}) => {
  const toolId = `treasury/${TREASURY_BOARD_TOOL.name}`;
  const send = (event) => ports.sendToolEvent?.(ws, connection.companion, event);
  const gate = await gateAct(connection, {
    server: 'treasury', tool: TREASURY_BOARD_TOOL.name, args, lanePolicy: neumaPolicy, mode: toolMode, emit: send,
  });
  if (!gate.ok) return gate.result;
  try {
    if (!(await cfoDesignation.holds(connection.walletAddress, connection.companion?.neumaId).catch(() => false))) {
      throw new Error('treasury_board is the seated Quaestor\'s — another being reads its own wallet with wallet_view');
    }
    const board = await readTreasuryBoard(connection.walletAddress);
    send({ tool: toolId, status: 'ok', summary: `${board.wallets.length} wallets · ${board.pending.length} pending` });
    return { tool: toolId, status: 'ok', content: boardText(board) };
  } catch (error) {
    send({ tool: toolId, status: 'error', summary: 'treasury_board — failed' });
    return { tool: toolId, status: 'error', error: error.message };
  }
};
