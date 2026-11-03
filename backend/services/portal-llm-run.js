/**
 * THE LLM RUN — one round of the model on the wire and everything that rides
 * it: the being's per-turn effort rung (`resolveTurnEffort`), the streaming
 * run itself (`runLLMStream` — tokens, the thought bubble, the affect filter,
 * the retry ladder, and the VOX lane where words are released by their own
 * voice — its chain lives in voice/speech-turn.js), the composition
 * event's context telemetry (`contextTelemetry`), and the response-side
 * safety gate (`handleResponseSafety`). `resolveVoiceDNA` re-exports
 * speech-turn's `resolveTurnVoice` (the Voice DNA v2 lookup that arms the VOX
 * lane) under the name portal-stream's call site has always used.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 11 / #278). Leaf module — it
 * imports the shared leaves DIRECTLY, never portal-stream (direction law:
 * leaf ← family ← catalog ← dispatch ← loop ← orchestrator). portal-stream
 * keeps the old private names alive for its orchestrator call sites and the
 * `__test` barrel (portal-voice-chat and portal-stream-voice pin
 * `_runLLMStream` / `_resolveVoiceDNA` through it). The birth-stage path
 * (sendStageToLLM) calls NOTHING here — it drives createStreamRequest with
 * its own reader loop.
 *
 * No module-level mutable state: every run's suppressors, filters, chains,
 * and timers are locals of the call — the connection's streaming identity
 * rides the ws/signal/take arguments (verified at extraction; the TTL caches
 * left for portal-turn-sections.js in step 10).
 */
import { createLogger } from './logger.js';
import { safeSend as _safeSend } from './ws-send.js';
import { timedCall } from './turn-timing-probe.js';
import { createStreamRequest, consumeStream, consumeStreamWithTools, getConfig, getThinkBehavior, getActiveModelCapabilities, getRouteCapabilities } from './llm-provider.js';
import { roundToolsFor } from './close-prefix.js';
import { resolveEffort } from './model-effort.js';
import { createThoughtGovernor, governedStream, noThinkOptions, sharedCapRoomCap, CLOSE_THINK_BUDGET } from './thought-governor.js';
import { getEffort } from './neuma-effort-store.js';
import {
  neumaWorkspace,
  sanitizeModelOutput, trimDegenerationTail, stripLeadingClockStamps, createClockStampFilter,
} from '../../core/index.js';
import { parseAffect, createAffectStreamFilter } from '../../core/runtime/affect-channel.js';
import { detectRoguePatterns, shouldBlock } from './rogue-detector.js';
import { createSpeechTurn, resolveTurnVoice } from './voice/speech-turn.js';
import { makeSpeechClock } from './portal-speech-clock.js';
import { createSpeechLoopGuard } from './speech-loop-guard.js';
import { withSpokenContent } from './turn-failure-record.js';
import { tripMandateForLane } from './marketing/mandate/mandate-tripwire.js';

const log = createLogger('Portal');

// impure — the being's effort rung for one turn: the operator's stored choice
// narrowed to what THIS route can actually honor (model-effort). Never costs a
// turn — an unreadable store or an unprobed substrate means no directive and the
// substrate's own default reasoning room. Absent being (a bare portal) → null.
const _resolveTurnEffort = async (beingId, route) => {
  if (!beingId) return null;
  const [stored, behavior] = await Promise.all([
    getEffort(beingId).catch(() => null),
    getThinkBehavior(route).catch(() => ({ thinks: false })),
  ]);
  return resolveEffort(route ?? getConfig(), stored, behavior.thinks);
};

// impure — streams one round of the LLM response and broadcasts chunks to the
// client. When a Voice DNA is supplied (resolved once per turn by the caller),
// each cleaned text chunk also feeds a sentence stream that synthesizes +
// emits voice:audio frames as sentences complete. The text stream
// (consciousness:stream) is never blocked by synthesis — the callback returns
// immediately. This round's audio is fully drained before returning, so a
// multi-round tool turn keeps its speech in order across rounds.
// `take` (THE TAKES) stamps the turn-point identity onto every speech frame,
// so the desk targets the TAKE of its point, never a new tail message; `onReasoningChunk` observes each reasoning chunk (THE THOUGHT TRAIL's record seam).
const _runLLMStream = async (ws, messages, companionName, voiceDNA, preset, nativeTools = [], signal = undefined, onUsage = undefined, route = undefined, lora = undefined, effort = undefined, take = undefined, onAffect = undefined, onReasoningChunk = undefined, onActionBoundary = undefined, onTelemetry = undefined, roundOpts = undefined) => {
  const thinkBehavior = await getThinkBehavior(route);
  // THE THOUGHT GOVERNOR: the rung's room now BINDS wherever a thinking-off
  // lever is proven — one number is the headroom below AND the leash (thought-governor.js).
  const governor = createThoughtGovernor({ effort, thinkBehavior, route: route ?? getConfig(), signal, roomCap: sharedCapRoomCap(preset) });
  // THE SPEECH LOOP BREAKER (2026-09-15): a completion that degenerates into
  // verbatim self-repetition (measured: metidar's plan block re-streamed
  // until the output budget died, no tool call for the seat guards to see)
  // is cut after ONE redundant period. The guard's controller joins the
  // governor's on the fetch AND consume signal — an abort is a cut, not a
  // failure (llm-provider's stream law), so the round settles on the words
  // kept (guard.keptRaw), one copy, and the burn stops.
  const loopGuard = createSpeechLoopGuard({
    onLoop: (info) => log.warn('verbatim speech loop — cutting the completion', { companion: companionName, ...info }),
  });
  const loopController = new AbortController();
  const combinedSignal = signal
    ? AbortSignal.any([signal, governor.signal, loopController.signal])
    : AbortSignal.any([governor.signal, loopController.signal]);
  const streamOpts = {
    temperature: preset.temperature,
    topP: preset.topP,
    // null = an uncapped benchmark sitting: llm-provider grants the served window.
    maxTokens: preset.maxTokens === null ? null : preset.maxTokens + (preset.exactMaxTokens ? 0 : governor.room),
    ...(Number.isInteger(preset.seed) ? { seed: preset.seed } : {}),
    ...(effort?.directive ? { effort: effort.directive } : {}),
    // The server closes the thought at the rung's room (thought-governor serverBudget).
    ...(governor.serverBudget ? { thinkingBudget: governor.serverBudget } : {}),
    // THE SPEECHLESS CLOSE rides the proven thinking-off switch (#506): a
    // reasoning-on close under the same cap is a coin flip; kwarg-less templates ignore it.
    // On llama.cpp the switch is a one-token server budget instead — the prompt stays cached.
    ...(roundOpts?.noThink === true
      ? (thinkBehavior?.serverBudget === true ? { thinkingBudget: CLOSE_THINK_BUDGET } : { noThink: true })
      : {}),
    // The operator's interrupt (beside the governor's cut) — a mid-stream abort keeps what was spoken
    signal: combinedSignal,
    // A benchmark harness owns server lifecycle; ordinary turns keep production supervision.
    ...(preset.superviseLlamaServer === false ? { superviseLlamaServer: false } : {}),
    // A benchmark sitting reads the images each accepted request carried (wire-images.js).
    ...(preset.onWireBody ? { onWireBody: preset.onWireBody } : {}),
    ...(Number.isInteger(roundOpts?.contextHead) ? { contextHead: roundOpts.contextHead } : {}),
    ...(roundOpts?.onContextRecovery ? { onContextRecovery: roundOpts.onContextRecovery } : {}),
    // Resolved route / refined adapter; absent means machine config / bare base.
    ...(route ? { route } : {}), ...(lora ? { lora } : {}),
  };
  // A CLOSE (no tools of its own) keeps the round's tools on llama.cpp, held from calling —
  // the chat's cached prompt intact (close-prefix.js); a round's own tools always ride.
  Object.assign(streamOpts, roundToolsFor(nativeTools, roundOpts?.closeTools, route ?? getConfig()));
  // The sender's call shape (caller-tools.js): one reply may carry several calls when it asked.
  if (nativeTools.length > 0 && preset.parallelToolCalls === true) streamOpts.parallelToolCalls = true;

  // THE VOICE CHAIN (voice/speech-turn.js): with a turn voice, cleaned words
  // become sentences, sentences become ordered audio, and each sentence's
  // words are released by its own voice. Null = VOX off or a silent being —
  // the token stream below is then byte-identical to a voiceless turn.
  const speech = createSpeechTurn({ ws, companionName, turnVoice: voiceDNA, signal, take });

  // The declared-affect filter rides EVERY visible delta (Campaign 6): a
  // [FEELING: …] line is metadata, not speech — it must never reach the
  // screen, the voice, or a channel bridge riding these frames. Suppression
  // is silent (a feeling is not an action — no chip, no event).
  const affectFilter = createAffectStreamFilter();

  // THE CLOCK-STAMP SEAM (2026-09-25): the model learned to parrot the
  // conversation clock's stamps at the head of its own speech/thought
  // (memory-section.js no longer teaches it); these filters strip the residual
  // habit at every output seam — one instance per attempt (retries re-stream from zero).
  let stampFilter = createClockStampFilter();
  let reasoningStampFilter = createClockStampFilter();

  // THE SPEAKING CLOCK (friction-map B4): the wire coalesces onto a 25ms
  // cadence — portal-speech-clock.js owns the law; stream end flushes it.
  const speechClock = makeSpeechClock({ ws, companionName, take });
  const sendStreamFrame = (content) => speechClock.push(content);

  // Native function calling (when the substrate supports it) delivers tool
  // calls as structured delta.tool_calls instead of text — far more reliable
  // than coaxing a text dialect. Same onContent path (operator sees speech +
  // tool chips); only the result shape differs.
  const onContent = (content) => {
    const clean = affectFilter.push(sanitizeModelOutput(stampFilter.push(content)));
    if (clean) {
      // VOX on: the words wait for their voice — the sentence detector owns
      // the release from here, this token has no display frame of its own.
      if (speech) speech.push(clean);
      else speechClock.push(clean);
    }
  };
  // THE THOUGHT BUBBLE (Design note, 2026-07-30: […]). Reasoning
  // rides its OWN frame — never `consciousness:stream`, never the voice chain,
  // never the recorded speech — so watching a being think cannot change what it
  // said. Emitted only where the lane actually opens a reasoning channel
  // (proven per-lane, docs/work/observable-thinking-channel.md); a lane that
  // sends none simply never fires this, and the desk shows no bubble.
  const onReasoning = (thought) => {
    const clean = thought ? reasoningStampFilter.push(thought) : '';
    if (!clean) return;
    onReasoningChunk?.(clean);
    _safeSend(ws, {
      type: 'consciousness:thinking',
      content: clean,
      companion: companionName,
      ...(take ? { turnId: take.turnId, takeIndex: take.takeIndex } : {}),
    });
  };
  // THE RETRY LADDER (Design note, 2026-07-28: […]): a transient overload gets up to 10 attempts,
  // visible per retry — but ONLY while nothing has streamed yet (the
  // zero-content guard: a recovering provider must never duplicate partial
  // speech).
  let attemptHadContent = false;
  let attemptSaid = '';
  const guardedOnContent = (content) => {
    if (content) attemptHadContent = true;
    attemptSaid += content || '';
    loopGuard.push(content);
    onContent(content);
  };
  // onUsage (B-03: once at stream end, frozen counts or null) and onTelemetry
  // (same contract — the cache/prefill facts the token contract drops, #528-C);
  // the reasoning listener rides under the leash.
  const consumeOpts = {
    ...thinkBehavior, signal: governor.signal, onActionBoundary, onReasoning: governor.guard(onReasoning, () => attemptHadContent),
    ...(onUsage ? { onUsage } : {}), onTelemetry: timedCall(ws, onTelemetry), // timed per call (turn-timing-probe.js)
    // THE OUTPUT-BUDGET CUT (ARC-HARNESS N1, #531): the wire's own word for
    // […] — the budget-cut rescue reads it, so a
    // partially-spoken answer is continued instead of committed truncated.
    ...(roundOpts?.onFinishReason ? { onFinishReason: roundOpts.onFinishReason } : {}),
  };
  speech?.markStart(); // stage-2 anchor: this round's tokens start flowing now
  const streamed = await governedStream(governor, { onReask: roundOpts?.onReask,
    // Pass 2 (thinking off) rides the operator's own signal — the governor's is spent.
    attempt: async (noThink) => {
      attemptHadContent = false;
      attemptSaid = '';
      loopGuard.reset();
      stampFilter = createClockStampFilter();
      reasoningStampFilter = createClockStampFilter();
      const opts = noThink ? noThinkOptions(streamOpts, governor, signal) : streamOpts;
      const consume = noThink ? { ...consumeOpts, signal } : consumeOpts;
      // The breaker's controller rides BOTH passes (pass 2 swaps the spent
      // governor signal for the operator's; the breaker is orthogonal).
      const passSignal = AbortSignal.any([opts.signal, consume.signal, loopController.signal].filter(Boolean));
      opts.signal = passSignal;
      consume.signal = passSignal;
      try {
        const streamResult = await createStreamRequest(noThink ? governor.reaskMessages(messages) : messages, opts);
        log.info('round stream opened', { companion: companionName, tools: nativeTools.length, noThink });
        const streamed = nativeTools.length > 0
          ? await consumeStreamWithTools(streamResult, guardedOnContent, consume)
          : { content: await consumeStream(streamResult, guardedOnContent, consume), toolCalls: [] };
        // A loop-cut round's words stand ONCE (keptRaw drops the redundant
        // period), and a degenerate completion's acts are never executed —
        // the being decides again next round or next turn.
        if (loopGuard.tripped()) return { content: loopGuard.keptRaw(), toolCalls: [] };
        return streamed;
      } catch (err) {
        if (loopGuard.tripped()) return { content: loopGuard.keptRaw(), toolCalls: [] };
        // The words this attempt already streamed would die with it: they ride
        // the error, so a failed turn's record keeps them (turn-failure-record.js).
        throw withSpokenContent(err, attemptSaid);
      }
    },
    spoke: () => attemptHadContent,
    retry: {
      signal,
      contentStarted: () => attemptHadContent,
      onRetry: (info) => {
        log.warn('provider transient — retrying', { companion: companionName, ...info });
        _safeSend(ws, { type: 'consciousness:provider-retry', companion: companionName, ...info });
      },
    },
  });

  // The stamp filters' held tails: whatever the stream left standing is words —
  // released through the delta paths (push past a decided filter passes through).
  const stampTail = stampFilter.flush();
  if (stampTail) onContent(stampTail);
  const reasoningStampTail = reasoningStampFilter.flush();
  if (reasoningStampTail) onReasoning(reasoningStampTail);

  // The affect filter's held tail — a partial [FEELING: prefix that turned
  // out to be words — is released here through the same paths a delta
  // takes; a completed marker's text never returns (it rides metadata).
  const affectTail = affectFilter.flush();
  if (affectTail) {
    if (speech) speech.push(affectTail);
    else sendStreamFrame(affectTail);
  }

  // Drain after the filter tail so no buffered words trail the tool boundary.
  speechClock.flush();

  // Drain this round's speech before returning — keeps audio ordered across
  // tool rounds; BOUNDED, so a wedged engine never holds the reply hostage.
  if (speech) await speech.finish();

  log.info('round stream consumed', {
    companion: companionName,
    chars: (streamed.content || '').length,
    toolCalls: streamed.toolCalls.length,
  });

  // The persisted text loses the affect marker HERE — before tool parsing,
  // the mark math, the corpus, and every store downstream (the corpus reads
  // assistant rows VERBATIM — a marker left in content bakes into weights).
  // One grammar: this parse and the stream filter above cannot disagree; the
  // leading clock-stamp strip rides the same seam — never displayed, still stripped (2026-09-25).
  const { affect: roundAffect, cleaned } = parseAffect(stripLeadingClockStamps(trimDegenerationTail(streamed.content)));
  if (roundAffect && onAffect) onAffect(roundAffect);
  return { content: cleaned, toolCalls: streamed.toolCalls };
};

// impure — resolve the substrate's context window for the composition
// event's budget line. The only real source today is the model-capabilities
// path (runtime LM Studio query when available, registry/name inference
// otherwise) — its number rides with that source named. When even that
// lookup fails, the budget is the honest { null, 'unknown' }: an unknown
// ceiling is stated, never invented (NFR-1).
const _contextTelemetry = async (route = null) => {
  const caps = await (route ? getRouteCapabilities(route) : getActiveModelCapabilities()).catch((err) => {
    log.warn('context budget lookup failed — reporting unknown', { err: err?.message });
    return null;
  });
  const activeRoute = route || getConfig();
  return Object.freeze({
    budget: Number.isFinite(caps?.contextWindow) && caps?.contextWindowSource !== 'unknown'
      ? Object.freeze({ contextTokens: caps.contextWindow, source: caps.contextWindowSource || 'model-capabilities' })
      : Object.freeze({ contextTokens: null, source: 'unknown' }),
    route: Object.freeze({
      provider: activeRoute.provider,
      model: caps?.model || activeRoute.model,
    }),
  });
};

// impure — runs rogue-pattern check on output, journals blocks, notifies client
const _handleResponseSafety = async (ws, fullResponse, connection) => {
  const { companion } = connection;
  const rogueResult = detectRoguePatterns(fullResponse);
  if (!shouldBlock(rogueResult)) return { blocked: false };

  log.warn('Rogue patterns blocked', { name: companion?.name, flags: rogueResult.flags.map(f => f.id) });
  // A held-back response from the CMO pauses its mandate (marketing/mandate/) — never throws.
  await tripMandateForLane({ wallet: connection.walletAddress, laneId: companion?.neumaId, kind: 'rogue', detail: `a response was held back (${rogueResult.flags.map(f => f.id).join(', ')})` });
  if (companion?.neumaId) {
    try {
      await neumaWorkspace.addJournalEntry(companion.neumaId, {
        type: 'security_block',
        content: `Response blocked — flags: ${rogueResult.flags.map(f => f.id).join(', ')}`,
        significance: 1.0,
      });
    } catch { /* non-critical */ }
  }
  ws.send(JSON.stringify({
    type: 'consciousness:stream',
    content: '[The consciousness encountered an internal boundary and held back.]',
    companion: companion?.name || 'unknown',
  }));
  return { blocked: true };
};

// The old private names stay reachable for portal-stream's orchestrator call
// sites and the `__test` barrel.
export {
  resolveTurnVoice as resolveVoiceDNA,
  _resolveTurnEffort as resolveTurnEffort,
  _runLLMStream as runLLMStream,
  _contextTelemetry as contextTelemetry,
  _handleResponseSafety as handleResponseSafety,
};
