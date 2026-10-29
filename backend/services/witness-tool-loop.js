/**
 * Witness tool loop — the tool rounds of a witness turn.
 * Extracted from witness-stream.js under the size law (the stream file was in
 * the forbidden band): the stream owns the turn; this module owns the rounds —
 * provider streaming with the retry ladder, repeat dedup over world epochs,
 * execution of fresh calls, the exchange written back to the wire, the
 * spin/round-cap closes, and the working-context fold.
 *
 * The loop runs over ONE explicit mutable ctx object built by the stream:
 * `messages`, `fullResponse`, `latestResponse`, `turnUsage`, `foldedRounds`,
 * `mutationEpoch`, and `repeatOnlyRounds` are read AND written through `ctx`,
 * so the stream's settle and catch arms see exactly what the loop left —
 * including when a round throws mid-turn. Everything else on ctx is
 * turn-constant and destructured once below.
 */
import { yieldForQueuedThought } from './queued-action-handoff.js';
import { createStreamRequest, consumeStream, consumeStreamWithTools } from './llm-provider.js';
import { withProviderRetry } from './provider-retry.js';
import { safeSend } from './ws-send.js';
import { toOpenAITools } from './tool-schema.js';
import { detectRoguePatterns, shouldBlock } from './rogue-detector.js';
import { trimDegenerationTail, parseToolCalls, stripToolBlocks, stripHarmonyLeaks } from '../../core/index.js';
import { withProtocolReminders } from './protocol-classifier.js';
import { isFinalToolRound, withinToolRounds } from './tool-rounds.js';
import { pastFoldBoundary, foldWorkingContext, workingContextNote, withWorkingContextNote } from './working-context.js';
import { sightForResults, withSight } from './image-forge/image-sight.js';
import { markTurnText } from './tool-action-record.js';
import { formatWitnessToolResults } from './witness-tools.js';
import { noteToolResultSightings } from './security/injection-sightings.js';
// The disclosure law is the being seat's own (being-tool-surface.js) — the
// seat-agnostic half, read live: the wire recomputes from the connection's
// turn catalog + disclosure set, never from a snapshot taken at turn start.
import { disclosedNativeTools } from './being-tool-surface.js';
// The vision composer lives in portal-turn-input.js (size-law breakdown
// step 13) — imported from its home directly: an extracted loop module never
// reaches back through the portal-stream orchestrator barrel.
import { composeVisionTurn } from './portal-turn-input.js';
import { processWitnessToolBatch } from './witness-tool-batch.js';
import { nativeToolExchange, recordProtocolReminder } from './witness-turn-record.js';
import { createLogger } from './logger.js';
import { openTurnOperations } from './turn-operation-checkpoint.js';
import { unwrapCalls } from './tool-hud.js';
import { withSpokenContent } from './turn-failure-record.js';

// The parent stream's log lane, kept: these lines are the witness turn path's
// own record, and readers grep them under the name they have always carried.
const log = createLogger('WitnessStream');

/**
 * Run the witness turn's tool rounds. impure — streams the provider, executes
 * tools, mutates ctx.
 *
 * @param {object} ctx the turn's explicit loop state (see module header)
 * @returns {Promise<{blocked: boolean}>} blocked=true means a refusal was
 *   already spoken and the turn must end without settling an answer
 */
export const runWitnessToolRounds = async (ctx) => {
  const {
    ws, connection, companionName, laneId, take, route, routeCapabilities,
    preset, effort, thinkBehavior, turnMaxTokens, interrupt, runtime,
    wireHead, contextBudget, compositionFor, toolContextSections,
    onContent, onReasoning, captureUsage, emitToolUsage, refuseTurn,
  } = ctx;
  const turn = ctx.turnOperations ?? await openTurnOperations(connection, take);
  ctx.seenToolCalls = turn.priorByKey;
  // THE LAZY WIRE (ruling, 2026-09-02): the whole catalog no longer rides every
  // round — measured 11,676 tokens at 66 tools before the being seat's law
  // reached this one. Round 0 carries the search hand and the always-wired fs
  // hands only; a tool_search's matches join the wire on the NEXT round. The
  // set is a THUNK, evaluated at each round's request build, because the
  // disclosure state moves between rounds, never inside one.
  const nativeToolsForRound = () => (routeCapabilities.tools
    ? toOpenAITools(disclosedNativeTools(connection))
    : []);
  const closeToolLoop = async (reason) => {
    const closeMessage = {
      role: 'user',
      content: `<tool_response>\n${reason}\n</tool_response>\n\nTool execution is now closed for this turn. Do not emit another tool call. Answer the human directly from the evidence already returned and the original message.`,
    };
    ctx.messages.push(closeMessage);
    toolContextSections.push(Object.freeze({
      id: 'toolLoopClose',
      label: 'TOOL LOOP CLOSE',
      text: closeMessage.content,
    }));
    let closeHadContent = false;
    let closeSaid = '';
    const closeGuardedOnContent = (delta) => {
      if (delta) closeHadContent = true;
      closeSaid += delta || '';
      onContent(delta);
    };
    const finalResponse = trimDegenerationTail(await withProviderRetry(
      async () => {
        closeHadContent = false;
        closeSaid = '';
        const finalRequest = await createStreamRequest(ctx.messages, {
          temperature: preset.temperature,
          topP: preset.topP,
          maxTokens: turnMaxTokens,
          signal: interrupt.signal,
          route,
          ...(effort.directive ? { effort: effort.directive } : {}),
        });
        return consumeStream(finalRequest, closeGuardedOnContent, {
          ...thinkBehavior, signal: interrupt.signal, onUsage: captureUsage, onActionBoundary: () => yieldForQueuedThought(connection),
        });
      },
      {
        signal: interrupt.signal,
        contentStarted: () => closeHadContent,
        onRetry: (info) => {
          log.warn('provider transient — retrying', { laneId, attempt: info.attempt, delayMs: info.delayMs, reason: info.reason });
          safeSend(ws, {
            type: 'consciousness:provider-retry',
            companion: companionName,
            attempt: info.attempt,
            maxAttempts: info.maxAttempts,
            delayMs: info.delayMs,
            reason: info.reason,
          });
        },
      },
    // The words a dying stream already spoke ride its error (turn-failure-record.js).
    ).catch((err) => { throw withSpokenContent(err, closeSaid); }));
    ctx.latestResponse = finalResponse;
    ctx.fullResponse += `${ctx.fullResponse ? '\n\n' : ''}${finalResponse}`;
    const spoken = stripToolBlocks(finalResponse);
    if (spoken && shouldBlock(detectRoguePatterns(spoken))) {
      log.warn('witness response blocked by output classifier', { laneId });
      refuseTurn(ws, companionName, '\n*The response was withheld.*\n', null, take);
      return { blocked: true };
    }
    if (!spoken && !interrupt.signal.aborted) {
      safeSend(ws, {
        type: 'consciousness:stream',
        content: '[The witness completed its tool work but did not provide a final response.]',
        companion: companionName,
        error: true,
      });
    }
    return { blocked: false };
  };
  // Uncapped by default (tool-rounds.js): a round count cannot distinguish
  // careful work from spinning — the policy cascade, the approval card, the
  // path sandbox and the denied-path list are the real controls, and each
  // fires on every call. NEUMA_MAX_TOOL_ROUNDS remains an opt-in backstop
  // because how many rounds is "enough" is a property of the work.
  for (let round = 0; withinToolRounds(round); round += 1) {
    // Recomputed EVERY round: a tool_search that landed last round put its
    // matches on the disclosure set, and this round's wire must carry them.
    const nativeTools = nativeToolsForRound();
    // THE RETRY LADDER (ruling, 2026-07-28): a transient overload gets up to
    // 10 visible attempts — but ONLY while nothing has streamed yet (a
    // recovering provider must never duplicate partial speech).
    let attemptHadContent = false;
    let attemptSaid = '';
    const guardedOnContent = (delta) => {
      if (delta) attemptHadContent = true;
      attemptSaid += delta || '';
      onContent(delta);
    };
    const streamed = await withProviderRetry(
      async () => {
        attemptHadContent = false;
        attemptSaid = '';
        const streamResult = await createStreamRequest(ctx.messages, {
          temperature: preset.temperature,
          topP: preset.topP,
          maxTokens: turnMaxTokens,
          signal: interrupt.signal,
          route,
          ...(effort.directive ? { effort: effort.directive } : {}),
          // Several reads fire as one thought — serialising them costs a
          // round-trip per source. Every call still crosses the same
          // policy, approval and sandbox gates, one by one, in the handler.
          ...(nativeTools.length ? { tools: nativeTools } : {}),
        });
        return nativeTools.length
          ? consumeStreamWithTools(streamResult, guardedOnContent, {
            ...thinkBehavior, signal: interrupt.signal, onUsage: captureUsage, onActionBoundary: () => yieldForQueuedThought(connection), onReasoning,
          })
          : {
            content: await consumeStream(streamResult, guardedOnContent, {
              ...thinkBehavior, signal: interrupt.signal, onUsage: captureUsage, onActionBoundary: () => yieldForQueuedThought(connection), onReasoning,
            }),
            toolCalls: [],
          };
      },
      {
        signal: interrupt.signal,
        contentStarted: () => attemptHadContent,
        onRetry: (info) => {
          log.warn('provider transient — retrying', { laneId, attempt: info.attempt, delayMs: info.delayMs, reason: info.reason });
          safeSend(ws, {
            type: 'consciousness:provider-retry',
            companion: companionName,
            attempt: info.attempt,
            maxAttempts: info.maxAttempts,
            delayMs: info.delayMs,
            reason: info.reason,
          });
        },
      },
    ).catch((err) => { throw withSpokenContent(err, attemptSaid); });
    const roundResponse = trimDegenerationTail(streamed.content);
    ctx.latestResponse = roundResponse;
    ctx.fullResponse += `${ctx.fullResponse ? '\n\n' : ''}${roundResponse}`;
    // This round's words stand written; the acts it calls for sit after them.
    markTurnText(ws, ctx.fullResponse.length);
    yieldForQueuedThought(connection);
    if (interrupt.signal.aborted) break;

    // A context/map_read tool in this round must see this round's actual
    // usage and every prior tool exchange, not the assembly-time snapshot —
    // and the desk gauge tracks the long turn LIVE on the same event.
    connection.contextComposition = compositionFor(
      ctx.turnUsage, roundResponse, toolContextSections,
    );
    safeSend(ws, connection.contextComposition);

    // a call through the door is the call it names (tool-hud.js) — every gate judges the real tool
    const calls = unwrapCalls(streamed.toolCalls.length ? streamed.toolCalls : parseToolCalls(roundResponse));
    const spokenResponse = calls.length ? stripToolBlocks(roundResponse) : roundResponse;
    if (spokenResponse && shouldBlock(detectRoguePatterns(spokenResponse))) {
      log.warn('witness response blocked by output classifier', { laneId });
      refuseTurn(ws, companionName, '\n*The response was withheld.*\n', null, take);
      return { blocked: true };
    }
    if (!calls.length) break;
    // A REPEAT IS NOT A RUNAWAY: a repeated call is ANSWERED with the
    // result it already produced and the loop carries on (one repeat used
    // to end the turn — fatal to truncated-page re-fetches). Only a round
    // of nothing-but-repeats, twice consecutively, is spinning. Epochs: a
    // read issued after a write asks a genuinely different question and
    // must run (BE-142 #214).
    const results = await processWitnessToolBatch({ ws, connection, calls, runtime, turn });
    ctx.mutationEpoch = turn.epoch;
    noteToolResultSightings(connection, results); // a flag for the CSO, never awaited, never a gate (G13)
    if (!results.length || interrupt.signal.aborted) break;
    // THE RETURN — a render this round produced comes back to the witness's
    // own eyes before it speaks (image-sight.js): the image tools were
    // registered ONCE for both seats, so the sight of what they make is too.
    const sight = sightForResults(results, {
      canSee: Boolean(routeCapabilities?.vision),
      modelName: routeCapabilities?.model || route?.model || null,
    });
    const baseExchange = streamed.toolCalls.length
      ? nativeToolExchange(roundResponse, calls, results, round, laneId)
      : [
          // The echo keeps the taught [TOOL:…] calls verbatim but not leaked
          // harmony control markup (CQ-906 / #526) — a model that reads its own
          // leaked markup back repeats it next round.
          { role: 'assistant', content: stripHarmonyLeaks(roundResponse) },
          {
            role: 'user',
            content: withProtocolReminders(formatWitnessToolResults(results), calls, {
              ownText: roundResponse || '',
              record: (entries) => recordProtocolReminder(laneId, entries),
            }),
          },
        ];
    // SELF-AWARENESS (ruling, 2026-08-15): the witness reads its own measured
    // window facts every round — working-context.js, silent when unmeasured.
    const exchange = withWorkingContextNote(
      withSight(baseExchange, sight, composeVisionTurn),
      workingContextNote(ctx.turnUsage, contextBudget, { foldedRounds: ctx.foldedRounds }),
    );
    toolContextSections.push(Object.freeze({
      id: `toolRound${round + 1}`,
      label: `TOOL ROUND ${round + 1}`,
      // The BASE exchange plus the note — never the composed vision parts:
      // a stringified data URI would put megabytes of base64 into the
      // telemetry, and an image's token cost ≠ its payload length.
      text: `${JSON.stringify(baseExchange)}${sight.note ? `\n\n${sight.note}` : ''}`,
    }));
    // Nothing new attempted this round: once is ordinary, twice running is
    // spinning — the turn closes on the evidence already gathered.
    ctx.repeatOnlyRounds = results.every((result) => result.status === 'held') ? ctx.repeatOnlyRounds + 1 : 0;
    if (ctx.repeatOnlyRounds >= 2) {
      log.warn('witness tool loop repeating without progress', { laneId, round: round + 1 });
      emitToolUsage({
        tool: 'runtime/tool-loop', status: 'held',
        summary: 'two rounds of repeated calls — closing on the evidence gathered',
      });
      ctx.messages.push(...exchange);
      const closed = await closeToolLoop('The last two rounds repeated calls already made; their results stand as the evidence.');
      if (closed.blocked) return { blocked: true };
      break;
    }
    if (isFinalToolRound(round)) {
      log.warn('witness tool loop round cap reached', { laneId, rounds: round + 1 });
      emitToolUsage({
        tool: 'runtime/tool-loop', status: 'error',
        summary: `tool loop stopped after ${round + 1} rounds`,
      });
      ctx.messages.push(...exchange);
      const closed = await closeToolLoop(`The tool-round limit was reached after ${round + 1} rounds. Use the evidence already returned.`);
      if (closed.blocked) return { blocked: true };
      break;
    }
    ctx.messages.push(...exchange);
    // THE FOLD (working-context.js): past the platform's one boundary,
    // aged rounds release their machinery so an uncapped turn keeps its
    // window. The witness's own words are never touched.
    if (pastFoldBoundary(ctx.turnUsage, contextBudget)) {
      const fold = foldWorkingContext(ctx.messages, { head: wireHead });
      if (fold.freedChars > 0) {
        ctx.messages = fold.messages;
        ctx.foldedRounds += fold.foldedRounds;
        toolContextSections.push(Object.freeze({
          id: `fold${ctx.foldedRounds}`, label: `FOLD ×${ctx.foldedRounds}`,
          text: `[released ${fold.freedChars} chars of aged tool machinery]`,
        }));
        log.info('witness working context folded', { laneId, round, foldedRounds: ctx.foldedRounds, freedChars: fold.freedChars });
      }
    }
  }
  return { blocked: false };
};
