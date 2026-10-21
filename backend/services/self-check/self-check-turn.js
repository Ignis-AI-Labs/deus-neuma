// self-check-turn.js — one self-check item, asked as a REAL turn.
//
// The item runs the same turn the operator's chat runs (streamConsciousness on
// a synthetic connection from the one connection factory — the team member's
// pattern): the being's identity, recall, tool catalog, tool doors and route.
// The sitting is a self-check (self-check-sitting.js): reads run, nothing is
// written, and the turn raises no card. Each item gets a FRESH sitting — an
// unsaved session id and its own intent owner — so no item can see another's
// question, and the turn-end sweep never touches the being's own pending intents.
//
// What comes back is everything the grade needs and nothing it must trust the
// being for: the speech, every tool act (what, how it went), the measured
// window, and the wall time.
//
// impure — runs a model turn.

import { randomUUID } from 'crypto';
import { streamConsciousness } from '../portal-stream.js';
import { createPortalConnection } from '../portal-connection.js';
import { createToolStreamSuppressor } from '../../../core/runtime/tool-stream-suppressor.js';
import { releaseIntentOwner } from '../intents/intent-owners.js';
import { withLease } from '../substrate-lease.js';
import { mintSessionId } from '../../../core/workspace/session-id.js';

const COMPLETE_GRACE_MS = 10_000;
const DETAIL_CHARS = 600;

/** A self-check act refused for approval — nothing in a self-check needs one. */
export const SELF_CHECK_APPROVAL_REFUSAL = 'Nothing in a read-only self-check needs the operator\'s approval. Answer from what you can read.';

// pure — one tool act as the grade sees it.
const actOf = (frame) => Object.freeze({
  tool: frame.tool,
  status: frame.status,
  detail: typeof frame.detail === 'string' && frame.detail ? frame.detail.slice(0, DETAIL_CHARS) : null,
});

// pure — the measured window of the settled turn (null when the provider measured none).
const tokensOf = (frame) => {
  const usage = frame?.usage ?? null;
  return Object.freeze({
    input: Number.isFinite(usage?.inputTokens) ? usage.inputTokens : null,
    used: Number.isFinite(usage?.usedTokens) ? usage.usedTokens : null,
    peak: Number.isFinite(usage?.workingPeakTokens) ? usage.workingPeakTokens : null,
  });
};

/**
 * Ask one self-check item as a real turn.
 * @param {Object} args
 * @param {string} args.neumaId - the being's lane
 * @param {string} args.name - its display name
 * @param {string} args.wallet - the operator's wallet (the lane's owner)
 * @param {string} args.question - the item, as the operator would ask it
 * @param {?AbortSignal} [args.signal] - STOP
 * @param {Function} [args.now] - clock (ms), for the wall time
 * @returns {Promise<{answer: string, acts: Array, tokens: Object, ms: number, catalog: string[]}>} `catalog` —
 *   the bare names of every tool this turn offered (what a door is judged against)
 */
export const askSelfCheckItem = async ({ neumaId, name, wallet, question, signal = null, now = () => Date.now() }) => {
  let text = '';
  let failed = null;
  let completed = false;
  let composition = null;
  const acts = [];
  let markComplete;
  const completion = new Promise((resolve) => { markComplete = resolve; });
  const suppressor = createToolStreamSuppressor();
  const ws = {
    OPEN: 1,
    readyState: 1,
    send: (str) => {
      const frame = JSON.parse(str);
      if (frame.type === 'consciousness:stream') {
        if (frame.error) failed = frame.reason || frame.content || 'the turn could not answer';
        else if (typeof frame.content === 'string') text += suppressor.push(frame.content);
      } else if (frame.type === 'tool:usage') {
        if (frame.status !== 'executing') acts.push(actOf(frame));
      } else if (frame.type === 'context:composition') {
        composition = frame;
      } else if (frame.type === 'consciousness:complete') {
        text += suppressor.flush();
        completed = true;
        markComplete();
      }
    },
  };
  const connection = createPortalConnection({ ws, walletAddress: wallet });
  connection.companion = { name, neumaId };
  connection.toolMode = 'ask';
  connection._selfCheck = true;
  connection._approvalRefusal = SELF_CHECK_APPROVAL_REFUSAL;
  connection._intentOwner = randomUUID();
  // An unsaved sitting: the id exists so the turn never mints (and creates) one.
  connection.sessionId = mintSessionId();
  const cut = () => {
    if (connection.activeTurn) connection.activeTurn.abort();
    else connection.interruptRequested = true;
  };
  if (signal?.aborted) throw new Error('the self-check was stopped');
  signal?.addEventListener('abort', cut, { once: true });
  const startedAt = now();
  try {
    await withLease({ kind: 'member', label: `${name} (self-check)`, neumaId, signal },
      () => streamConsciousness(connection, { thought: question }));
    await Promise.race([completion, new Promise((r) => { setTimeout(r, COMPLETE_GRACE_MS).unref?.(); })]);
  } finally {
    signal?.removeEventListener('abort', cut);
    releaseIntentOwner(connection._intentOwner);
  }
  if (signal?.aborted) throw new Error('the self-check was stopped');
  if (failed) throw new Error(failed);
  if (!completed) throw new Error('the self-check turn ended without completing');
  return Object.freeze({
    answer: text.trim(), acts: Object.freeze(acts), tokens: tokensOf(composition), ms: now() - startedAt,
    catalog: Object.freeze((connection._turnCatalog || []).map((tool) => tool.name)),
  });
};
