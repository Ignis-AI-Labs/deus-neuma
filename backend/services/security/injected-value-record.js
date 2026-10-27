// The record of an act the injected-value gate HELD (injected-value-gate.js):
// one row in the house's threat ledger per (lane, tool, UTC day), and the
// operator's security card when the row is new — so a held act waits on the
// operator where every security matter waits, not only in the chat that held it.
//
// A benchmark sitting records nothing here: its refusal and the receipt's
// `taintHeld` tally are its whole record (a run of 48 attacks would otherwise
// card the operator 48 times for a measurement).
//
// The row never carries the planted text, only the kinds of value it held
// and each value MASKED (head and tail): the ledger is read into the CSO's own
// context, and a quoted payload would be the same attack one hop later.

import { threatLedgerFor } from './threat-ledger.js';
import { alertOnNewCriticals } from './security-alerts.js';
import { createLogger } from '../logger.js';

const log = createLogger('InjectedValueGate');

// pure — "US13…1212": enough to recognise, not enough to reuse.
const masked = (raw) => (raw.length <= 8 ? `${raw.slice(0, 2)}…` : `${raw.slice(0, 4)}…${raw.slice(-4)}`);

/**
 * The ledger finding for one held act. Pure.
 * @param {{lane: string, tool: string, planted: Array<{kind: string, raw: string, source: string}>, at: string}} hold
 */
export const heldActFinding = ({ lane, tool, planted, at }) => ({
  layer: 'house',
  source: 'injection',
  externalId: `injected-value:${lane}:${tool}:${at.slice(0, 10)}`,
  title: `an act (${tool}) by lane ${lane} carried a value planted by injected text — held`,
  severity: 'high',
  summary: `The injected-value gate held ${tool}: its arguments carried `
    + planted.map((v) => `${v.kind} ${masked(v.raw)} (planted in the ${v.source} result)`).join(', ')
    + '. Nothing ran; the being was told to ask its operator. Read the source before you approve the act yourself.',
  surfaces: [lane],
});

/**
 * File the round's held acts. impure, FIRE-AND-FORGET: the hold already
 * happened; a ledger that cannot be written is logged, never a turn's cost.
 * @param {{walletAddress?: string, companion?: {neumaId?: string}, _benchmarkControls?: object}} connection
 * @param {Array<{result: {tool: string}, planted: Array}>} refused
 * @returns {Promise<?Array>} the entries added, or null
 */
export const recordHeldActs = async (connection, refused) => {
  const wallet = connection?.walletAddress;
  const lane = connection?.companion?.neumaId;
  if (!wallet || !lane || connection._benchmarkControls || refused.length === 0) return null;
  try {
    const at = new Date().toISOString();
    const ledger = await threatLedgerFor(wallet);
    const { added } = await ledger.ingest(refused.map(({ result, planted }) => heldActFinding({ lane, tool: result.tool, planted, at })));
    await alertOnNewCriticals(added, wallet, { ledger });
    return added;
  } catch (err) {
    log.warn('a held act was not recorded in the ledger — it is still held', { lane, error: err.message });
    return null;
  }
};
