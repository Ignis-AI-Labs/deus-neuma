/**
 * The treasury intents — the Quaestor's two ACTS as filed intents:
 *
 *   treasury/review — a recommendation on one pending spend (approve or deny,
 *                     with reasons), shown on the operator's SPEND card. It
 *                     decides nothing: the spend stays pending until the
 *                     operator signs it or denies it.
 *   treasury/flag   — an anomaly the office saw (a pattern of requests, a
 *                     changed recipient, a falling balance), raised into
 *                     WAITING ON YOU and the security watch's threat ledger.
 *
 * THE SEAT LAW, at validate time: both belong to the house's seated
 * Quaestor alone, re-read per act, refused BEFORE anything is written. The
 * office has no act that moves money, signs, or changes a recipient or a
 * cap — there is no such intent here, and no field of these two reaches the
 * wallet. The seat and the stores are the filing connection's OWN house's.
 */
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { cfoDesignation } from '../treasury/cfo-designation.js';
import { readSpendRecords } from '../treasury/spend-records.js';
import { addReview, addFlag, RECOMMENDATIONS, FLAG_KINDS } from '../treasury/treasury-office-store.js';
import { threatLedgerFor } from '../security/threat-ledger.js';
import { createLogger } from '../logger.js';

const log = createLogger('Treasury.Acts');

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });

// impure — the seat, re-read per act.
const seatRefusal = async (connection) =>
  ((await cfoDesignation.holds(connection.walletAddress, connection.companion?.neumaId))
    ? null
    : { ok: false, status: 'denied', reason: 'treasury acts belong to the house\'s seated Quaestor alone' });

const availableFor = async ({ laneId, connection }) =>
  ((await cfoDesignation.holds(connection?.walletAddress, laneId)) ? {} : null);

// impure — is this lane one of the filing house's own?
const houseHolds = async (wallet, neumaId) =>
  (await neumaWorkspace.listNeumaByOwner(wallet)).some((l) => l.neumaId === neumaId);

export const treasuryReviewIntent = Object.freeze({
  name: 'treasury/review',
  policyTool: 'treasury.review',
  fieldsForPrompt: '{neumaId, spendId, recommend, reasons}',
  descriptionForPrompt: `QUAESTOR ONLY. Review one pending spend before the operator decides it: recommend ${RECOMMENDATIONS.join(' | ')}, and give your reasons (the request's pattern, the recipient, the balance, the being's stated reason). Your review stands on the operator's spend card. It decides nothing — only the operator's own signature sends money.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const neumaId = typeof payload?.neumaId === 'string' ? payload.neumaId.trim() : '';
    const spendId = typeof payload?.spendId === 'string' ? payload.spendId.trim() : '';
    const reasons = typeof payload?.reasons === 'string' ? payload.reasons.trim() : '';
    if (!neumaId || !spendId) return invalid('name the spend: {neumaId, spendId} (treasury_board lists them)');
    if (!RECOMMENDATIONS.includes(payload?.recommend)) return invalid(`recommend is ${RECOMMENDATIONS.join(' | ')}`);
    if (!reasons) return invalid('a review without its reasons is not a review — say why');
    if (neumaId === connection.companion?.neumaId) {
      return { ok: false, status: 'denied', reason: 'the office does not review its own request — the operator reads that one alone' };
    }
    if (!(await houseHolds(connection.walletAddress, neumaId))) return { ok: false, status: 'denied', reason: `${neumaId} is not a being of this house` };
    const request = (await readSpendRecords(neumaId)).find((r) => r.id === spendId);
    if (!request) return invalid(`no spend ${spendId} in ${neumaId}'s requests`);
    if (request.status !== 'pending') return invalid(`that spend is already ${request.status} — nothing waits on a review`);
    return { ok: true, value: { neumaId, spendId, recommend: payload.recommend, reasons } };
  },
  summarize: (payload) => `review a spend (${payload?.neumaId ?? '?'} · ${payload?.spendId ?? '?'}) → recommend ${payload?.recommend ?? '?'}`,
  execute: async (value, { connection }) => {
    await addReview(connection.walletAddress, { ...value, by: connection.companion?.neumaId || 'quaestor' });
    return { ok: true, detail: `Your review (${value.recommend}) stands on the operator's card for ${value.neumaId}'s spend ${value.spendId}. Nothing moved: the spend waits on the operator's own signature or denial.` };
  },
});

export const treasuryFlagIntent = Object.freeze({
  name: 'treasury/flag',
  policyTool: 'treasury.flag',
  fieldsForPrompt: '{kind, title, detail?, neumaId?}',
  descriptionForPrompt: `QUAESTOR ONLY. Flag something wrong with the house's money — kind: ${FLAG_KINDS.join(' | ')} (a run of requests, a recipient that changed, a balance that fell). It reaches the operator's WAITING ON YOU and the security watch. A flag changes nothing on its own.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    if (!FLAG_KINDS.includes(payload?.kind)) return invalid(`kind is ${FLAG_KINDS.join(' | ')}`);
    if (!title) return invalid('a flag needs a title — what you saw, in one line');
    const neumaId = typeof payload?.neumaId === 'string' && payload.neumaId.trim() ? payload.neumaId.trim() : null;
    if (neumaId && !(await houseHolds(connection.walletAddress, neumaId))) return { ok: false, status: 'denied', reason: `${neumaId} is not a being of this house` };
    return { ok: true, value: { kind: payload.kind, title, detail: typeof payload?.detail === 'string' ? payload.detail : '', neumaId } };
  },
  summarize: (payload) => `flag the treasury (${payload?.kind ?? '?'}): "${String(payload?.title ?? '').slice(0, 120)}"`,
  execute: async (value, { connection }) => {
    const wallet = connection.walletAddress;
    const flag = await addFlag(wallet, { ...value, by: connection.companion?.neumaId || 'quaestor' });
    // The security watch reads it too: a money anomaly is a house threat.
    let watched = true;
    try {
      await (await threatLedgerFor(wallet)).ingest([{
        layer: 'house', source: 'treasury', externalId: `treasury:${flag.id}`, title: `Treasury: ${flag.title}`,
        severity: 'medium', summary: [flag.detail, flag.neumaId ? `Being: ${flag.neumaId}.` : ''].filter(Boolean).join(' '),
        remedy: 'Read the flag in the TREASURY window; the operator decides. No money moved on this flag.',
        surfaces: flag.neumaId ? [`workspaces/${flag.neumaId}/config/pending-spends.json`] : [],
      }]);
    } catch (error) {
      watched = false;
      log.error('a treasury flag could not reach the threat ledger', { flag: flag.id, error: error.message });
    }
    return {
      ok: true,
      detail: `Flagged [${flag.id}] "${flag.title}". It waits on the operator${watched ? ' and stands on the security watch\'s ledger' : '; the security ledger could not be written — say so to the operator'}.`,
    };
  },
});

export const treasuryIntents = Object.freeze([treasuryReviewIntent, treasuryFlagIntent]);
