// team-member-turn.js — a team member works its step as a REAL turn, with its
// own hands.
//
// A member used to answer through askNeuma — the benchmark probe: one
// completion, no tools. A brief that named a workspace produced receipts
// citing files that were never written (2026-10-10). Founder: member tools are
// part of this campaign. Here the member's step runs the SAME turn the
// operator's chat runs — streamConsciousness on a synthetic portal
// connection built by the one connection factory (the channel bridge's
// pattern, no parallel pipeline): its identity, memory, tool catalog,
// sandbox, thought governor and reply budget, its own session (a transcript
// in its own lane), and the team workspace mounted as its write
// confinement, the byte budget shared by the whole team.
//
// The member's law, enforced at the platform's own choke points:
//   - writes land ONLY inside the team workspace (tool-sandbox.js, via
//     connection._teamWorkspace) — plus its own intents/ channel;
//   - every act that needs the operator's approval is REFUSED at once with
//     an honest reason (tool-approval.js, connection._approvalRefusal):
//     nobody is watching a member's turn to tap a card, and a member never
//     hangs waiting on one;
//   - its turn raises no "finished a turn" card — the run's own card speaks.
//
// impure — runs a model turn, writes the member's session and lane.

import { randomUUID } from 'crypto';
import { streamConsciousness } from './portal-stream.js';
import { createPortalConnection } from './portal-connection.js';
import { createToolStreamSuppressor } from '../../core/runtime/tool-stream-suppressor.js';
import { extractStatus } from './team-board.js';
import { extractTorch } from './team-torch.js';
import { releaseIntentOwner } from './intents/intent-owners.js';
import { withLease } from './substrate-lease.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { mintSessionId } from '../../core/workspace/session-id.js';

/** The reason a member's governed act is refused — said to the member. */
export const MEMBER_APPROVAL_REFUSAL = 'Team members cannot take acts that need the operator\'s approval during a team run. Do the work inside the team workspace, and name what still needs the operator in your status so your lead can ask.';

// NO DEADLINE. A member's turn used to be cut at thirty minutes; live
// (2026-10-12) that cut all five working members of a run mid-research at
// 30:00, and the clock ran while a member waited in the substrate line before
// it had begun. A member works as long as its part needs (Design note, 2026-10-12:
// […]); a stream that goes silent is the
// provider's stall guard's to end, and the operator's STOP ends anything.

const COMPLETE_GRACE_MS = 10_000;

/** What one act returned, as much as the run's watchers are sent. */
export const TOOL_DETAIL_CHARS = 2000;
/** The sources one act lists (a search's links), at most. */
export const TOOL_SOURCES_MAX = 12;

// pure — a tool frame as the run's watchers see it: what the member reached
// for, how it went, and what came back (bounded).
const toolEvent = (frame) => ({
  tool: frame.tool,
  status: frame.status,
  summary: frame.summary ?? null,
  detail: typeof frame.detail === 'string' && frame.detail
    ? (frame.detail.length > TOOL_DETAIL_CHARS ? `${frame.detail.slice(0, TOOL_DETAIL_CHARS)}…` : frame.detail)
    : null,
  sources: Array.isArray(frame.sources) && frame.sources.length
    ? frame.sources.slice(0, TOOL_SOURCES_MAX).map((src) => ({ title: src?.title ?? null, url: src?.url ?? null }))
    : null,
});

/**
 * Run one member step as a real turn.
 *
 * @param {Object} args
 * @param {string} args.neumaId - the member's lane
 * @param {string} args.name - the member's display name
 * @param {string} args.wallet - the operator's wallet (the member's owner)
 * @param {string} args.brief - the step's brief (buildBrief), as one message
 * @param {Object} args.workspace - the SHARED team workspace object
 *   { root, budgetBytes, usedBytes } — one object for the whole team, so the
 *   byte budget is the team's, not each member's
 * @param {?string} [args.sessionId] - the part's own sitting, when the part
 *   CONTINUES (team-part.js); a first attempt mints one
 * @param {?{runId: string, stepId: string}} [args.teamRun] - the member's seat
 *   in its run — the team channel (team/post) is its to speak in
 * @param {?AbortSignal} [args.signal] - STOP for this member
 * @param {Function} [args.onText] - released words, as they arrive
 * @param {Function} [args.onReasoning] - reasoning, as it arrives
 * @param {Function} [args.onTool] - each tool event ({ tool, status, summary, detail, sources })
 * @param {Function} [args.onSession] - the part's sitting, the moment it is known
 * @param {Function} [args.onLine] - its place in the substrate line ({ state, position?, ahead? })
 * @returns {Promise<{text: string, sessionId: ?string}>}
 */
export const runMemberTurn = async ({
  neumaId, name, wallet, brief, workspace, sessionId = null, teamRun = null,
  signal = null, onText = () => {}, onReasoning = () => {}, onTool = () => {},
  onSession = () => {}, onLine = () => {},
}) => {
  let text = '';
  // Where the speech after the member's LAST act begins (see finalWord).
  let lastActAt = 0;
  let failed = null;
  let completed = false;
  let markComplete;
  const completion = new Promise((resolve) => { markComplete = resolve; });
  // Tool blocks never read as speech (the voice / channel law, #320).
  const suppressor = createToolStreamSuppressor();
  const release = (chunk) => {
    if (!chunk) return;
    text += chunk;
    onText(chunk);
  };
  const ws = {
    OPEN: 1,
    readyState: 1,
    send: (str) => {
      const frame = JSON.parse(str);
      if (frame.type === 'consciousness:stream') {
        // The cause, not the chat's courtesy line: the run tells the member
        // (and the operator) why the attempt stopped.
        if (frame.error) failed = frame.reason || frame.content || 'the turn could not answer';
        else if (typeof frame.content === 'string') release(suppressor.push(frame.content));
      } else if (frame.type === 'consciousness:thinking' && frame.content) {
        onReasoning(frame.content);
      } else if (frame.type === 'tool:usage') {
        if (frame.status === 'executing') lastActAt = text.length;
        onTool(toolEvent(frame));
      } else if (frame.type === 'consciousness:complete') {
        release(suppressor.flush());
        completed = true;
        markComplete();
      }
    },
  };
  const connection = createPortalConnection({ ws, walletAddress: wallet });
  connection.companion = { name, neumaId };
  connection.toolMode = 'ask';
  connection._teamMember = true;
  connection._teamWorkspace = workspace;
  connection._approvalRefusal = MEMBER_APPROVAL_REFUSAL;
  if (teamRun) connection._teamRun = teamRun;
  // The intents this member files are its own to settle — never its being's
  // chat's, and its sweep never touches the chat's (intent-owners.js).
  connection._intentOwner = randomUUID();
  // THE PART'S OWN SITTING, before the turn: never two parts in one file
  // (three parallel parts of one member began in the same millisecond and
  // wrote into ONE session, 2026-10-12), known to the run from the first
  // moment — so a part cut mid-work continues there.
  if (sessionId) {
    connection.sessionId = sessionId;
  } else {
    connection.sessionId = mintSessionId();
    await neumaWorkspace.createSession(neumaId, connection.sessionId).catch(() => {});
  }
  onSession(connection.sessionId);

  // A STOP that lands while the turn is still being assembled (no decode
  // yet) must still cut it: the turn reads the flag the moment it begins.
  const cut = () => {
    if (connection.activeTurn) connection.activeTurn.abort();
    else connection.interruptRequested = true;
  };
  if (signal?.aborted) throw new Error(signal.reason?.message || 'stopped by the operator');
  signal?.addEventListener('abort', cut, { once: true });
  try {
    // The member waits its turn for the house's model server like everyone, as a member: a team
    // never takes the operator's last slot, and holds its place through all its rounds. The run
    // shows where it stands: waiting behind others, or working.
    await withLease({
      kind: 'member', label: `${name} (team)`, neumaId, signal,
      onWait: ({ position, ahead }) => onLine({ state: 'waiting', position, ahead: (ahead || []).map((a) => a.label) }),
      onAdmit: () => onLine({ state: 'running' }),
    }, () => streamConsciousness(connection, { thought: brief }));
    // The complete frame follows the stream's resolution (the channel
    // bridge's finding); a short grace covers it without hanging the run.
    await Promise.race([completion, new Promise((r) => { setTimeout(r, COMPLETE_GRACE_MS).unref?.(); })]);
  } finally {
    signal?.removeEventListener('abort', cut);
    releaseIntentOwner(connection._intentOwner);
  }
  if (signal?.aborted) throw new Error(signal.reason?.message || 'stopped by the operator');
  if (failed) throw new Error(failed);
  if (!completed) throw new Error('the member\'s turn ended without completing');
  return { text: finalWord(text, lastActAt), sessionId: connection.sessionId ?? null };
};

/**
 * A member's PART is its final word: the speech after its last act. Measured
 * live (2026-10-11): a member wrote its whole answer beside its fs/write call,
 * then — handed the tool result — wrote it all again; the run carried both
 * into the record, every downstream brief and the lead's report. Speech
 * before the last act is working out loud (the operator still watched it
 * live). When the final word holds no work — only the check-in and torch —
 * the whole turn stands, so real work is never dropped. Pure.
 *
 * @param {string} text - every word the turn released
 * @param {number} lastActAt - where the speech after the last act begins
 * @returns {string}
 */
export const finalWord = (text, lastActAt) => {
  const tail = text.slice(lastActAt).trim();
  if (!lastActAt || !tail) return text.trim();
  const body = extractStatus(extractTorch(tail).body).body;
  return body.trim() ? tail : text.trim();
};
