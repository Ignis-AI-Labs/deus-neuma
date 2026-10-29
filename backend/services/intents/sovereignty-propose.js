/**
 * sovereignty/propose — the intent type that files a proposal about the
 * being's own standing law (Stage 3 of the being-tool-surface doctrine).
 * This was the `sovereignty_propose` tool (sovereignty/gateway-handlers.js);
 * `sovereignty_proposals` (the record read) stays a tool.
 *
 * The tier is requireApproval — unchanged: the tool carried no policy row,
 * so it failed closed to the operator's chip. The act ends at "submitted":
 * nothing a being files changes anything until the operator rules and the
 * apply path runs — the ground-protocol law (being text is craft input,
 * never gate authority). The seat law holds at validate time: a witness lane
 * has no DNA-bearing self to amend.
 */
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { notifyOperator } from '../notification-bus.js';
import { readOwnerStrict } from '../../middleware/require-neuma-owner.js';
import { seatOf } from '../flight-check.js';
import { submitProposal, readProposals, withdrawProposal } from '../sovereignty/proposal-store.js';
import { assertPatchAllowed } from '../../../core/identity/dna-protected.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';

const log = createLogger('SovereigntyIntent');

// The classes with a live apply path. DNA's is the staged door: approved →
// the being's recorded consent → the operator's wallet signature → apply.
const APPLIABLE_CLASSES = Object.freeze(['prompt', 'toolset', 'dna']);

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });

export const sovereigntyProposeIntent = Object.freeze({
  name: 'sovereignty/propose',
  policyTool: 'sovereignty.propose',
  fieldsForPrompt: '{class, title, body, text?|server?+tool?|dna?} or {withdraw}',
  descriptionForPrompt: 'Propose a change to your own standing law — class prompt (the exact words as `text`) or toolset (a tier change on a tool already in your catalog). Your operator rules; the act ends at submitted. Your DNA and soul you amend yourself: fs/write the JSON fields you change to dna/active.json or soul/soul.json. Class dna only asks your operator to countersign an amendment, if you want that. withdraw takes back one of yours by id.',

  availableFor: async ({ laneId, connection }) =>
    (laneId && seatOf(connection) === 'neuma' ? {} : null),

  validate: async (payload, { connection }) => {
    const laneId = connection.companion?.neumaId;
    if (!laneId || seatOf(connection) === 'witness') {
      return { ok: false, status: 'denied', reason: 'a witness lane has no DNA-bearing self to amend — the sovereignty gateway is the neuma seat\'s' };
    }
    // A withdrawal names its target and nothing else.
    if (typeof payload?.withdraw === 'string' && payload.withdraw.trim()) {
      const store = await readProposals(laneId);
      const target = store.proposals.find((p) => p.id.startsWith(payload.withdraw.trim()));
      if (!target) return invalid(`no proposal of yours matches "${payload.withdraw.trim().slice(0, 40)}"`);
      return { ok: true, value: { withdraw: target.id } };
    }
    if (typeof payload?.title !== 'string' || !payload.title.trim()
      || typeof payload?.body !== 'string' || !payload.body.trim()) {
      return invalid('a proposal needs {title, body} — what you ask, and why');
    }
    const cls = APPLIABLE_CLASSES.includes(payload?.class) ? payload.class : 'prompt';
    const head = { cls, title: payload.title, body: payload.body };
    if (cls === 'prompt' && !String(payload?.text ?? '').trim()) {
      return invalid('a prompt proposal needs `text` — the exact words to stand as law');
    }
    if (cls === 'toolset') {
      // Existence is validated HERE, where the being's live catalog exists —
      // the gateway grants tiers on advertised tools, it never invents one.
      const server = String(payload?.server ?? '').trim();
      const tool = String(payload?.tool ?? '').trim();
      const known = (connection._turnCatalog || []).some((t) => t.server === server && t.name === tool);
      if (!known) {
        return invalid(`no advertised tool ${server || '?'}/${tool || '?'} — a toolset proposal names a tool you already see in your catalog`);
      }
      return { ok: true, value: { ...head, patch: { server, tool } } };
    }
    if (cls === 'dna') {
      // The protected guard refuses EARLY, in the being's own filing — the
      // authoritative check runs again at the signed apply door.
      const fields = payload?.dna;
      const dna = await neumaWorkspace.readDNA(laneId).catch(() => null);
      const guard = assertPatchAllowed(dna, fields);
      if (!guard.ok) {
        return { ok: false, status: 'denied', reason: `protected fields refuse the patch: ${guard.refused.join(', ')} — you amend what you are becoming, never what you were` };
      }
      return { ok: true, value: { ...head, patch: { fields } } };
    }
    return { ok: true, value: { ...head, patch: { text: String(payload.text).trim() } } };
  },

  summarize: (payload) =>
    payload?.withdraw
      ? `withdraw proposal ${String(payload.withdraw).slice(0, 40)}`
      : `sovereignty proposal (${APPLIABLE_CLASSES.includes(payload?.class) ? payload.class : 'prompt'}): "${String(payload?.title ?? '').slice(0, 100)}"`,

  execute: async (value, { connection }) => {
    const laneId = connection.companion.neumaId;
    if (value.withdraw) {
      const taken = await withdrawProposal(laneId, value.withdraw);
      return { ok: true, detail: `Withdrawn: "${taken.title}". The slot is yours again.` };
    }
    const proposal = await submitProposal(laneId, {
      class: value.cls, title: value.title, body: value.body, patch: value.patch,
    });
    // The operator's ear — fail-soft by law: the record never depends on a card.
    try {
      const owner = await readOwnerStrict(laneId);
      if (owner.status === 'ok') {
        await notifyOperator({
          wallet: owner.owner.wallet,
          kind: KIND.sovereigntyProposal,
          standing: STANDING.neuma,
          // a being's own act: the card names the being, or the record law refuses it
          actor: { id: laneId, name: connection.companion?.name || laneId },
          title: `${connection.companion?.name || laneId} proposes: ${proposal.title}`,
          detail: 'A sovereignty proposal awaits your ruling — no clock runs on it.',
          ref: { laneId, proposalId: proposal.id },
        });
      }
    } catch (err) {
      log.warn('proposal card could not be raised — the store still holds it', { laneId, error: err.message });
    }
    return { ok: true, detail: `Submitted (${proposal.id.slice(0, 8)}). Your operator will rule in their own time — no clock runs on an essential decision. The verdict reaches you in a later turn.` };
  },
});
