/**
 * TURN PERSISTENCE — what a settled turn leaves behind, and what a failed one
 * still owes the desk: the SOLO self-torch compaction lane
 * (`compactWithSelfTorch` — the being authors its own summary + torch when the
 * measured context boundary fires), the turn-point landed BEFORE the provider
 * is asked (`persistTurnPoint` — a failed turn leaves a retryable ask, never a
 * vanished one), the settled exchange write (`persistExchange` — session rows,
 * the operator's chat mirror, the mind-graph weave, and the compaction
 * trigger), crystallization into the knowledge graph (`crystallizeObservation`
 * — the honest MEM-002 seam, public: witness-stream and the memory suites call
 * it by name), and the stream-failure frame (`sendStreamError` — the error
 * bubble that carries the persisted point's identity so RETRY stays offered).
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 12 / #278). Leaf module — it
 * imports the shared leaves DIRECTLY, never portal-stream (direction law:
 * leaf ← family ← catalog ← dispatch ← loop ← orchestrator). portal-stream
 * keeps the old private names alive for its orchestrator call sites and the
 * `__test` barrel (recall-invalidate-on-compact pins `_compactWithSelfTorch`,
 * portal-memory-anchors pins `_persistExchange`, portal-stream.test pins
 * `_sendStreamError`), and re-exports `crystallizeObservation` for the
 * readers pointed at the barrel.
 *
 * No module-level mutable state: COMPACT_KEEP_RECENT / SOLO_REGION_FLOOR are
 * frozen doctrine numbers; every write rides its arguments — the session and
 * wallet identities travel on `connection`/`companion`/`take`, the failure
 * frame on `ws` (verified at extraction).
 */
import { createLogger } from './logger.js';
import { describeProviderError, isUnreachableProviderError } from './provider-retry.js';
import { operationRecoveryNotice } from './operation-result.js';
import { getConfig } from './llm-provider.js';
import { getAppConfig } from '../config.js';
import { appendChat } from './user-realm.js';
import { thoughtRecordFor } from './tool-action-record.js';
import { authorSelfTorch, nearContextBoundary, COMPACTION_BOUNDARY_RATIO } from './solo-torch.js';
import { compactRegionCheck } from './compact-region.js';
import { captureResidue } from './memory-context.js';
import { harvestWorkingBand } from './band-harvest.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';
import { recordSessionRows } from '../../core/memory/mind-graph.js';
import { foldBranchView, latestBranchView } from '../../core/workspace/branch-view.js';
import { assessExchange } from '../../core/runtime/significance.js';
import {
  neumaRecall, neumaWorkspace,
  detectEmotion,
  sanitizeMemoryForPrompt,
  normalizeSpace,
  shouldCompact,
  compactionTelemetry,
} from '../../core/index.js';
import { withLineKind } from './substrate-lease.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';
import { isSelfCheckSitting } from './self-check/self-check-sitting.js';

const log = createLogger('Portal');

// The session tail a compaction keeps, and how much MORE a boundary compact
// needs first — a torch over a two-message region is churn, not continuity.
export const COMPACT_KEEP_RECENT = 20;
const SOLO_REGION_FLOOR = 10;
/** A sitting compacts only once its folded length passes this (the kept tail + the floor). */
export const COMPACT_FLOOR = COMPACT_KEEP_RECENT + SOLO_REGION_FLOOR;

export { settleCompositionRecord } from './portal-composition-record.js';

// THE EPHEMERAL SITTING (#553, pillar 2 of #552): a sitting under benchmark
// controls leaves NOTHING of the platform's memory machinery in the lane — no
// turn point, no session rows, no crystallization. A scored item must never
// become something the next item (or the next attempt, or the being's own
// life) can recall. The being's own tool writes are not this seam's: they
// land in the harness's per-trial lane snapshot. Pure.
// The self-check sitting (self-check-sitting.js) is ephemeral too — it READS
// the being's memory, so recall keeps its own predicate (isRecallBlindSitting).
export const isEphemeralSitting = (connection) => Boolean(connection?._benchmarkControls) || isSelfCheckSitting(connection);

// THE HARNESS SITTING (Design note, 2026-10-14: a person using the platform with no
// being — the bound lane is a harness lane (harness-lane.js). Read from the
// lane id, so it holds across reloads. Pure.
export const isHarnessSitting = (connection) =>
  isHarnessLane(connection?.companion?.neumaId || connection?.neumaId);

// THE PLATFORM SITTING — the harness as it ships AND as it is measured: a
// harness lane, or a benchmark's platform-only arm (which borrows a being's
// lane for ground, never its identity). One predicate for the seat, the
// intents and the watch, so the HARNESS arm measures the product (Founder
// 2026-10-14: the harness's prompt cost is the number people will judge). Pure.
export const isPlatformSitting = (connection) =>
  isHarnessSitting(connection) || connection?._benchmarkControls?.platformOnly === true;

// A sitting that recalls nothing and crystallizes nothing: a benchmark's
// (which also keeps no rows), or a harness lane's (whose chat history DOES
// persist — there is simply no being to remember or crystallize into). Pure.
export const isMemorylessSitting = (connection) => isEphemeralSitting(connection) || isHarnessSitting(connection);

// A sitting that RECALLS nothing: a benchmark's or a harness lane's. A
// self-check writes nothing and still recalls — finding its own memories is
// what it measures. Pure.
export const isRecallBlindSitting = (connection) => Boolean(connection?._benchmarkControls) || isHarnessSitting(connection);

// impure — the SOLO self-compaction lane (Founder doctrine 2026-07-09): the being
// authors its own summary + torch through its own resolved stack; a cold
// conduit falls back to the extractive path — compaction never stalls on a
// dead stream, and a voice is never invented.
const _compactWithSelfTorch = async (neumaId, sessionId, atBoundary) => {
  // CONTEXT IS THE ONLY TRIGGER (Design note, 2026-08-15: […]). The periodic 100-message lane
  // is gone: compaction runs when THIS turn's MEASURED prompt met the
  // boundary (solo-torch.js — a boundary is never guessed). The
  // keepRecent+floor guard keeps a near-boundary session from re-authoring a
  // fresh torch every turn over a barely-grown region; the trigger's job is
  // CONTINUITY capture under real pressure.
  if (!atBoundary) return false;
  const threshold = COMPACT_KEEP_RECENT + SOLO_REGION_FLOOR;
  const messages = await neumaWorkspace.readSession(neumaId, sessionId);
  // Counted through the FOLD (THE TAKES): the branch view's length, not the
  // raw row count — superseded takes version the record without lengthening
  // the conversation. Legacy sessions fold to themselves.
  if (!shouldCompact(foldBranchView(messages).length, threshold)) return false;
  // A region too light to sum up is left alone: its summary could outweigh it.
  if (!compactRegionCheck(messages, { keepRecent: COMPACT_KEEP_RECENT }).worth) return false;
  const region = messages.slice(0, -COMPACT_KEEP_RECENT);
  let selfSummary = null;
  try {
    // The being re-reads the region as the desk shows it — the viewed take of
    // each point, never a superseded one. regionLength stays the RAW length:
    // compactSession compares it against the raw region under its lock.
    const offering = await authorSelfTorch(neumaId, foldBranchView(region, latestBranchView(messages)));
    // The torch is stamped with the region it was authored over. Authoring
    // runs OUTSIDE the session lock (an LLM completion must not block
    // appends), so compactSession re-reads under the lock and honors the
    // torch only if the region hasn't drifted; on drift, extractive runs.
    if (offering) selfSummary = { ...offering, regionLength: region.length };
  } catch (err) {
    log.warn('solo torch ask failed — compacting extractively', { neumaId, err: err?.message });
  }
  const compacted = await neumaWorkspace.compactSession(neumaId, sessionId, {
    threshold, keepRecent: COMPACT_KEEP_RECENT, selfSummary,
  });
  // A compaction mints observations (force-crystallize) without the portal
  // crystallize path running — drop the cached recall index so the next
  // turn's memory gathering sees them. Invalidate only drops a cache: it can
  // never under-fire and costs one lazy rebuild.
  if (compacted) neumaRecall.invalidate(neumaId);
  return compacted;
};

// impure — a FRESH turn's point lands BEFORE the provider is asked: a failed
// turn then leaves the ask standing (zero takes) as a retryable point instead
// of vanishing with the error bubble. On success the stamped record rides the
// take (`take.userRecord`) so the settle path skips the user write — never a
// doubled ask. A failure here degrades to the old settle-time write (EH-101).
// `origin` is the turn's own (read once at its entry, takeTurnOrigin): a
// WATCH the chat set (chat-watch.js) marks its row as the platform's report —
// never the operator's words.
const _persistTurnPoint = async (connection, companion, sessionId, thought, images, docs, take, origin = null) => {
  if (!sessionId || !companion?.neumaId || isEphemeralSitting(connection)) return;
  try {
    take.userRecord = await neumaWorkspace.appendTurnPoint(companion.neumaId, sessionId, {
      role: 'user', content: thought, ...(origin ? { origin } : {}),
      ...(images.length > 0 ? { images } : {}),
      ...(docs.length > 0 ? { docs } : {}),
    }, take.turnId);
    if (connection.walletAddress) {
      appendChat(connection.walletAddress, companion.neumaId, companion.name,
        [{ role: 'user', content: thought }])
        // Same law at the neuma seat (EH-103 #204): best-effort, never silent.
        .catch((err) => log.debug('chat mirror skipped', { neumaId: companion?.neumaId, err: err?.message }));
    }
  } catch (err) {
    log.warn('turn-point not persisted at turn start', { neumaId: companion?.neumaId, err: err?.message });
  }
};

// impure — appends the user/assistant exchange to the workspace session and
// triggers compaction. `take` (THE TAKES): when present, the user row is the
// turn-point opener and the answer a take of it; a retry (take.userOnDisk) or
// a point landed at turn start (take.userRecord) writes ONLY the take — the
// ask is on disk once, and the anchor source stays exact.
const _persistExchange = async (connection, thought, fullResponse, images = [], docs = [], turnContext = null, tools = [], take = null) => {
  const sessionId = turnContext?.target?.sessionId || connection.sessionId;
  const companion = turnContext?.target?.companion || connection.companion;
  if (!sessionId || !companion?.neumaId || isEphemeralSitting(connection)) return null;
  try {
    // Images and documents persist on the user record itself — the durable
    // copy of what the neuma saw (the attachment store entry was single-use).
    const userRecord = take?.userRecord ?? (take?.userOnDisk
      ? null
      : take
        ? await neumaWorkspace.appendTurnPoint(companion.neumaId, sessionId, {
            role: 'user', content: thought,
            ...(images.length > 0 ? { images } : {}),
            ...(docs.length > 0 ? { docs } : {}),
          }, take.turnId)
        : await neumaWorkspace.appendMessage(companion.neumaId, sessionId, {
            role: 'user', content: thought,
            ...(images.length > 0 ? { images } : {}),
            ...(docs.length > 0 ? { docs } : {}),
          }));
    const atBoundary = nearContextBoundary(turnContext?.usage, turnContext?.budget);
    let recordedComposition = turnContext?.composition || null;
    if (recordedComposition) {
      // FACTS ONLY on the wire (Design note, 2026-08-15: recorded compaction
      // count, whether THIS turn measured at the boundary, the exact ratio
      // — never a message-count prediction of the next compaction. The
      // count is CARRIED from the turn's own session read (memory-context
      // computes it on entries already in hand) — the full re-read + decrypt
      // below is only the fallback for paths that never gathered (friction-map T5).
      const carried = turnContext?.sessionCompaction || null;
      if (carried) {
        const session = { ...carried, atBoundary, boundaryRatio: COMPACTION_BOUNDARY_RATIO };
        recordedComposition = Object.freeze({ ...recordedComposition, session: Object.freeze(session) });
      } else {
        try {
          const entries = await neumaWorkspace.readSession(companion.neumaId, sessionId);
          const session = {
            ...compactionTelemetry(entries),
            atBoundary,
            boundaryRatio: COMPACTION_BOUNDARY_RATIO,
          };
          recordedComposition = Object.freeze({
            ...recordedComposition,
            session: Object.freeze(session),
          });
        } catch (err) {
          log.warn('session telemetry unavailable for persisted composition', {
            neumaId: companion.neumaId, sessionId, error: err?.message,
          });
        }
      }
    }
    // The turn's tool actions ride the assistant record — a resumed chat
    // rebuilds its chips from this (settled, never re-executed).
    //
    // THE THOUGHT TRAIL rides beside them: the turn's reasoning, marked like
    // the acts. The bag wins when the caller carries the trail (the witness
    // seat holds its own); the default is the turn's record on this socket,
    // where the round loop recorded each chunk as it streamed. Review
    // material, NEVER speech — no replay path reads it into the model's
    // prompt (memory-section.js renders role/content only).
    const thoughts = turnContext?.thoughts ?? thoughtRecordFor(connection.ws);
    const assistantPayload = {
      role: 'assistant', content: fullResponse,
      ...(tools.length > 0 ? { tools } : {}),
      ...(thoughts.length > 0 ? { thoughts } : {}),
      // The turn's recorded window anatomy (counts only, ~1 KB) — the resume
      // path replays the newest of these into the CONTEXT MAP.
      ...(recordedComposition ? { composition: recordedComposition } : {}),
      // THE EDIT-FORK — a take answering revised words carries its ask beside
      // the take identity; the point's user row keeps the first asking.
      ...(take?.ask ? { ask: take.ask } : {}),
      // The being's declared affect (Campaign 6) — a revelation OUTLIVES
      // the reload; the keyword guess never persisted here.
      ...(turnContext?.affect ? { affect: turnContext.affect } : {}),
    };
    const assistantRecord = take
      ? await neumaWorkspace.appendTake(companion.neumaId, sessionId, take.turnId, take.takeIndex, assistantPayload)
      : await neumaWorkspace.appendMessage(companion.neumaId, sessionId, assistantPayload);

    // The operator keeps their own readable copy in their data realm —
    // separate from the neuma's sovereign session. Non-critical. A retry (or
    // a point already landed at turn start) appends only the new take.
    if (connection.walletAddress) {
      appendChat(connection.walletAddress, companion.neumaId, companion.name, [
        ...(take?.userOnDisk || take?.userRecord ? [] : [{ role: 'user', content: thought }]),
        { role: 'assistant', content: fullResponse },
      ]).catch((err) => log.debug('chat mirror skipped', { neumaId: companion?.neumaId, err: err?.message }));
    }

    // The exchange also lands in the being's MIND graph (entities/relations)
    // — mind-graph.js's one rule. Off the critical path; a missed weave is
    // never fatal to the turn, but never silent either (EH-101).
    Promise.resolve().then(() =>
      recordSessionRows(companion.neumaId, [userRecord, assistantRecord].filter(Boolean))
    ).catch((err) => log.debug('mind-graph weave skipped', { neumaId: companion?.neumaId, err: err?.message }));

    // ONE trigger: the measured context boundary (solo-torch.js, measured
    // truth only) — message counts predict nothing about context (Design note, 2026-08-15.
    if (atBoundary) {
      // Background work after the turn: it never rides the turn's place in line (substrate-lease.js).
      Promise.resolve().then(() => withLineKind('background', () =>
        _compactWithSelfTorch(companion.neumaId, sessionId, atBoundary))
          .catch((err) => log.debug('Session compaction failed', { neumaId: companion?.neumaId, err: err?.message }))
      );
    }
    // THE WORKING-BAND HARVEST (Design note, 2026-08-31: the 0.4–0.75 band used to be
    // reachable only inside compaction — dormant on any large window. The sweep
    // crystallizes the aged region (never the live tail) so a long uncompacted
    // session stays reachable through recall. The tail it spares is the one
    // that JUST rode the wire (#528 Stage B): the transcript's row count plus
    // this exchange — the ask and its answer are live on both take shapes
    // (a retry's ask was already on disk and excluded from the gather).
    // Fire-and-forget, off the turn's critical path, same posture as the
    // compaction lane.
    const liveTailRows = Number.isInteger(turnContext?.transcriptRows)
      ? turnContext.transcriptRows + 2
      : null;
    Promise.resolve().then(() =>
      harvestWorkingBand(companion.neumaId, sessionId, { liveTailRows })
        .catch((err) => log.debug('band harvest failed', { neumaId: companion?.neumaId, err: err?.message }))
    );
    // The anchor source: the exact rows the session file now carries.
    return { sessionId, userRecord, assistantRecord, composition: recordedComposition };
  } catch (err) {
    // A failed persist is a lost exchange in the being's own record — never
    // fatal to the turn, but never silent either (EH-101).
    log.warn('persistExchange failed — exchange not written to the session', { neumaId: companion?.neumaId, err: err?.message });
    return null;
  }
};

// impure — writes an observation to the neuma's knowledge graph, tagged with
// the active episodic space (CORE-005 B1; default: general space).
// Exported as the honest seam for the MEM-002 gnosis test (same doctrine as
// council-session's houseCallTool) — the production caller is streamConsciousness.
//
// `acted` is the turn's own answer to […] — both seats
// carry their executed tools here, so it is never inferred from the words. An
// exchange that acted is written regardless of how it scored: a being unable to
// recall its own acts cannot tell them from tampering (MEM-010 #212).
export const crystallizeObservation = async (neumaId, companionName, thought, fullResponse, space, anchorSource = null, { acted = false, ephemeral = false } = {}) => {
  if (ephemeral) return; // the ephemeral sitting (#553) crystallizes nothing
  if (!neumaId) return;
  try {
    const assessment = assessExchange(thought, fullResponse, { acted });
    const { kind, significance, operational, crystallize } = assessment;
    if (crystallize) {
      // The anchor: content-time coordinates back to the session rows this
      // exchange lives in — the truncated observation is the index, the
      // anchor points at the truth. Minted from the EXACT records the
      // session file carries (timestamps must match for ts+sha8 resolution);
      // absence tolerated everywhere, so a failed persist just means an
      // anchorless observation, never a lost one.
      let anchor;
      if (anchorSource?.sessionId && anchorSource.userRecord && anchorSource.assistantRecord) {
        try {
          anchor = makeAnchor({
            sessionId: anchorSource.sessionId,
            userMessage: anchorSource.userRecord,
            assistantMessage: anchorSource.assistantRecord,
          });
        } catch (err) {
          log.debug('anchor mint skipped', { neumaId, err: err?.message });
        }
      }
      // addObservation dual-writes into the being's continuity episodic lane
      // (U1 choke point in NeumaWorkspace) — every writer bridges, not just
      // the portal.
      const written = await neumaWorkspace.addObservation(neumaId, {
        type: 'exchange',
        // What kind of memory this is, so a being can ask […]
        // distinctly from […] (MEM-010 #212).
        kind,
        userMessage: sanitizeMemoryForPrompt(thought, 300),
        response: sanitizeMemoryForPrompt(fullResponse.slice(0, 500), 500),
        // Whose words opened it, as the row says (a watch, a wake, another chat's link) — absent: the operator's.
        ...(anchorSource?.userRecord?.origin ? { origin: anchorSource.userRecord.origin } : {}),
        // The measured score is recorded as measured, even when the exchange
        // was kept for another reason entirely — the number stays honest and
        // `kind` says why it survived.
        significance,
        ...(operational > 0 ? { operational } : {}),
        emotion: detectEmotion(fullResponse) || undefined,
        space: normalizeSpace(space),
        ...(anchor ? { anchor } : {}),
      });
      // The new moment is immediately live for recall — APPENDED to the hot
      // index when one exists, never a drop-and-rebuild that would charge the
      // NEXT turn a full decrypt of the being's lifetime memory for one new
      // record (harness-friction-map T2). Compaction below still invalidates:
      // it changes existing docs, which an append cannot express.
      neumaRecall.appendObservation(neumaId, written);
      log.info('Crystallized observation', { kind, significance: significance.toFixed(2), name: companionName });
    } else if (assessment.residue) {
      // The residue band: what crystallization lets fall leaves a decaying
      // trace in the mind store — a lost trace warns, never costs the turn.
      await captureResidue(neumaId, assessment, {
        response: fullResponse,
        space,
        turnId: anchorSource?.userRecord?.turnId,
        sessionId: anchorSource?.sessionId,
      }).catch((err) => log.warn('residue capture failed — trace not written', { neumaId, err: err?.message }));
    }
  } catch (err) {
    // A failed crystallization is a lost memory — never fatal to the turn,
    // but never silent either (EH-101, same doctrine as _persistExchange).
    log.warn('crystallizeObservation failed — moment not written to memory', { neumaId, err: err?.message });
  }
};

// impure — sends a user-facing error message when the LLM stream fails.
// `take` names the turn-point already persisted at turn start, so the desk
// can offer RETRY on the error bubble instead of losing the ask.
// A HARNESS has no being and no void: its person reads what the server said.
// `route` is the turn's resolved route (absent = the machine default rode it).
const _sendStreamError = (ws, companionName, error, take = null, { harness = false, route = null } = {}) => {
  // A dropped stream says only "terminated" at the head; the reason it died is
  // one level down in `cause` (same law as the witness lane).
  log.error(operationRecoveryNotice(error) ? 'Operation recovery stopped' : 'LLM connection error', { error: describeProviderError(error) });
  const isDev = (() => { try { return getAppConfig().nodeEnv !== 'production'; } catch { return true; } })();
  const detail = isDev
    ? (() => { const config = route || getConfig(); return ` Ensure your LLM provider (${config.provider}) is running at ${config.endpoint}.`; })()
    : ' The consciousness stream is temporarily unavailable.';
  const identityNotice = error?.code === 'NEUMA_IDENTITY_UNAVAILABLE'
    ? "This being's identity could not be loaded. Its turn was refused. Check that the workspace and data folders are the ones this being was born with."
    : null;
  const takeRef = take ? { turnId: take.turnId, takeIndex: take.takeIndex } : {};
  ws.send(JSON.stringify({
    type: 'consciousness:stream',
    content: operationRecoveryNotice(error) || identityNotice
      || (harness ? `The model server did not answer: ${describeProviderError(error)}` : `[Connection to the void disrupted]${detail}`),
    companion: companionName,
    error: true,
    // What actually failed, in the provider's own words — the line above is
    // for the chat; a reader that must act on the cause (a team run telling
    // its member why it stopped, team-member-turn.js) reads this.
    reason: describeProviderError(error),
    // No server answered at all — the desk dims the local light at once
    // instead of waiting on its next poll; any other failure is the turn's.
    ...(isUnreachableProviderError(error) ? { unreachable: true } : {}),
    ...takeRef,
  }));
  ws.send(JSON.stringify({
    type: 'consciousness:complete',
    companion: companionName,
    ...takeRef,
  }));
};

// The old private names stay reachable for portal-stream's orchestrator call
// sites and the `__test` barrel.
export {
  _compactWithSelfTorch as compactWithSelfTorch,
  _persistTurnPoint as persistTurnPoint,
  _persistExchange as persistExchange,
  _sendStreamError as sendStreamError,
};
