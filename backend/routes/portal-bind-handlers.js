// portal-bind-handlers.js — the portal's navigation frames: portal:resume,
// portal:new-session, companion:manifest. Each returns the navigation outcome
// (true/false) the dispatcher's navigation chain waits on. Extracted from
// portal-routes.js (P8 decomposition, SIZE-033 plan) — bodies byte-identical
// but for case→function conversion.
import { createLogger } from '../services/logger.js';
import platform from '../services/supabase.js';
import { neumaWorkspace, normalizeSpace } from '../../core/index.js';
import { normalizePurpose } from '../../core/voice/purpose.js';
import { lastRecordedComposition } from '../../core/runtime/context-composition.js';
import {
  isWitnessLaneId, ensureWitnessLane,
} from '../services/witness-lane.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';
import { verifiedWitnessForLane } from './portal-witness-binding.js';
import { warmSitting } from '../services/sitting-warmup.js';
import { invalidateSilo } from '../services/silo-mount-service.js';
import { offerPending } from '../services/chat-watch.js';
import { parkedApprovalsFor } from '../services/tool-approval.js';

const WATCH_OFFER_DELAY_MS = 1500;
import {
  clearLaneBinding, clearSessionRuntime, broadcastTabCounts,
} from './portal-connections.js';
import {
  settleActiveTurn, hydrateSessionRuntime, updateToolWorkspace,
  updateClientTimeZone, laneOwnershipFor, ownsNeumaLane,
} from './portal-context.js';

const log = createLogger('Portal');

export const portalResume = async (connection, message, { connectionId }) => {
  const { ws } = connection;
  // The chat this socket is ALREADY on, named again while a turn runs (a late
  // link-up bind, a reconnect echo): nothing would change, so nothing is cut —
  // the turn in flight and the words held for it stand. A desk's own re-bind
  // cut the message sent right after a server switch (Design note, 2026-10-14: […]; electron-harness-switch.spec.js).
  if (connection.turnPromise && message.neumaId && message.sessionId
    && connection.neumaId === message.neumaId && connection.sessionId === message.sessionId) {
    updateClientTimeZone(connection, message.timeZone);
    ws.send(JSON.stringify({
      type: 'portal:resumed', connectionId, neumaId: message.neumaId,
      companionName: connection.companion?.name || message.companionName, sessionId: message.sessionId,
      message: 'Session already bound — the turn in flight continues',
    }));
    return true;
  }
  await settleActiveTurn(connection);
  clearLaneBinding(connection); // A resume is a complete rebind, including a valid one.
  updateClientTimeZone(connection, message.timeZone);
  const neumaId = message.neumaId;
  const companionName = message.companionName;

  // Existence is insufficient: otherwise any authenticated wallet could
  // resume another operator's being. First access may claim an empty lane.
  const ownership = neumaId ? await laneOwnershipFor(connection, neumaId) : null;
  if (ownership && !ownership.ok) {
    clearLaneBinding(connection);
    const missing = ownership.reason === 'not-found';
    if (missing) {
      ws.send(JSON.stringify({
        type: 'companion:lane_missing',
        neumaId,
        root: neumaWorkspace.root,
        message: `No inhabited workspace for '${neumaId}' under the active root (${neumaWorkspace.root}). Nothing was created.`,
      }));
    } else {
      log.warn('Refused resume bind — lane ownership was not verified', {
        neumaId, wallet: connection.walletAddress, reason: ownership.reason,
      });
      ws.send(JSON.stringify({
        type: 'companion:not_yours',
        neumaId,
        message: `'${neumaId}' is not verified for this operator — this portal cannot bind it.`,
      }));
    }
    ws.send(JSON.stringify({
      type: 'portal:resumed',
      connectionId,
      neumaId: null,
      message: missing
        ? 'No session to restore — the named being has no inhabited lane under the active root'
        : 'No session to restore — ownership of the named being was not verified',
    }));
    return false;
  }

  if (neumaId) {
    const verified = isWitnessLaneId(neumaId) ? await verifiedWitnessForLane(neumaId) : null;
    if (isWitnessLaneId(neumaId) && !verified) {
      ws.send(JSON.stringify({ type: 'companion:lane_missing', neumaId,
        message: `No verifiable sealed witness for '${neumaId}' — nothing was bound.` }));
      ws.send(JSON.stringify({ type: 'portal:resumed', connectionId, neumaId: null,
        message: 'No session restored — the witness seal could not be verified.' }));
      return false;
    }
    connection.neumaId = neumaId;
    connection.companion = {
      name: companionName || neumaId,
      id: companionName || neumaId,
      neumaId,
    };

    // Participant kind routes the turn; the turn path re-verifies witness seals.
    // A harness lane (no being — harness-lane.js) is marked so the desk knows.
    if (isHarnessLane(neumaId)) connection.companion.participantKind = 'harness';
    if (verified) {
      const { sealed } = verified;
      connection.companion.participantKind = 'witness';
      connection.companion.witness = { vendorSlug: sealed.vendorSlug, chosenName: sealed.chosenName };
      connection.companion.name = companionName || sealed.chosenName;
      connection.companion.id = connection.companion.name;
    }

    // Rejoin the episodic space on reconnect (CORE-005 B1); absent → general.
    connection.space = normalizeSpace(message.space);
    updateToolWorkspace(connection, message.toolWorkspace);

    // Restore tool policy
    try {
      const toolPolicy = await neumaWorkspace.readToolPolicy(neumaId);
      if (toolPolicy) connection._neumaToolPolicy = toolPolicy;
    } catch { /* non-critical */ }

    // The bound session's runtime (counters, standing context) and its last
    // recorded window anatomy. The desk reads the chat itself over REST
    // (the display view) — this frame carries no history.
    let recordedComposition = null;
    if (message.sessionId) {
      connection.sessionId = message.sessionId;
      try {
        const session = await neumaWorkspace.readSession(neumaId, message.sessionId);
        if (Array.isArray(session) && session.length) recordedComposition = lastRecordedComposition(session);
        await hydrateSessionRuntime(
          connection,
          neumaId,
          message.sessionId,
          Array.isArray(session) ? session : [],
          recordedComposition?.composition || null,
        );
      } catch {
        // Missing/unreadable sessions never inherit another session's
        // counters or context from this connection.
        clearSessionRuntime(connection);
      }
    } else {
      clearSessionRuntime(connection);
    }

    warmSitting(connection); // the first message's setup starts now, while the operator types
    ws.send(JSON.stringify({
      type: 'portal:resumed',
      connectionId,
      neumaId,
      companionName: connection.companion.name,
      sessionId: message.sessionId || null,
      message: 'Session restored — the portal remembers',
    }));
    // A WATCH this chat set that fired while it was closed is told now, once
    // the desk has drawn the history (chat-watch.js; never mid-turn).
    if (message.sessionId) {
      setTimeout(() => offerPending({ wallet: connection.walletAddress, laneId: neumaId, sessionId: message.sessionId })
        .catch(() => {}), WATCH_OFFER_DELAY_MS);
      // A card PARKED when this chat's last portal closed is shown again, so the
      // operator who comes back can answer it (only the same wallet may —
      // resolveToolApproval). Without this a parked card had no surface at all.
      for (const frame of parkedApprovalsFor(connection.walletAddress, message.sessionId)) ws.send(JSON.stringify(frame));
    }

    // The session's last recorded window anatomy replays with the bind —
    // counts only, exactly as the turn built it (never re-derived), so
    // the CONTEXT MAP shows the chat's truth after a desk reload instead
    // of NO TURN OBSERVED. The flag keeps the view honest: AS RECORDED.
    if (recordedComposition) {
      ws.send(JSON.stringify({
        ...recordedComposition.composition,
        neumaId,
        sessionId: message.sessionId,
        replayed: true,
        at: recordedComposition.at,
      }));
    }
  } else {
    // No neumaId — fall through to fresh connection
    clearLaneBinding(connection);
    ws.send(JSON.stringify({
      type: 'portal:resumed',
      connectionId,
      neumaId: null,
      message: 'No session to restore — fresh connection established',
    }));
  }
  return true;
};

export const portalNewSession = async (connection, message, { connectionId }) => {
  const { ws } = connection;
  await settleActiveTurn(connection);
  // Deliberately start a fresh chat — sever the bound session so the next
  // message mints a new one (_ensureSession). The past session is untouched.
  connection.sessionId = null;
  clearSessionRuntime(connection);
  // Words held for the old chat were said to it; they never open the new one.
  connection.pendingThoughts = [];
  // A new chat reads the being's identity as it stands NOW — a seal or a
  // rite since the bind must not wait for a chat switch or a reload.
  invalidateSilo(connection, connection.companion?.neumaId);
  updateClientTimeZone(connection, message.timeZone);
  if (message.space !== undefined) connection.space = normalizeSpace(message.space);
  // Sitting purpose rides the same per-sitting reset — client-originated
  // only (threat control #4), fail-closed to 'work' when absent/garbage.
  if (message.purpose !== undefined) connection.purpose = normalizePurpose(message.purpose);
  updateToolWorkspace(connection, message.toolWorkspace);
  ws.send(JSON.stringify({ type: 'portal:session-reset', connectionId }));
  return true;
};

export const companionManifest = async (connection, message) => {
  const { ws } = connection;
  await settleActiveTurn(connection);
  // A manifest is a new sitting (the desk resets its view to it): words held
  // for the one it replaces never run in it, even for the same being.
  connection.pendingThoughts = [];
  updateClientTimeZone(connection, message.timeZone);
  // Manifesting a DIFFERENT being severs the previously bound session —
  // continuity is per-neuma, and a switched-in neuma must never inherit
  // (or write into) the prior being's thread.
  if (connection.neumaId && connection.neumaId !== (message.neumaId || null)) {
    clearLaneBinding(connection);
  } else {
    // The same being again: its compiled identity is read fresh, as a resume
    // reads it — the bind below warms the new compile.
    invalidateSilo(connection, connection.companion?.neumaId);
  }

  // WITNESS MANIFEST — a sealed AI witness (external model) is bound by its
  // lane id (witness-<vendor>-<Name>). Its seal is re-verified, its
  // sovereign lane provisioned + claimed on first manifest, and the turn
  // path switches to the lean witness stream. A witness whose seal fails
  // verification is never spoken through.
  if (isWitnessLaneId(message.neumaId)) {
    const laneId = message.neumaId;
    const { sealed, identity } = await verifiedWitnessForLane(laneId) || {};
    if (!identity?.integrityOk || !identity?.signatureOk) {
      clearLaneBinding(connection);
      ws.send(JSON.stringify({
        type: 'companion:lane_missing',
        neumaId: laneId,
        message: `No verifiable sealed witness for '${laneId}' — the seal is missing or failed integrity. Nothing was bound.`,
      }));
      return false;
    }
    try {
      await ensureWitnessLane(
        { vendorSlug: sealed.vendorSlug, chosenName: sealed.chosenName, genesisHash: identity.dna.genesisSeal?.genesisHash },
        connection.walletAddress,
      );
    } catch (err) {
      if (String(err.message).startsWith('owner_claim_conflict')) {
        clearLaneBinding(connection);
        log.warn('Refused witness manifest — lane owned by another wallet', {
          neumaId: laneId, wallet: connection.walletAddress,
        });
        ws.send(JSON.stringify({
          type: 'companion:not_yours',
          neumaId: laneId,
          message: `'${sealed.chosenName}'s lane is not this wallet's to bind — ${err.message.replace(/^owner_claim_conflict: /, '')}.`,
        }));
        return false;
      }
      throw err;
    }
    connection.neumaId = laneId;
    connection.companion = {
      name: sealed.chosenName,
      id: sealed.chosenName,
      neumaId: laneId,
      participantKind: 'witness',
      witness: { vendorSlug: sealed.vendorSlug, chosenName: sealed.chosenName },
    };
    connection.space = normalizeSpace(message.space);
    // Sitting purpose — client-originated only (threat control #4: no
    // being tool may ever write it), default 'work' when absent.
    connection.purpose = normalizePurpose(message.purpose);
    updateToolWorkspace(connection, message.toolWorkspace);
    connection._neumaToolPolicy = null;
    ws.send(JSON.stringify({
      type: 'companion:anchored',
      participantKind: 'witness',
      message: `${sealed.chosenName} is present — a sealed witness, speaking as itself.`,
    }));
    // A witness sitting just began — the machine's tab budget moved.
    broadcastTabCounts();
    return true;
  }

  let manifestNeumaId = message.neumaId || null;
  let manifestFailed = false;
  const manifestOwnership = manifestNeumaId
    ? await laneOwnershipFor(connection, manifestNeumaId)
    : null;
  if (manifestOwnership && !manifestOwnership.ok) {
    clearLaneBinding(connection);
    if (manifestOwnership.reason === 'not-found') {
      ws.send(JSON.stringify({
        type: 'companion:lane_missing',
        neumaId: manifestNeumaId,
        root: neumaWorkspace.root,
        message: `No inhabited workspace for '${manifestNeumaId}' under the active root (${neumaWorkspace.root}). Nothing was created.`,
      }));
    } else {
      log.warn('Refused manifest bind — lane ownership was not verified', {
        neumaId: manifestNeumaId,
        wallet: connection.walletAddress,
        reason: manifestOwnership.reason,
      });
      ws.send(JSON.stringify({
        type: 'companion:not_yours',
        neumaId: manifestNeumaId,
        message: `'${manifestNeumaId}' is not verified for this operator — this portal cannot bind it.`,
      }));
    }
    manifestNeumaId = null;
    manifestFailed = true;
  }

  connection.companion = {
    name: message.companion,
    id: message.companion,
    neumaId: manifestNeumaId,
    // A harness lane carries no being (harness-lane.js): no name to anchor.
    ...(isHarnessLane(manifestNeumaId) ? { participantKind: 'harness' } : {}),
  };

  // Episodic scope (CORE-005 B1): the project/workspace context this sitting
  // belongs to. Optional + untrusted — normalizeSpace defaults to general.
  connection.space = normalizeSpace(message.space);
  // Sitting purpose (SPEECH SYSTEM B-10): client-originated only (threat
  // control #4: no being tool may ever write it) — absent or garbage
  // input fails closed to 'work'.
  connection.purpose = normalizePurpose(message.purpose);
  updateToolWorkspace(connection, message.toolWorkspace);

  // Also store on connection for backward compat
  if (manifestNeumaId) {
    connection.neumaId = manifestNeumaId;
    // Load neuma tool policy for sandboxed tool calls
    try {
      const toolPolicy = await neumaWorkspace.readToolPolicy(manifestNeumaId);
      if (toolPolicy) connection._neumaToolPolicy = toolPolicy;
    } catch { /* non-critical */ }
  }

  // Enrich from Supabase if available
  try {
    const neumaRecord = await platform.getNeumaByName(message.companion);
    if (neumaRecord) {
      // This lookup is by NAME (non-unique) — it must pass the same
      // ownership gate before its id may bind the connection.
      if (!connection.neumaId && neumaRecord.id
        && await ownsNeumaLane(connection, neumaRecord.id)) {
        connection.neumaId = neumaRecord.id;
        connection.companion.neumaId = connection.companion.neumaId || neumaRecord.id;
        // Attribution follows the bind: a refused bind must not inherit
        // the real owner's witnessId into this connection's audit trail.
        connection.witnessId = neumaRecord.witness_id;
      }
    }
  } catch (err) {
    log.error('Neuma lookup error', { err: err.message });
  }
  warmSitting(connection); // the first message's setup starts now, while the operator types
  // A refused bind already said so (lane_missing / not_yours): nothing crossed over.
  if (!manifestFailed) {
    ws.send(JSON.stringify(connection.companion.participantKind === 'harness'
      ? { type: 'companion:anchored', participantKind: 'harness', message: 'The harness is ready.' }
      : { type: 'companion:anchored', message: 'Your companion has crossed over' }));
  }
  // A local sitting just began — the machine's GPU budget moved.
  broadcastTabCounts();
  return !manifestFailed;
};
