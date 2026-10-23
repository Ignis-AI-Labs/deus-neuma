/**
 * Tool Approval Broker — the operator's yes/no on a consciousness's reach.
 *
 * When the tool policy answers 'approval_required', execution pauses here:
 * a tool:approval_request rides the portal to the operator, and the pending
 * promise resolves with their decision. There is NO CLOCK on the ask (Founder,
 * 2026-07-27: […]). Every remaining path settles — operator answer, turn
 * interrupt, portal close — so a pending approval can never leak; the turn
 * simply waits. The 120s fail-closed timeout is gone: a decision this
 * essential is never auto-denied because the human stepped away.
 *
 * State is per-connection (a Map on the connection object), mirroring how
 * activeTurn and session policy already live there — except THE PARKED ASK:
 * a card the operator saw whose portal then closed keeps waiting off the dead
 * connection, for the same wallet to come back and answer (Neuma Remote: a
 * phone locked by hand mid-decision).
 */

import { randomUUID } from 'crypto';
import { safeSend as _safeSend } from './ws-send.js';
import { createLogger } from './logger.js';
const log = createLogger('ToolApproval');
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { logToolCall } from './tool-sandbox.js';
import { recordAct } from './act-ledger.js';
import { withOperationApproval } from './turn-operation-checkpoint.js';
import { linePlace } from './substrate-lease.js';


/** Decisions an operator may send. Everything else is rejected at the boundary. */
export const APPROVAL_DECISIONS = Object.freeze(['allow', 'always', 'deny']);

/** The args preview shown to the operator is a window, not an archive. */
export const APPROVAL_PREVIEW_MAX_CHARS = 600;

/**
 * The card images an intent would attach, so the approval shows the ACTUAL
 * pixels a yes is about to make public (posting-pipeline-v2 phase 6: the
 * operator never approves an image blind again). Pure — basenames of paths
 * in the being's own cards ground only; the preview ROUTE re-authorizes the
 * file server-side, so this list is a signpost, never the grant.
 * @param {Object|undefined} args
 * @returns {Array<string>}
 */
export const approvalMedia = (args) => {
  const media = Array.isArray(args?.media) ? args.media : [];
  return media
    .map((m) => String(m?.path || ''))
    .filter((p) => p.includes('/cards/') && !p.endsWith('/'))
    .map((p) => p.slice(p.lastIndexOf('/') + 1))
    .filter((n) => /^[A-Za-z0-9._-]+$/.test(n))
    .slice(0, 4);
};

/**
 * Render tool args as the one-look preview the operator decides on. Pure.
 * @param {Object|undefined} args - Parsed tool call args
 * @returns {string} Capped JSON preview ('' for no args)
 */
export const approvalPreview = (args) => {
  if (!args || typeof args !== 'object' || Object.keys(args).length === 0) return '';
  let text;
  try { text = JSON.stringify(args, null, 2); } catch { return '[unserializable args]'; }
  return text.length > APPROVAL_PREVIEW_MAX_CHARS
    ? `${text.slice(0, APPROVAL_PREVIEW_MAX_CHARS)}\n[truncated]`
    : text;
};

/**
 * The whole args text the act will run with, when the preview had to cut it —
 * the card offers it in full, so a yes is never given to words past the cut.
 * Null when the preview already shows everything. Pure.
 * @param {Object|undefined} args
 * @returns {?string}
 */
export const approvalFullArgs = (args) => {
  if (!args || typeof args !== 'object') return null;
  let text;
  try { text = JSON.stringify(args, null, 2); } catch { return null; }
  return typeof text === 'string' && text.length > APPROVAL_PREVIEW_MAX_CHARS ? text : null;
};

const _pending = (connection) => {
  if (!connection._pendingApprovals) connection._pendingApprovals = new Map();
  return connection._pendingApprovals;
};

// THE PARKED ASK — a card the operator SAW, whose portal then closed (a phone
// locked by hand, Corwin 2026-09-07, every run). Founder's law is […]: the ask keeps waiting here, off the dead connection, and the answer
// is taken from any later connection of the SAME wallet — the card is still on
// their screen. Module-level on purpose: the connection it came from is gone.
// A card that never reached anyone is not parked (see requestToolApproval).
const _parked = new Map();

/**
 * Pure over the map: the parked asks of one wallet in one session, as the
 * request frames that were sent — what a returning surface may be shown.
 * @param {string|null|undefined} wallet
 * @param {string|null|undefined} sessionId
 * @returns {object[]}
 */
export const parkedApprovalsFor = (wallet, sessionId) =>
  [..._parked.values()]
    .filter((p) => wallet && sessionId && p.wallet === wallet && p.sessionId === sessionId)
    .map((p) => p.frame);

/** How many asks wait for an operator to come back. Pure over the map. */
export const parkedApprovalCount = () => _parked.size;

/**
 * Whether a yes on this connection covers exactly ONE act. House work (a
 * wake, a team member) has no screen: every yes it gets is its route's
 * (requestToolApproval below) — the Optio's CLEAR, the operator's ALLOW ONCE,
 * the charter — given for the act in front of it. So no scope or session
 * grant may ride that yes to the next act: the next one is asked again. A
 * live operator's own ALLOW keeps standing for the session as the desk
 * shows it. Pure.
 * @param {Object} connection
 * @returns {boolean}
 */
export const approvalCoversOneAct = (connection) => Boolean(connection?._approvalRefusal);

/**
 * impure — ask the operator to approve one tool call and wait for the answer.
 * Resolves with the operator's decision, or 'interrupted' (the turn was cut).
 * The broker never times out. Checkpoint IO may reject before authority advances;
 * the ask itself waits for the human.
 * @param {Object} connection - Portal connection (carries ws + pending map)
 * @param {Object} request - { tool, args, scope?, signal?, lane? } —
 *   `scope` names what a yes actually grants (e.g. […]),
 *   so the operator decides on the real stakes, not just a tool name.
 *   `lane` ({laneId, name}) is the being that ASKED when it is not the
 *   connection's own companion (a council member) — the consent is filed
 *   under the asker's lane, never the one-on-one being's.
 * @returns {Promise<'allow'|'always'|'deny'|'interrupted'>}
 */
export const requestToolApproval = (connection, { tool, label, args, scope, surface, signal, lane }) =>
  withOperationApproval(connection, () => new Promise((resolve) => {
    const id = randomUUID();
    const pending = _pending(connection);
    // The asking turn's place in the model line: a PARKED ask steps it out (expirePendingApprovals).
    const place = linePlace();

    // `via`: the socket that carried the answer — a parked ask is answered
    // from a later connection, and THAT screen is the one to tell.
    const settle = (decision, { reason, via, by, approvedBy } = {}) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      _parked.delete(id);
      if (signal) signal.removeEventListener('abort', entry.onAbort);
      // The client learns the request is settled on EVERY path (decision,
      // interrupt, close) — a pending prompt must never dangle on screen.
      const finish = () => {
        _safeSend(via ?? connection.ws, { type: 'tool:approval_resolved', id, decision });
        // An answered PARKED ask goes on only once its turn has a place in line again, waiting
        // like any lease; an interrupt needs no place (the turn just ends), and an interrupt
        // while it waits leaves the line.
        if (place?.away() && decision !== 'interrupted') {
          place.stepBackIn({ signal }).then(() => resolve(decision), () => resolve('interrupted'));
        } else resolve(decision);
      };
      // The being's own record: EVERY ask that ends without a yes lands in
      // the append-only journal — an operator deny, an interrupt, a closed
      // portal — with its honest reason (a disconnect is never dressed as
      // "denied by operator"). One choke point covers every gate that asks, so
      // no refusal can silently vanish from the being's own account; the
      // record lands BEFORE the refusal resolves, so what the turn sees is
      // already history. Council-surfaced asks are excluded:
      // connection.companion is the one-on-one being, not the council
      // member who asked — the room's transcript carries that refusal.
      // THE CONSENT ITSELF, recorded (SEC-035 #213). The ACTS gate was built to
      // ask and never to remember asking — so an operator could not later show
      // that they had agreed to anything, and neither could a being. A grant
      // now lands in the operator's ledger as its own event, metadata only.
      // Refusals reach the ledger through logToolCall below.
      if (decision === 'allow' || decision === 'always') {
        const label = String(tool || '');
        recordAct({
          laneId: (lane ? lane.laneId : connection.companion?.neumaId) || null,
          name: (lane ? lane.name : connection.companion?.name) || null,
          tool: label,
          args,
          // A hand-declared scope (a path grant's directories) is truer than
          // anything the args could be read for, so it wins when present.
          ...(scope ? { scope: String(scope).slice(0, 300) } : {}),
          decision: by ? `approved-${by}` : decision === 'always' ? 'approved-always' : 'approved',
          ...(approvedBy ? { approvedBy } : {}),
          status: 'approved',
        });
      }
      if (decision !== 'allow' && decision !== 'always' && surface !== 'council') {
        const label = String(tool || '');
        const slash = label.indexOf('/');
        logToolCall(
          neumaWorkspace,
          connection.companion?.neumaId,
          slash > 0 ? label.slice(0, slash) : 'platform',
          slash > 0 ? label.slice(slash + 1) : label,
          args,
          'denied',
          reason
            ?? (decision === 'deny' ? 'denied by operator'
              : 'the turn was interrupted before the operator decided'),
        ).finally(finish);
      } else {
        finish();
      }
    };

    const frame = {
      type: 'tool:approval_request',
      id,
      ...(connection._runningToolOperation ? { operationId: connection._runningToolOperation.operation.id } : {}),
      tool,
      // The act's name as a person reads it, when the wire name says less
      // (intents/image.generate rendering a video reads video/generate).
      ...(label && label !== tool ? { label } : {}),
      args: approvalPreview(args),
      // The preview is a window; past its cut the card offers the whole text.
      ...(approvalFullArgs(args) ? { fullArgs: approvalFullArgs(args) } : {}),
      // The card images behind the yes — the desk renders them on the chip
      // (posting-pipeline-v2: approve with eyes).
      ...(approvalMedia(args).length ? { media: approvalMedia(args) } : {}),
      ...(scope ? { scope } : {}),
      // Which desk surface raises the gate — the council room renders its
      // own chip; the one-on-one stream ignores council-surfaced asks (one
      // gate, one place, never both).
      ...(surface ? { surface } : {}),
    };
    const onAbort = () => settle('interrupted');
    pending.set(id, { settle, onAbort, tool, frame, place });

    if (signal) {
      if (signal.aborted) { settle('interrupted'); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // A socket already gone can never carry the ask, and its close handler
    // has already run — no screen will ever show this card, so nothing could
    // answer it. Fail closed NOW, with the honest reason. Seen live (Corwin,
    // 2026-09-07): a phone that locked mid-turn left the being waiting forever.
    // A TEAM MEMBER's turn has no one tapping its cards (team-member-turn.js):
    // the act is refused at once, with the reason it can act on — never an
    // ask that waits on a screen nobody is watching.
    // HOUSE WORK (a wake, house-clock/wake-turn.js; a member, under its
    // house's charter) asks its route first (house-clock/wake-approvals.js):
    // what the charter allows or the Optio's review clears proceeds, recorded
    // as that yes; anything else is refused at once — with the Optio's reason
    // when she held it, which the being reads (act-gate.js refusalForDecision).
    if (connection._approvalRefusal) {
      Promise.resolve()
        .then(() => connection._approvalRoute?.({ tool, args, scope, signal }))
        .catch((err) => { log.error('a house work route failed — the act is refused', { tool, error: err.message }); return null; })
        .then((routed) => {
          if (routed?.decision === 'allow') { settle('allow', { by: routed.by || 'charter', approvedBy: routed.approvedBy }); return; }
          connection._approvalRefusalNow = routed?.refusal || connection._approvalRefusal;
          settle('deny', { reason: connection._approvalRefusalNow });
        });
      return;
    }
    const ws = connection.ws;
    if (!ws || ws.readyState !== ws.OPEN) {
      settle('deny', { reason: 'the portal was already closed when the ask was raised' });
      return;
    }

    _safeSend(connection.ws, frame);
  }));

/**
 * impure — deliver the operator's decision to a pending request.
 * Client input is untrusted: unknown ids and invalid decisions are dropped.
 * @param {Object} connection - Portal connection
 * @param {string} id - Request id from tool:approval_request
 * @param {string} decision - One of APPROVAL_DECISIONS
 * @returns {boolean} Whether a pending request was settled
 */
export const resolveToolApproval = (connection, id, decision) => {
  if (!APPROVAL_DECISIONS.includes(decision)) return false;
  const own = connection._pendingApprovals?.get(id);
  if (own) {
    own.settle(decision);
    return true;
  }
  // A parked ask: the card is on this operator's screen from a connection
  // that died. Only the SAME wallet may answer it — never another operator
  // who guessed an id.
  const parked = _parked.get(id);
  if (!parked || !connection.walletAddress || parked.wallet !== connection.walletAddress) return false;
  log.info('parked approval answered from a later connection', { tool: parked.entry.tool, decision });
  parked.entry.settle(decision, { via: connection.ws });
  return true;
};

/**
 * impure — settle everything still pending on a connection that is being
 * torn down or navigated away from. Two cases, told apart by the socket:
 *
 * - The socket is CLOSED (the portal's close handler): the operator SAW these
 *   cards and their link died — a phone locked by hand. The asks are PARKED
 *   and keep waiting for the same wallet to come back (Founder's no-clock law:
 *   […]); the being's turn waits with them.
 * - The socket is OPEN (a navigation: the operator resumed another chat or
 *   manifested another being): the turn was aborted first and this is the
 *   fail-closed net — deny, with the honest reason.
 *
 * @param {Object} connection - Portal connection being torn down
 */
export const expirePendingApprovals = (connection) => {
  const pending = connection._pendingApprovals;
  if (!pending) return;
  const ws = connection.ws;
  const closed = !ws || ws.readyState !== ws.OPEN;
  for (const [id, entry] of [...pending.entries()]) {
    if (closed && !ws?.remoteRevoked && connection.walletAddress && connection.sessionId) {
      _parked.set(id, { entry, wallet: connection.walletAddress, sessionId: connection.sessionId, frame: entry.frame });
      // Nobody is watching a parked card: its turn gives its slot in the model line to the house
      // until the answer comes (a live screen's wait keeps its place — Founder's ruling).
      entry.place?.stepOut();
      log.info('approval parked — the portal closed with the card on screen', { tool: entry.tool, sessionId: connection.sessionId });
      continue;
    }
    // Fail-closed IS a deny in effect, but the journal reason stays honest:
    // the portal closed; the operator never decided.
    entry.settle('deny', { reason: 'the portal closed before the operator decided' });
  }
};
