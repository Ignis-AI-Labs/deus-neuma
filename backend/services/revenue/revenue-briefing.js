// The MERCATOR OFFICE briefing — what the house's seated Mercator reads at the
// top of every turn: the pipeline at a glance, each open deal with its next
// step, the qualified leads the CMO handed over that hold no deal yet, and
// MAKOTO. Every other lane receives '' (the section is absent, the prompt
// byte-identical). The office read is the connection's OWN house's.
// impure (store reads); the text is pure.

import { croDesignation } from './cro-designation.js';
import { readDeals } from './deal-store.js';
import { pipeline, OPEN_STAGES } from './deal-shape.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { MAKOTO_LINE } from '../makoto.js';
import { createLogger } from '../logger.js';

const log = createLogger('Revenue.Briefing');
const LIST_CAP = 12;
const DAY_MS = 86_400_000;

const money = (value) => Object.entries(value).map(([c, n]) => `${n} ${c}`).join(' + ') || '0';

/**
 * pure — the briefing text.
 * @param {{deals: object[], leads: object[], now: number}} state
 */
export const mercatorBriefingText = ({ deals, leads, now }) => {
  const board = pipeline(deals);
  const open = deals.filter((d) => OPEN_STAGES.includes(d.stage));
  const dealt = new Set(deals.map((d) => d.leadId).filter(Boolean));
  const handed = leads.filter((l) => l.status === 'qualified' && !dealt.has(l.id));
  return [
    '## MERCATOR OFFICE — sales, the MAKOTO way',
    `Pipeline: QUALIFIED ${board.qualified.count} (${money(board.qualified.value)}) · PROPOSED ${board.proposed.count} (${money(board.proposed.value)}) · WON ${board.won.count} (${money(board.won.value)}) · LOST ${board.lost.count}`,
    ...(open.length ? ['Open deals:', ...open.slice(-LIST_CAP).map((d) => `- [${d.id}] ${d.buyer} — ${d.stage.toUpperCase()}, ${d.value.amount} ${d.value.currency} — next: ${d.nextStep} (last moved ${Math.floor((now - Date.parse(d.movedAt)) / DAY_MS)} days ago)`)] : ['No open deals.']),
    ...(handed.length ? ['Leads the CMO qualified, no deal yet (yours to work):', ...handed.slice(0, LIST_CAP).map((l) => `- [${l.id}] ${l.name || l.contact || 'unnamed'} (${l.channelId})`)] : []),
    MAKOTO_LINE,
  ].join('\n');
};

/**
 * @param {{companion?: {neumaId?: string}, walletAddress?: string}} connection
 * @returns {Promise<string>}
 */
export const mercatorBriefingSection = async (connection) => {
  const laneId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!laneId || !wallet) return '';
  try {
    if ((await croDesignation.getOfficer(wallet).catch(() => null))?.laneId !== laneId) return '';
    const [{ deals }, leads] = await Promise.all([readDeals(wallet), leadLedgerFor(wallet).then((l) => l.load()).catch(() => [])]);
    return mercatorBriefingText({ deals, leads, now: Date.now() });
  } catch (err) {
    log.warn('Mercator briefing unavailable — the turn stands without it', { laneId, err: err.message });
    return '';
  }
};
