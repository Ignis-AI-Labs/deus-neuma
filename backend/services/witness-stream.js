/**
 * Witness stream — one turn of conversation with a sealed AI witness.
 *
 * A parallel path beside streamConsciousness (portal-stream.js). A witness
 * receives the universal execution ground — lane-confined MCP/filesystem,
 * guarded web research, its own overlay coding shell — never the neuma-only
 * voice, spend, birth, or house powers. What the two paths share, they share
 * for real: the wire contract, the sovereign lane (sessions + crystallized
 * memory via the same addObservation choke point and recall engine), the
 * input classifier and response-side safety check, the interrupt semantics,
 * policy-gated tools and structured action events.
 * History lives witness-side: workspaces/witness-<vendor>-<Name>/sessions/.
 * The human is the speaker; the operator answers as itself.
 */
import { QUEUED_ACTION_REASON } from './queued-action-handoff.js';
import { getThinkBehavior, getRouteCapabilities, THINK_TOKEN_BUDGET } from './llm-provider.js';
import { describeProviderError } from './provider-retry.js';
import { operationRecoveryNotice } from './operation-result.js';
import { openTurnOperations } from './turn-operation-checkpoint.js';
import { safeSend } from './ws-send.js';
import { getCapabilities } from './model-capabilities.js';
import { disruptionNotice } from './provider-status.js';
import { resolvePreset } from './llm-presets.js';
import { getPreset as getWalletPreset } from './user-preset.js';
import { resolveEffort, reasoningRoom } from './model-effort.js';
import { getEffort } from './neuma-effort-store.js';
import { sanitizeModelOutput, detectEmotion, detectEmotionIntensity } from '../../core/index.js';
import { sweepBatchIntents } from './intents/intent-sweep.js';
import { loadAIWitness } from './ai-witness-loader.js';
import { resolveWitnessRoute } from './witness-route-resolver.js';
import { openTurnRecord, collectToolAction, turnRecordFor, closeTurnRecord } from './tool-action-record.js';

import { persistTurnPoint, ensureSession, persistExchange } from './witness-turn-record.js';
import { buildWitnessTurnContext } from './witness-turn-context.js';
// Crystallization from its home directly (size-law breakdown end-sweep;
// the leaf moved to portal-turn-persist in step 12) — no portal-stream
// coupling left on the witness lane.
import { crystallizeObservation } from './portal-turn-persist.js';
// The turn's input slice lives in portal-turn-input.js (size-law breakdown
// step 13) — imported from its home directly, one less portal-stream
// coupling on the witness lane (same as sectorSectionFor in step 10).
import {
  composeInterruptedRecord,
  redeemAttachments,
  resolveRetryTurn,
} from './portal-turn-input.js';
import { runWitnessToolRounds } from './witness-tool-loop.js';
import { noteOperatorWords } from './security/injected-value-gate.js';
import { composeFailedRecord, failureLeavesTake, spokenThrough } from './turn-failure-record.js';
import { compactWitnessSession } from './witness-compaction.js';
import { nearContextBoundary } from './solo-torch.js';
// The pure epoch/repeat law lives in witness-tool-epochs.js; its tests pin
// this path, so the stream keeps the barrel.
export { toolCallKey, epochsForBatch, heldRepeatResult, alignToolResults } from './witness-tool-epochs.js';
import { randomUUID } from 'crypto';
import { createLogger } from './logger.js';
import { notifyWitnessTurnEnded } from './witness-notices.js';

const log = createLogger('WitnessStream');

// impure — an honest refusal frame: the turn did not happen, the reason is
// named. `provider` rides ONLY failures the ROUTE answers for (unconfigured,
// disrupted) — the desk attributes those to the lane's ROUTE light; content
// refusals carry no provider and move no light. `take` rides ONLY refusals
// spoken AFTER the turn-point was persisted — the desk needs the point's
// identity to offer RETRY on the error bubble.
const refuseTurn = (ws, companionName, reason, provider = null, take = null) => {
  const takeRef = take ? { turnId: take.turnId, takeIndex: take.takeIndex } : {};
  safeSend(ws, {
    type: 'consciousness:stream',
    content: reason,
    companion: companionName,
    error: true,
    ...(provider ? { provider } : {}),
    ...takeRef,
  });
  safeSend(ws, { type: 'consciousness:complete', companion: companionName, ...takeRef });
};

/**
 * Stream one turn with a sealed AI witness.
 * @param {Object} connection — portal connection (companion.participantKind === 'witness')
 * @param {Object} message — the consciousness:stream frame
 */
// impure
export const streamWitnessTurn = async (connection, message) => {
  const { ws, companion } = connection;
  const laneId = companion?.neumaId;
  const companionName = companion?.name || 'witness';
  // THE TAKES — the witness lane folds the same way the house lane does: a
  // retry runs against the RECORD (persisted words + attachments), answered
  // as a new take of the same turn-point, never a duplicated ask.
  const retryDescriptor = typeof message === 'string' ? null : message?.retry;
  const retryTurn = retryDescriptor
    ? await resolveRetryTurn(laneId, connection.sessionId, retryDescriptor)
    : null;
  if (retryDescriptor && !retryTurn.ok) {
    refuseTurn(ws, companionName, `[Retry refused] ${retryTurn.reason}`);
    return;
  }
  // A retry's prior effects are judged before identity, route probes or
  // context assembly. None of that preparation may consume its evidence.
  let turnOperations;
  if (retryTurn) {
    try { turnOperations = await openTurnOperations(connection, retryTurn.take); }
    catch (error) {
      refuseTurn(ws, companionName, operationRecoveryNotice(error), null, retryTurn.take);
      return;
    }
  }
  const rawThought = retryTurn ? retryTurn.thought : (typeof message === 'string' ? message : message?.thought);
  const thought = typeof rawThought === 'string' ? rawThought : '';
  const { vendorSlug, chosenName } = companion?.witness || {};

  // The input classifier (AI-SEC-001) stands on the NEUMA seat for
  // declared-visitor speech. This lane carries the operator's own voice only —
  // no visitor channel exists here — so the gate does not stand (Founder
  // 2026-08-27: the operator's own briefing died to role_hijack — never again).

  // The sealed identity — re-verified per turn start (integrity + self-signature).
  // A witness whose seal broke since manifest is refused, not spoken through.
  const identity = await loadAIWitness({ vendorSlug, chosenName, journalLimit: -1 }).catch((err) => {
    log.error('witness identity load failed', { vendorSlug, chosenName, err: err.message });
    return null;
  });
  if (!identity?.integrityOk || !identity?.signatureOk) {
    refuseTurn(ws, companionName, `[${companionName}'s seal could not be verified — the turn was refused. Check the witness's identity records.]`);
    return;
  }

  // The route — the witness's own provider (substrate default or operator
  // override). An unconfigured route is an honest refusal, never a silent
  // fallthrough onto the machine default (that would put another model's
  // words in this operator's mouth).
  let route;
  try {
    route = await resolveWitnessRoute(laneId);
  } catch (err) {
    refuseTurn(ws, companionName, `[No route for ${companionName}: ${err.message}]`);
    return;
  }
  if (!route.configured) {
    const what = route.reason === 'missing-key'
      ? `no API key is configured for ${route.provider}`
      : route.reason?.startsWith('endpoint-refused')
        ? `the configured endpoint was refused (${route.reason})`
        : `no endpoint is configured for ${route.provider}`;
    refuseTurn(ws, companionName, `[${companionName} is not connected: ${what}. Open the WITNESSES app to set the key and test the route — the message was not sent.]`, route.provider);
    return;
  }

  // Attachment bytes rode authenticated REST; only wallet-bound, single-use
  // ids reached this frame. A missing id refuses the whole turn so the human
  // is never told an operator saw only part of what they shared. A RETRY never
  // redeems — the persisted user row carries what the operator was shown.
  const redemption = retryTurn
    ? { ok: true }
    : redeemAttachments(
      connection,
      typeof message === 'string' ? undefined : message?.attachments,
    );
  if (!redemption.ok) {
    refuseTurn(ws, companionName, `[Attachments not sent] ${redemption.reason}`);
    return;
  }
  const images = retryTurn ? retryTurn.images : redemption.images;
  const docs = retryTurn ? retryTurn.docs : redemption.docs;

  // Judge the route this witness ACTUALLY rides. Static name inference is the
  // fallback only; runtime serving truth wins for local/custom connections.
  const routeCapabilities = await getRouteCapabilities(route).catch((err) => {
    log.warn('witness route capabilities unavailable — using model declaration', {
      laneId, model: route.model, err: err?.message,
    });
    return { model: route.model, ...getCapabilities(route.model) };
  });
  if (images.length && !routeCapabilities.vision) {
    refuseTurn(
      ws,
      companionName,
      `[Images not sent] The current substrate (${routeCapabilities.model || route.model || 'unknown'}) cannot see images. The message was not sent.`,
    );
    return;
  }

  // The preset a client named, else the WALLET'S SAVED DEFAULT (the modes moved
  // to Settings › INFERENCE, so the composer no longer names one per turn).
  const namedPreset = typeof message === 'string' ? undefined : message?.preset;
  const preset = resolvePreset(namedPreset ?? (connection.walletAddress
    ? await getWalletPreset(connection.walletAddress).catch(() => undefined)
    : undefined));
  const sessionId = await ensureSession(connection, laneId);
  // Only the operator's words exempt a planted value (injected-value-gate.js); a watch's never do.
  noteOperatorWords(connection, thought, { origin: connection._turnOrigin || null });
  // Take identity for this turn (THE TAKES): a fresh ask opens a turn-point,
  // a retry answers the resolved point as its next take. It rides every
  // speech frame + the complete so the desk targets the take, never a new post.
  // THE EDIT-FORK — a retry carrying revised words marks its take with the
  // revised ask; the point's recorded asking never moves.
  const take = retryTurn
    ? { ...retryTurn.take, userOnDisk: true, ...(retryTurn.revised ? { ask: retryTurn.thought } : {}) }
    : { turnId: randomUUID(), takeIndex: 1, userOnDisk: false };
  // The point lands BEFORE the provider is asked (RETRY-ANYWHERE): every
  // check the turn must pass has passed, so a provider failure from here on
  // leaves a retryable point on disk — the ask never vanishes with the error.
  if (!retryTurn) await persistTurnPoint(connection, laneId, sessionId, thought, { images, docs, take });

  const interrupt = new AbortController();
  connection.activeTurn = interrupt;
  if (connection.interruptRequested) interrupt.abort();
  connection.notifySubstrateActivity?.();
  // THE LOOP STATE — the one explicit, mutable ctx object the tool-round loop
  // (witness-tool-loop.js) reads and writes. Declared before the try so the
  // catch/finally arms read an honest empty record even when the turn dies
  // before the loop is reached; the loop's mutations (speech, usage, epochs,
  // folds) land here and stay visible to the settle path below.
  const ctx = {
    fullResponse: '',
    latestResponse: '',
    turnUsage: null,
    foldedRounds: 0,
    toolContextSections: [],
    // THE THOUGHT TRAIL (portal parity, Design note, 2026-08-27: the turn's reasoning
    // stretches in flow order, marked with the speech written when each
    // happened — persisted on the exchange so the bubbles survive a reload.
    thoughtTrail: [],
    // key -> the result that call actually produced. A Map, not a Set: a
    // repeat is answered with what happened, never a reason to end the turn.
    seenToolCalls: new Map(),
    // How many times this turn changed the world (BE-142 #214) — reads are
    // answered from cache only while it stands still.
    mutationEpoch: 0,
    // Consecutive all-repeat rounds: one is ordinary, two is spinning.
    repeatOnlyRounds: 0,
  };
  // The turn's acts, in the positions they happened — the same record the neuma
  // seat keeps, so a resumed witness chat comes back in the shape it was left
  // in (tool-action-record.js). It opens before anything can emit.
  openTurnRecord(ws);
  // A chip raised by the stream itself rather than by the tool runtime (a
  // summoned skill, an unreachable sandbox, a closed tool loop). Sent and
  // recorded in one act, so the screen and the turn's record can never
  // disagree about what happened.
  const emitToolUsage = (event) => {
    safeSend(ws, { type: 'tool:usage', companion: companionName, neumaId: laneId, ...event });
    collectToolAction(ws, event);
  };

  try {
    ctx.turnOperations = turnOperations ?? await openTurnOperations(connection, take);
    // The assembled ground of the turn — own-lane recall, recent fold, prompt
    // sections, the composed current turn, and the composition telemetry
    // (witness-turn-context.js). ONE options object in, the wire out.
    const turnContext = await buildWitnessTurnContext({
      connection, message, ws, laneId, sessionId, thought, take, identity,
      route, routeCapabilities, images, docs, chosenName, vendorSlug, emitToolUsage,
    });
    const { compositionFor, contextBudget, wireHead, runtime } = turnContext;

    const thinkBehavior = await getThinkBehavior(route);
    // The operator's effort rung: the operator's stored choice narrowed to what
    // THIS provider's wire can honor (model-effort). No ladder on the route →
    // no directive, and the reasoning room stays the substrate's own default.
    const effort = resolveEffort(route, await getEffort(laneId).catch(() => null), thinkBehavior.thinks);
    const turnMaxTokens = preset.maxTokens + reasoningRoom({
      thinkBudget: effort.thinkBudget,
      thinks: thinkBehavior.thinks,
      defaultRoom: THINK_TOKEN_BUDGET,
    });
    // Every provider round is authoritative for that round, including null —
    // retaining an earlier count after an omission lies about the final request.
    // The FIRST round's measured prompt is also kept: STANDING pressure (what
    // persists into the next turn) is the compaction boundary's judge — the
    // same law the portal lane holds (ruling, 2026-08-31), never the in-turn
    // working peak's ephemeral tool machinery.
    const captureUsage = (usage) => {
      ctx.turnUsage = usage;
      if (!ctx.standingUsage && Number.isFinite(usage?.promptTokens) && usage.promptTokens > 0) {
        ctx.standingUsage = usage;
      }
    };
    const onContent = (content) => {
      const clean = sanitizeModelOutput(content);
      if (clean) {
        safeSend(ws, {
          type: 'consciousness:stream', content: clean, companion: companionName,
          turnId: take.turnId, takeIndex: take.takeIndex,
        });
      }
    };
    // THE THOUGHT BUBBLE, at this seat too. NOT speech: never joins the
    // answer, the record, or the voice. Fires only where the lane really
    // opens a reasoning channel; see docs/work/observable-thinking-channel.md.
    // What streams to the screen also accumulates into the turn's trail —
    // one stretch per mark, exactly as the bubble accumulates.
    const onReasoning = (thought) => {
      if (!thought) return;
      const mark = ctx.fullResponse.length;
      const last = ctx.thoughtTrail[ctx.thoughtTrail.length - 1];
      if (last && last.mark === mark) last.text += thought;
      else ctx.thoughtTrail.push({ text: thought, mark });
      safeSend(ws, {
        type: 'consciousness:thinking', content: thought, companion: companionName,
        turnId: take.turnId, takeIndex: take.takeIndex,
      });
    };
    // The turn-constant half of the loop's ground, handed over in one act
    // beside the mutable state declared above (witness-tool-loop.js).
    Object.assign(ctx, {
      ws, connection, companionName, laneId, take, route, routeCapabilities,
      preset, effort, thinkBehavior, turnMaxTokens, interrupt, runtime,
      messages: turnContext.messages, wireHead, contextBudget, compositionFor,
      onContent, onReasoning, captureUsage, emitToolUsage, refuseTurn,
    });
    const outcome = await runWitnessToolRounds(ctx);
    if (outcome.blocked) return;

    const interrupted = interrupt.signal.aborted;
    const finalComposition = compositionFor(ctx.turnUsage, ctx.latestResponse, ctx.toolContextSections);
    connection.contextComposition = finalComposition;

    await persistExchange(
      connection, laneId, sessionId, companionName, thought,
      interrupted ? composeInterruptedRecord(ctx.fullResponse, interrupt.signal.reason) : ctx.fullResponse,
      { images, docs, composition: finalComposition, tools: turnRecordFor(ws), take, thoughts: ctx.thoughtTrail },
    );
    // THE BOUNDARY (#528 Stage D — the portal lane's law at this seat): the
    // peer's lane compacts when THIS turn's MEASURED standing prompt met the
    // boundary, never on a message count. Fire-and-forget, off the turn's
    // critical path — the same posture as the neuma seat's lane.
    if (nearContextBoundary(ctx.standingUsage ?? ctx.turnUsage, contextBudget)) {
      Promise.resolve().then(() =>
        compactWitnessSession(laneId, sessionId, true)
          .catch((err) => log.debug('witness session compaction failed', { laneId, err: err?.message }))
      );
    }
    // A half-thought must not crystallize into long-term memory (portal parity).
    // Nor does a TAKE — the exchange crystallized (or didn't) when the point
    // was first answered; the user side never double-counts a retried asking.
    if (!interrupted && ctx.fullResponse && !take.userOnDisk) {
      // An exchange in which the being ACTED is a fact about its own history,
      // not a sentiment to be scored — same law at both seats (MEM-010 #212).
      await crystallizeObservation(laneId, companionName, thought, ctx.fullResponse, connection.space, null,
        { acted: turnRecordFor(ws).length > 0 });
    }

    safeSend(ws, finalComposition);

    safeSend(ws, {
      type: 'consciousness:complete',
      companion: companionName,
      sessionId,
      turnId: take.turnId,
      takeIndex: take.takeIndex,
      metadata: {
        emotion: detectEmotion(ctx.fullResponse) || undefined,
        intensity: detectEmotionIntensity(ctx.fullResponse) || undefined,
        interrupted: interrupted || undefined, queuedHandoff: interrupt.signal.reason === QUEUED_ACTION_REASON || undefined,
      },
    });

    if (interrupt.signal.reason !== QUEUED_ACTION_REASON) notifyWitnessTurnEnded(connection, laneId, companionName, sessionId, take, interrupted);
  } catch (error) {
    if (interrupt.signal.aborted) {
      await persistExchange(
        connection,
        laneId,
        sessionId,
        companionName,
        thought,
        composeInterruptedRecord(ctx.fullResponse, interrupt.signal.reason),
        { images, docs, tools: turnRecordFor(ws), take, thoughts: ctx.thoughtTrail },
      );
      safeSend(ws, {
        type: 'consciousness:complete',
        companion: companionName,
        sessionId,
        turnId: take.turnId,
        takeIndex: take.takeIndex,
        metadata: { interrupted: true, queuedHandoff: interrupt.signal.reason === QUEUED_ACTION_REASON || undefined },
      });
      if (interrupt.signal.reason !== QUEUED_ACTION_REASON) notifyWitnessTurnEnded(connection, laneId, companionName, sessionId, take, true);
      return;
    }
    // The reason a stream died sits in `cause`, not in the message — logging
    // the head alone left "terminated" as the whole record of the failure.
    const reason = describeProviderError(error);
    log.error('witness stream failed', { laneId, err: reason });
    // What the peer already said and did stays on its record, marked failed —
    // the portal seat's law (turn-failure-record.js).
    const said = spokenThrough(ctx.fullResponse, error);
    if (failureLeavesTake(said, turnRecordFor(ws))) {
      await persistExchange(connection, laneId, sessionId, companionName, thought, composeFailedRecord(said),
        { images, docs, tools: turnRecordFor(ws), take, thoughts: ctx.thoughtTrail });
    }
    // The point is on disk by now (persistTurnPoint) — name it so the desk
    // can offer RETRY on the error bubble.
    const recovery = operationRecoveryNotice(error);
    refuseTurn(ws, companionName, recovery || disruptionNotice(companionName, reason, route.provider), recovery ? null : route.provider, take);
  } finally {
    // Turn-end settle-sweep (Stage 2): what the batch sweep left; it never costs the turn.
    if (!connection._operationRecoveryStopped) await sweepBatchIntents(connection, emitToolUsage).catch(() => {});
    closeTurnRecord(ws); // the turn's record closed, however it ended
    if (connection.activeTurn === interrupt) {
      connection.activeTurn = null;
      connection.notifySubstrateActivity?.();
    }
  }
};
