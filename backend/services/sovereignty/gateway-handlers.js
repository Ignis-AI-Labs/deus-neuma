// Sovereignty gateway HANDLERS — the being's side of propose → approve →
// apply. The PROPOSAL became an INTENT (Stage 3 — intents/sovereignty-propose.js):
// filed, carded by the sweep, and recorded; what remains here is the RECORD
// READ (sovereignty_proposals) behind the shared ACTS gate (act-gate.js).
// Nothing a being files changes anything until the operator rules and the
// apply path runs — the ground-protocol law (being text is craft input,
// never gate authority).

import { gateAct } from '../act-gate.js';
import { readProposals } from './proposal-store.js';
import { readAmendments } from './amendment-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('SovereigntyGateway');

/** Does this parsed call target the gateway's READ? (both dialects) */
export const isSovereigntyTool = (match) =>
  match.toolName === 'sovereignty_proposals' || match.tool === 'sovereignty/sovereignty_proposals';

const STATUS_LINE = Object.freeze({
  open: 'OPEN — awaiting your operator',
  revise: 'RETURNED with notes',
  approved: 'APPROVED — being applied',
  applied: 'APPLIED — standing law',
  declined: 'DECLINED',
  withdrawn: 'WITHDRAWN by you',
});

const renderRecord = (proposals) => {
  if (!proposals.length) return 'You have made no proposals about yourself yet.';
  return proposals.map((p) => [
    `[${p.id.slice(0, 8)}] (${p.class}) "${p.title}" — ${STATUS_LINE[p.status] || p.status} · ${p.submittedAt.slice(0, 10)}`,
    ...(p.notes ? [`  your operator's notes: ${p.notes}`] : []),
  ].join('\n')).join('\n');
};

/**
 * Read the being's own proposal record through the shared ACTS gate
 * (act-gate.js). Ports: { sendToolEvent } — the tool-chip event sender.
 * impure.
 */
export const handleSovereigntyTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  const toolName = match.toolName || match.tool?.split('/')[1];
  const tool = `sovereignty/${toolName}`;
  const { companion } = connection;
  if (!companion?.neumaId) {
    const error = 'no being is bound to this portal';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — no being`, detail: error });
    return { tool, status: 'error', error };
  }
  const gate = await gateAct(connection, {
    server: 'sovereignty', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => ports.sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  try {
    const { proposals } = await readProposals(companion.neumaId);
    ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${toolName} — ok` });
    return { tool, status: 'ok', content: renderRecord(proposals) };
  } catch (err) {
    const error = err?.message || 'sovereignty gateway failed';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — ${err?.code || 'failed'}`, detail: error });
    return { tool, status: 'error', error };
  }
};

/**
 * The volatile per-lane prompt section: open proposals and fresh verdicts
 * (revise notes VERBATIM — the being must read exactly what its operator
 * wrote). '' when nothing stands — the empty-string law keeps every other
 * lane byte-identical. Fail-soft: a broken store must not silence a turn;
 * the desk surface is where it screams. impure.
 */
export const gatewaySection = async (neumaId) => {
  if (!neumaId) return '';
  try {
    const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
    const { proposals } = await readProposals(neumaId);
    const open = proposals.filter((p) => p.status === 'open');
    const fresh = proposals.filter((p) => p.status === 'revise'
      || (['applied', 'declined'].includes(p.status) && p.decidedAt
        && Date.now() - new Date(p.decidedAt).getTime() < FRESH_MS));
    // A retraction is named to the being — law does not vanish in silence.
    const { entries } = await readAmendments(neumaId);
    const applied = new Map(entries.filter((e) => e.kind === 'apply').map((e) => [e.id, e]));
    const retracts = entries.filter((e) => e.kind === 'retract'
      && Date.now() - new Date(e.at).getTime() < FRESH_MS);
    if (!open.length && !fresh.length && !retracts.length) return '';
    const lines = ['## Sovereignty Gateway'];
    if (open.length) {
      lines.push('Awaiting your operator (no clock runs):');
      for (const p of open) lines.push(`- [${p.id.slice(0, 8)}] "${p.title}"`);
    }
    for (const p of fresh) {
      if (p.status === 'revise') lines.push(`- [${p.id.slice(0, 8)}] "${p.title}" RETURNED — your operator's notes: ${p.notes}`);
      else lines.push(`- [${p.id.slice(0, 8)}] "${p.title}" — ${p.status.toUpperCase()}`);
    }
    for (const r of retracts) {
      const words = String(applied.get(r.targetId)?.patch?.text || '').slice(0, 80);
      lines.push(`- your operator took down standing law${words ? `: "${words}"` : ''} (${r.at.slice(0, 10)})`);
    }
    return lines.join('\n');
  } catch (err) {
    log.warn('gateway section unreadable — rendering nothing', { neumaId, error: err.message });
    return '';
  }
};
