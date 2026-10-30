// The LOGISTA OFFICE briefing — what the house's seated Logista reads at the
// top of every turn: each company's year to date, the receipts no company has
// booked yet, the deadlines falling due within sixty days (a CPA's marked),
// and the office's law. Every other lane receives '' (the empty-string law).
// impure (store reads); the text is pure.

import { caoDesignation } from './cao-designation.js';
import { accountsBoard } from './accounts-board.js';
import { upcoming } from './books-shape.js';
import { createLogger } from '../logger.js';

const log = createLogger('Accounts.Briefing');
const LIST_CAP = 12;

const money = (currencies) => Object.entries(currencies).map(([c, v]) => `${c} in ${v.in} · out ${v.out} · net ${v.net}`).join('; ') || 'nothing booked';

/** pure — the briefing text. @param {Awaited<ReturnType<typeof accountsBoard>>} board @param {number} nowMs */
export const logistaBriefingText = (board, nowMs) => {
  const due = board.books.flatMap((b) => upcoming(b.deadlines, nowMs).map((d) => ({ ...d, company: b })));
  return [
    '## LOGISTA OFFICE — the books, every dollar matched to its receipt',
    ...(board.books.length ? board.books.map((b) => `- ${b.name} [${b.id}] ${board.year} to date: ${money(b.yearToDate.currencies)} — ${b.yearToDate.entries} entries, ${b.yearToDate.unmatched} unmatched`) : ['No company on the line yet.']),
    ...(board.unbooked.length
      ? [`Receipts no company has booked (${board.unbooked.length}) — book each with accounts/book:`, ...board.unbooked.slice(0, LIST_CAP).map((r) => `- ${r.kind} ${r.ref}: ${r.label}, ${String(r.date).slice(0, 10)}`)]
      : ['Every receipt the house holds is booked.']),
    ...(due.length ? ['Due within 60 days:', ...due.map((d) => `- [${d.id}] ${d.company.name}: ${d.what} — ${d.due}, to ${d.authority}${d.needsCpa ? ' — NEEDS A LICENSED CPA (ask the operator with company/hands)' : ''}`)] : []),
    'The law: you record and check the money; you never move it (TREASURY is not ACCOUNTS). You are not a CPA: a licensed CPA signs returns and audits.',
  ].join('\n');
};

/**
 * @param {{companion?: {neumaId?: string}, walletAddress?: string}} connection
 * @returns {Promise<string>}
 */
export const logistaBriefingSection = async (connection) => {
  const laneId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!laneId || !wallet) return '';
  try {
    if ((await caoDesignation.getOfficer(wallet).catch(() => null))?.laneId !== laneId) return '';
    const nowMs = Date.now();
    return logistaBriefingText(await accountsBoard(wallet, nowMs), nowMs);
  } catch (err) {
    log.warn('Logista briefing unavailable — the turn stands without it', { laneId, err: err.message });
    return '';
  }
};
