// portal-message-handlers.js — the portal's message dispatcher: the
// consciousness turn frames (stream / retry / held-queue / takes / interrupt),
// the gate responses, the sitting preferences, and notification read-marking
// stay inline; the bind, birth, seal, council, and voice groups delegate to
// their own modules. Extracted from portal-routes.js (P8
// decomposition, SIZE-033 plan) — case bodies byte-identical.
import { createLogger } from '../services/logger.js';
import {
  HOLD_ID_PATTERN, handleHeldQueueOp, queueThought,
} from '../services/held-thoughts.js';
import { neumaWorkspace, normalizeSpace } from '../../core/index.js';
import { resolveToolApproval } from '../services/tool-approval.js';
import { cancelIntentSweeps } from '../services/intents/intent-context.js';
import { resolveOperatorAsk } from '../services/operator-ask.js';
import { resolveSealRequestDeclined } from '../services/seal-request.js';
import { resolvePlanApproval } from '../services/team-plan.js';
import { resolvePlanVerdict } from '../services/plan-mode.js';
import { normalizeToolMode, normalizeChatMode, toolModeForChatMode } from '../services/tool-policy.js';
import { normalizePurpose } from '../../core/voice/purpose.js';
import { handleVoiceFrame } from '../services/portal-voice-handlers.js';
import { abortAudition } from '../services/voice/voice-audition.js';
import { checkWsRateLimit } from '../services/rate-limiter.js';
import { markNotificationsRead } from '../services/notification-store.js';
import { isValidId } from '../../core/runtime/notification-record.js';
import { portalConnections } from './portal-connections.js';
import { sendToWallet } from './portal-send.js';
import { settleActiveTurn, runTurnAndDrain, updateToolWorkspace } from './portal-context.js';
import { portalResume, portalNewSession, companionManifest } from './portal-bind-handlers.js';
import { handleCompactRequest } from '../services/portal-compact.js';
import {
  birthStart, birthRetryStage, birthNextStage, birthInterrupted,
  birthResume, birthResumeCompletion, birthAbandon,
} from './portal-birth-handlers.js';
import {
  birthEncryptKeypair, birthSealPreflight, birthSealSign, birthSealConfirm,
  houseFoundPreflight, houseFoundSign, houseFoundConfirm,
} from './portal-seal-handlers.js';
import {
  councilOpen, councilSpeak, councilResumeFrame, councilListFrame,
  councilInterruptFrame, councilOrderFrame, councilCloseFrame,
} from './portal-room-handlers.js';

const log = createLogger('Portal');

// Handle messages through the portal
export async function handlePortalMessage(connectionId, message, { birthHandler }) {
  const connection = portalConnections.get(connectionId);
  if (!connection || connection.ws?.remoteRevoked) return;

  const { ws } = connection;

  switch (message.type) {
    case 'consciousness:stream':
      if (checkWsRateLimit(connection)) {
        ws.send(JSON.stringify({
          type: 'consciousness:held',
          message: 'Too many messages. Please wait a moment.',
        }));
        break;
      }
      // The turn carries its project context as the episodic space — a project
      // IS a space (kind: 'project'). Sent only by a project-aware client; when
      // absent the space set at manifest/resume is left untouched (back-compat
      // for older clients that never speak of projects).
      if (message.space !== undefined) connection.space = normalizeSpace(message.space);
      updateToolWorkspace(connection, message.toolWorkspace);
      // The desk's handle for this word while held — invalid shapes drop.
      if (!HOLD_ID_PATTERN.test(String(message.holdId ?? ''))) delete message.holdId;
      // MID-STREAM SPEECH (ruling, 2026-07-26) — the council's two ways, in the
      // one-on-one: 'now' INTERJECTS (cut the reply, take the floor),
      // anything else HOLDS until the next completed action. The old flat refusal
      // made watching a being work read-only: destroy the turn, or wait.
      if (connection.turnPromise) {
        if (message.urgency === 'now') {
          // Cut the in-flight turn and wait for it to actually settle, so the
          // interjection never races the reply it replaced (settleActiveTurn
          // is the same helper navigation uses — one settling law).
          await settleActiveTurn(connection);
        } else {
          queueThought(connection, message);
          ws.send(JSON.stringify({
            type: 'consciousness:queued',
            held: connection.pendingThoughts.length,
            ...(message.holdId ? { holdId: message.holdId } : {}),
            message: 'Held — it goes after the current action finishes.',
          }));
          break;
        }
      }
      // Run this turn, then drain whatever the operator queued while it ran.
      await runTurnAndDrain(connection, message);
      break;

    case 'consciousness:retry': {
      // THE TAKES (ruling, 2026-07-27): ask a turn-point again as a new TAKE of
      // the same point, never a new post. The frame names the point only —
      // the words and attachments come from the RECORD (resolveRetryTurn);
      // the bubble is never the source of truth.
      if (checkWsRateLimit(connection)) {
        ws.send(JSON.stringify({
          type: 'consciousness:held',
          message: 'Too many messages. Please wait a moment.',
        }));
        break;
      }
      const raw = message.retry && typeof message.retry === 'object' ? message.retry : {};
      // The EDIT-fork (ruling, 2026-07-28): a retry may carry the operator's REVISED
      // words. The point itself is still named by turnId — the revision rides
      // as the new take's ask (append-only; the recorded words never move).
      const revisedThought = typeof raw.thought === 'string' ? raw.thought.trim().slice(0, 20000) : '';
      const retry = {
        ...(typeof raw.turnId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(raw.turnId) ? { turnId: raw.turnId } : {}),
        ...(typeof raw.content === 'string' ? { content: raw.content.slice(0, 20000) } : {}),
        ...(typeof raw.timestamp === 'string' ? { timestamp: raw.timestamp } : {}),
        ...(revisedThought ? { thought: revisedThought } : {}),
      };
      if (!retry.turnId && retry.content === undefined) {
        ws.send(JSON.stringify({
          type: 'consciousness:stream',
          content: '[Retry refused] the frame named no turn-point.',
          companion: connection.companion?.name,
          error: true,
        }));
        ws.send(JSON.stringify({ type: 'consciousness:complete', companion: connection.companion?.name }));
        break;
      }
      if (message.space !== undefined) connection.space = normalizeSpace(message.space);
      updateToolWorkspace(connection, message.toolWorkspace);
      // Attachments ride along only so the turn can refuse them out loud — a
      // retry answers the recorded point and never silently drops new ones.
      const retryMessage = {
        type: message.type, retry, preset: message.preset,
        ...(Array.isArray(message.attachments) && message.attachments.length ? { attachments: message.attachments } : {}),
      };
      if (connection.turnPromise) {
        // The same held-words semantics as a thought — the take goes the
        // next completed action in the in-flight turn (interjection is for speech,
        // not versioning).
        queueThought(connection, retryMessage);
        ws.send(JSON.stringify({
          type: 'consciousness:queued',
          held: connection.pendingThoughts.length,
          message: 'Held — it goes after the current action finishes.',
        }));
        break;
      }
      await runTurnAndDrain(connection, retryMessage);
      break;
    }

    // THE HELD WORD STAYS THE OPERATOR'S (ruling, 2026-08-16) — the three queue
    // doors (edit / now / pull), answered in services/held-thoughts.js.
    case 'consciousness:queue_edit':
    case 'consciousness:queue_now':
    case 'consciousness:queue_pull':
      await handleHeldQueueOp(connection, ws, message, {
        rateLimited: () => checkWsRateLimit(connection),
        settle: () => settleActiveTurn(connection),
        run: (taken) => runTurnAndDrain(connection, taken),
      });
      break;

    case 'consciousness:take_view': {
      // The operator switched which take of a point they are looking at. The
      // view is an append-only fact in the SAME record (branch-view.js) — it
      // survives reload because it lives in the lane, the same doctrine as
      // everything else there. The desk re-folds locally; this is the record.
      const turnId = typeof message.turnId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(message.turnId)
        ? message.turnId : null;
      const takeIndex = Number.isInteger(message.takeIndex) && message.takeIndex >= 1
        ? message.takeIndex : null;
      const laneId = connection.companion?.neumaId;
      if (turnId && takeIndex && laneId && connection.sessionId) {
        try {
          await neumaWorkspace.appendBranchView(laneId, connection.sessionId, { [turnId]: takeIndex });
          ws.send(JSON.stringify({ type: 'consciousness:take_view', turnId, takeIndex }));
        } catch (err) {
          log.warn('branch-view marker not written', { neumaId: laneId, err: err?.message });
        }
      }
      break;
    }

    case 'consciousness:interrupt':
      // The operator cuts the in-flight response (cancel-and-revise). The
      // abort surfaces inside streamConsciousness, which completes the turn
      // marked interrupted — no reply is sent from here. Frames arrive
      // concurrently per ws 'message' event, so this reaches a turn that is
      // still awaiting its stream. A forge audition speaking is cut too.
      cancelIntentSweeps(connection);
      abortAudition(connection);
      if (connection.activeTurn) connection.activeTurn.abort();
      else if (connection.turnPromise) { connection.interruptRequested = true; connection.lineWait?.abort(); }
      break;

    case 'tool:approval_response':
      // The operator's answer to a pending tool approval. Untrusted input —
      // the broker drops unknown ids and invalid decisions.
      resolveToolApproval(connection, message.id, message.decision);
      break;

    case 'operator:ask_response':
      // The operator's answer to a being's pending question. Untrusted input —
      // the broker drops unknown ids and empty answers.
      resolveOperatorAsk(connection, message.id, message.answer, message.answers);
      break;

    case 'operator:plan_response':
      // The operator's verdict on a submitted plan. Untrusted input — each
      // broker drops ids it does not own and decisions it does not know.
      // PLAN MODE's registry answers first (its ids are its own); a team
      // plan's verdict falls through to the team broker untouched.
      if (resolvePlanVerdict(connection, message.id, message.decision, message.notes)) break;
      resolvePlanApproval(connection, message.id, message.decision, message.notes);
      break;

    case 'seal:self_decline':
      // The operator declined a being's anchor request. Untrusted input —
      // the broker drops unknown ids; the reason is clamped.
      resolveSealRequestDeclined(connection, message.id, message.reason);
      break;

    case 'tool:mode':
      // The operator's standing stance on tool acts for this session
      // (ask / auto / observe). Unknown values fail to 'ask'; the ack
      // carries the server truth back so the desk never shows a stance
      // the portal isn't holding.
      connection.toolMode = normalizeToolMode(message.mode);
      ws.send(JSON.stringify({ type: 'tool:mode', mode: connection.toolMode }));
      break;

    case 'chat:mode':
      // The operator's standing CHAT mode (default / plan / auto) — the
      // composer's chip. One declaration carries both: the mode itself and
      // the ACTS tier derived from it (default→ask, plan→observe,
      // auto→auto), so the two can never disagree. Unknown values fail to
      // 'default'; BOTH acks carry the server truth back (a plan verdict
      // flips the mode through this same pair — plan-mode.js).
      connection.chatMode = normalizeChatMode(message.mode);
      connection.toolMode = toolModeForChatMode(connection.chatMode);
      ws.send(JSON.stringify({ type: 'chat:mode', mode: connection.chatMode }));
      ws.send(JSON.stringify({ type: 'tool:mode', mode: connection.toolMode }));
      break;

    case 'session:compact':
      // The operator's /compact — the boundary's own torch-passing, on their word.
      await handleCompactRequest(connection);
      break;

    case 'session:purpose':
      // The operator's declared purpose for this sitting (work / conversation).
      // CLIENT-ORIGINATED ONLY — no being tool may ever write purpose (threat
      // control #4, purpose misuse): these portal frames are the only writers.
      // Unknown values fail closed to 'work'; the ack carries the server truth
      // back so the desk never shows a purpose the portal isn't holding.
      connection.purpose = normalizePurpose(message.purpose);
      ws.send(JSON.stringify({ type: 'session:purpose', purpose: connection.purpose }));
      break;

    // --- the voice frames: VOX toggle + live voice sitting (portal-voice-handlers.js)
    case 'voice:pref':
    case 'voice:mic_open':
    case 'voice:mic_close':
    case 'voice:mic_pcm':
    case 'voice:flush':
    case 'voice:speech_start':
    case 'voice:cancel':
    case 'voice:audition':
      await handleVoiceFrame(connection, message);
      break;

    case 'notification:read': {
      // THE OPERATOR READ SOMETHING. Read state is server-side on purpose:
      // with several desks open, marking a card read in one must clear the
      // badge in the others — written here and echoed to EVERY desk,
      // including the sender, so windows converge rather than agree by luck.
      //
      // Ids arrive from the client and are untrusted: each is validated against
      // the record contract's charset before it reaches the store. A batched
      // array rather than one frame per card, because the inbound rate limit is
      // 30 frames/60s and clearing a full tray card-by-card would trip it.
      const ids = (Array.isArray(message.ids) ? message.ids : [message.id])
        .filter((id) => isValidId(id));
      if (ids.length === 0) break;
      // `dismiss` takes the cards out of the tray too (the × and CLEAR), on
      // every desk and after a reload; the records stay in the file.
      const dismiss = message.dismiss === true;
      markNotificationsRead(connection.walletAddress, ids, Date.now(), { dismiss })
        .then(() => {
          sendToWallet(connection.walletAddress, { type: dismiss ? 'notification:dismissed' : 'notification:read', ids });
        })
        .catch((error) => {
          log.error('Notification read-marking failed', { error: error.message, count: ids.length });
        });
      break;
    }

    case 'council:open':
      await councilOpen(connection, message);
      break;

    case 'council:say':
      await councilSpeak(connection, message);
      break;

    case 'council:resume':
      await councilResumeFrame(connection, message);
      break;

    case 'council:list':
      await councilListFrame(connection);
      break;

    case 'council:interrupt':
      councilInterruptFrame(connection);
      break;

    case 'council:order':
      councilOrderFrame(connection);
      break;

    case 'council:close':
      await councilCloseFrame(connection);
      break;

    case 'birth:start':
      await birthStart(connection, message, { birthHandler });
      break;

    case 'birth:retry_stage':
      await birthRetryStage(connection, message, { birthHandler });
      break;

    case 'birth:next_stage':
      await birthNextStage(connection, message, { birthHandler });
      break;

    case 'birth:encrypt_keypair':
      await birthEncryptKeypair(connection, message);
      break;

    case 'birth:seal_preflight':
      await birthSealPreflight(connection, message);
      break;

    case 'birth:seal_sign':
      await birthSealSign(connection, message);
      break;

    case 'birth:seal_confirm':
      await birthSealConfirm(connection, message);
      break;

    case 'house:found_preflight':
      await houseFoundPreflight(connection, message);
      break;

    case 'house:found_sign':
      await houseFoundSign(connection, message);
      break;

    case 'house:found_confirm':
      await houseFoundConfirm(connection, message);
      break;

    case 'birth:interrupted':
      await birthInterrupted(connection, message, { birthHandler });
      break;

    case 'birth:resume':
      await birthResume(connection, message, { birthHandler });
      break;

    case 'birth:resume_completion':
      await birthResumeCompletion(connection, message, { birthHandler });
      break;

    case 'birth:abandon':
      await birthAbandon(connection, message, { birthHandler });
      break;

    case 'portal:resume':
      return portalResume(connection, message, { connectionId });

    case 'portal:new-session':
      return portalNewSession(connection, message, { connectionId });

    case 'companion:manifest':
      return companionManifest(connection, message);

    default:
      log.warn('Unknown portal message', { type: message.type });
  }
}
