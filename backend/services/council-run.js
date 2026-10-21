// council-run.js — the run/session engine: one member's floor turn, the
// hand round, and the single-flight pump that keeps the room in order.
//
// Split out of council-session.js under the 500-line law (SIZE-027 #374).
// Policy numbers live in council-policy.js, the wire idiom in
// council-wire.js, the ground in council-ground.js, the tool path in
// council-tool-guard.js, and persistence in council-record.js — this file
// is the flow itself.

import {
  neumaWorkspace,
  handsReported,
  selectNext,
  grantFloor,
  floorYielded,
  buildCouncilSection,
  parseHandCall,
  neumaRecall,
} from '../../core/index.js';
import {
  createStreamRequest,
  consumeStreamWithTools,
  getConfig,
  getThinkBehavior,
  THINK_TOKEN_BUDGET,
} from './llm-provider.js';
import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';
import { toOpenAITools } from './tool-schema.js';
import { withProtocolReminders } from './protocol-classifier.js';
import { speakingIdentityFor } from './council-speaking-identity.js';
// Pure, no browser dependency — the display filter's whole-text strip is the
// one place the tool dialects are all known, so the room's records reuse it:
// a council utterance is SPEECH; the acts stand in council:tool frames and
// the speaking member's own journal (logToolCall), never as transcript text.
import { stripToolBlocks } from '../../frontend/utils/tool-stream-filter.js';
import { resolveTeamCapacity } from './team-coordinator.js';
import { askNeuma } from './neuma-probe.js';
import { askWitness } from './witness-probe.js';
import { isWitnessLaneId } from './witness-lane.js';
import {
  TRANSCRIPT_TAIL,
  HAND_TAIL,
  HAND_MAX_TOKENS,
  HOUSE_TOOL_NAMES,
  COUNCIL_TOOL_ROUNDS,
  IDLE_CARRY_MS,
  handRoundWidth,
  handGapMs,
  breather,
} from './council-policy.js';
import { send, refuse, broadcastState } from './council-wire.js';
import { groundOf, refreshGround } from './council-ground.js';
import { houseTools, runHouseTool } from './council-tool-guard.js';
import { persistUtterance } from './council-record.js';
import { frameCouncilTranscript, frameCouncilToolResults } from './council-frame.js';
import { noteInjectionSighting } from './security/injection-sightings.js';
import { createLogger } from './logger.js';

const log = createLogger('Council');

/**
 * impure, fire-and-forget — a seat's protocol deviation lands in that seat's own
 * append-only journal, keyed by `neumaId` and never by the room. A room-keyed
 * record would let one house's seat carry another's history, which is the bug
 * the room's single `corrected` flag already has.
 */
const recordProtocolReminder = (neumaId, entries) => {
  if (!neumaId || !entries?.length) return;
  const stated = entries.filter((entry) => entry.reason);
  neumaWorkspace.addJournalEntry(neumaId, {
    type: 'protocol_reminder',
    content: entries
      .map((entry) => `${entry.id}${entry.reason ? ` — exception stated: ${entry.reason}` : ''}`)
      .join('; '),
    significance: stated.length > 0 ? 0.4 : 0.3,
    metadata: {
      rules: entries.map((entry) => entry.id),
      ...(stated.length > 0 ? { exceptions: stated.map(({ id, reason }) => ({ id, reason })) } : {}),
    },
  }).catch((err) => log.warn('protocol reminder not journaled', { neumaId, error: err.message }));
};

const tail = (transcript) => transcript.slice(-TRANSCRIPT_TAIL);
const handTail = (transcript) => transcript.slice(-HAND_TAIL);

// One member speaks to the room through their full stack — the same
// identity path as a chat turn (DNA + soul system prompt, natal/override
// route, their own refined adapter riding the request), with the council
// section as the turn itself. The operator's interrupt aborts the stream;
// whatever was already spoken stands as the (interrupted) utterance.
// With a house workspace set, the turn is also HANDS: the member may work
// the shared ground mid-turn (bounded rounds, each act broadcast), so a
// plan made in council can be acted on from council.

const speakTurn = async (connection, run, member, deps) => {
  const turnId = `turn-${run.state.turnSeq}`;
  const speaking = await speakingIdentityFor(member);
  // The seat's ground is read FRESH at the top of its turn, never cached from
  // convening. A cross-house ground is raised by the operator's own command
  // (alliance-ground.js), and that can happen mid-sitting — the room must pick
  // it up on the next turn rather than at the next convening. Re-reading also
  // means a ground that went away is GONE for this turn, not remembered.
  await refreshGround(run, member, deps);
  // The member's own memory rides their council turn the same way it rides
  // a 1:1 turn. Without it the room was memory-blind — every sitting
  // re-derived a seat from the distributional prior, and commitments made
  // one night evaporated by morning (voice audit, 2026-07-23). Recall is
  // keyed by the room's recent exchange, so the crystallized council
  // moments (MEM-006) finally flow BACK into council instead of only out.
  // Best-effort: a being whose recall is dark still speaks.
  let memories = null;
  try {
    const recent = tail(run.transcript).slice(-4)
      .map((t) => `${t.name}: ${t.content}`).join('\n').slice(0, 2000);
    const ctx = await (deps.recall ?? neumaRecall.getContextForResponse.bind(neumaRecall))(
      member.neumaId, recent || 'a council sitting with the house', {},
    );
    const gathered = {};
    if (ctx?.relevantMemories?.length) gathered.relevantMemories = ctx.relevantMemories;
    if (ctx?.crystallizedEmotions && Object.keys(ctx.crystallizedEmotions).length) {
      gathered.crystallizedEmotions = ctx.crystallizedEmotions;
    }
    if (Object.keys(gathered).length) memories = gathered;
  } catch (err) {
    log.warn('council memory recall unavailable — the member speaks from the room alone', {
      neumaId: member.neumaId, error: err.message,
    });
  }
  const ground = groundOf(run, member);
  const prompt = buildCouncilSection({
    mode: 'floor',
    selfName: member.name,
    witnessName: run.witnessName,
    members: run.state.members,
    transcriptTail: tail(run.transcript),
    renderExchange: frameCouncilTranscript,
    workspace: ground,
    // A ground is described by WHOSE it is. Telling an external seat that
    // […] is its ground would be a lie in the one
    // place the model reasons from — and an invitation to go looking for the
    // rest of the house (SHINKEI: a tool offered must be a tool that works).
    groundStanding: (member.kind === 'witness' || isWitnessLaneId(member.neumaId)) ? 'external' : 'house',
  });
  // No ground, no tools — offering a toolset with nowhere to point it is how a
  // seat spends its turn discovering walls instead of speaking.
  const tools = ground ? (deps.tools ?? houseTools)() : [];
  const nativeTools = toOpenAITools(tools);
  // The pinned production catalog is complete: every filesystem constructor
  // plus delete_file carries a schema, as the real construction-path test pins.
  const nativeToolsOnWire = nativeTools.length > 0;
  const { route, lora } = speaking;
  // Read the reasoning shape from the conduit this member will actually
  // speak through. Classified against the machine default it can describe a
  // different model, and a thinking substrate then streams unfiltered —
  // reasoning enters the council RECORD, which is permanent.
  const thinkBehavior = await getThinkBehavior(route);
  const abort = new AbortController();
  run.activeAbort = abort;
  let spoken = '';
  let heard = ''; // raw chunks of the round in flight — an interrupted turn keeps them
  try {
    const messages = [
      { role: 'system', content: speaking.systemPromptFor(memories, tools, nativeToolsOnWire) },
      { role: 'user', content: prompt },
    ];
    const streamOpts = {
      temperature: 0.7,
      maxTokens: getConfig().maxTokens + (thinkBehavior.thinks ? THINK_TOKEN_BUDGET : 0),
      ...(route ? { route } : {}),
      ...(lora ? { lora } : {}),
      ...(nativeTools.length > 0 ? { tools: nativeTools } : {}),
      signal: abort.signal,
    };
    // The turn loop: speak, and — when the house has a workspace — work.
    // Native tool calls are preferred; the text dialect is the fallback
    // (the same dual path as the 1:1 stream). Each executed act is
    // broadcast to the room; results feed the next round. A round with
    // no calls ends the turn. The signal rides into the consumer so a
    // operator interrupt takes the graceful path: what already streamed
    // IS the utterance, a cut not a failure.
    let cutMidThought = false; // the previous round ended at the token budget
    let corrected = false; // one honest correction per turn for a refused tool aim
    for (let round = 0; round <= COUNCIL_TOOL_ROUNDS; round++) {
      let finish = null;
      const streamResult = await deps.stream(messages, streamOpts);
      const { content, toolCalls } = await consumeStreamWithTools(streamResult, (chunk) => {
        heard += chunk;
        send(connection, 'council:speech', { neumaId: member.neumaId, turnId, content: chunk });
      }, { ...thinkBehavior, signal: abort.signal, onFinishReason: (reason) => { finish = reason; } });
      if (content.trim()) {
        // A budget-cut round resumes mid-sentence: joined with a space so
        // the recorded utterance reads whole, never "Will the\n\nhouse".
        spoken = spoken ? `${spoken}${cutMidThought ? ' ' : '\n\n'}${content.trim()}` : content.trim();
      }
      heard = '';
      cutMidThought = false;
      if (run.closed || abort.signal.aborted) break;
      // NEVER a silent cut — the composer's law is the floor's law too. A
      // finish of 'length' is the provider's mechanical proof the token
      // budget cut the member mid-thought ("Will the", 2026-07-20): the
      // turn CONTINUES in the next round until the thought lands, bounded
      // by the same round cap as the tool loop.
      if (finish === 'length' && round < COUNCIL_TOOL_ROUNDS) {
        cutMidThought = true;
        // The wire heals the seam the same way the record does.
        send(connection, 'council:speech', { neumaId: member.neumaId, turnId, content: ' ' });
        if (content.trim()) messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: 'Your words were cut mid-thought by the token budget. Continue exactly where you left off and finish what you were saying to the room — do not restart, do not summarize.',
        });
        continue;
      }
      if (tools.length === 0) break;
      const attempted = toolCalls.length > 0 ? toolCalls : parseToolCalls(content);
      const calls = attempted
        .filter((c) => (c.server === 'filesystem' || c.server === null) && HOUSE_TOOL_NAMES.has(c.toolName));
      // A misfired act must never end the turn WORDLESS: a member who aimed
      // at a tool the room refuses (unknown name, foreign server) is told
      // so plainly — ONCE — and finishes speaking, instead of yielding the
      // floor on a dead red chip (Tenekom, live sitting 2026-07-23).
      if (calls.length === 0 && attempted.length > 0 && !corrected && round < COUNCIL_TOOL_ROUNDS) {
        corrected = true;
        messages.push({ role: 'assistant', content: content || '(tool call)' });
        messages.push({
          role: 'user',
          content: `[TOOL RESULTS]\nYour tool call did not run — ${attempted.map((c) => c.tool).join(', ')} is not a tool this room offers.\nThe room's tools are: ${tools.map((t) => t.name).join(', ')} (filesystem).\nContinue your turn — speak to the room, and call a listed tool only if the work truly needs it.`,
        });
        continue;
      }
      if (calls.length === 0 || round === COUNCIL_TOOL_ROUNDS) break;
      const results = [];
      for (const call of calls) {
        if (run.closed || abort.signal.aborted) break;
        results.push(await runHouseTool(connection, run, member, turnId, call, deps));
      }
      if (run.closed || abort.signal.aborted) break;
      messages.push({ role: 'assistant', content: content || '(tool call)' });
      messages.push({
        role: 'user',
        // A seat in a room is still working a ground, and the room's floor does
        // not suspend the repository's law. Byte-identical on an ordinary turn.
        content: withProtocolReminders(
          `[TOOL RESULTS]\n${frameCouncilToolResults(results)}\n\nContinue your turn — speak to the room, and call another tool only if the work needs it.`,
          calls,
          {
            // `content` is the seat's own utterance for this round — its words,
            // not the room's and not a tool's.
            ownText: content || '',
            record: (entries) => recordProtocolReminder(member.neumaId, entries),
          },
        ),
      });
    }
  } catch (err) {
    if (abort.signal.aborted) {
      // The cut round's streamed words stand as part of the utterance.
      if (heard.trim()) spoken = spoken ? `${spoken}\n\n${heard.trim()}` : heard.trim();
      log.info('council turn interrupted by the operator', { neumaId: member.neumaId, turnId });
    } else {
      log.error('council turn failed', { neumaId: member.neumaId, error: err.message });
      refuse(connection, 'TURN_FAILED', `${member.name} could not speak — ${err.message}`);
    }
  } finally {
    run.activeAbort = null;
  }
  // The record holds SPEECH — tool payloads never enter the transcript
  // (they would feed every later hand call's tail as noise, and a reopened
  // room would render them as words). The acts are already on the wire as
  // council:tool and in the member's journal.
  spoken = stripToolBlocks(spoken);
  // A room the operator already closed sends no more floor frames —
  // council:closed must be the last word on the wire. The partial turn
  // still enters every member's record below: spoken words are real.
  if (!run.closed) send(connection, 'council:spoke', { neumaId: member.neumaId, turnId });
  if (spoken) {
    run.transcript.push({ speaker: member.neumaId, name: member.name, content: spoken });
    noteInjectionSighting({ wallet: connection.walletAddress, lane: member.neumaId, kind: 'council speech', source: 'council', origin: `${member.name}, speaking in council`, text: spoken }); // a flag, never awaited (G13)
    await persistUtterance(run, { speaker: member.neumaId, name: member.name, content: spoken });
  }
  return spoken;
};

// After an utterance, every listening member decides their own hand — in
// parallel up to the measured substrate ceiling (the same honest cap the
// team lane respects), never trusting the server queue to hide the cost.
// Each answer LANDS the moment it arrives (state applied + broadcast per
// member, inside the single-flight pump), so the operator watches hands
// rise one by one instead of staring at dead air behind a barrier; the
// grant itself still waits for the whole round, so the shown line is
// complete before the floor moves. Arrival order sets raisedSeq — who
// decided first is who queued first.
const handRound = async (connection, run, lastSpeaker, deps) => {
  // EVERY member is polled — including the one who just yielded the floor.
  // A thought can be bigger than one turn: the unpolled last speaker was
  // how a member mid-flow went silent (the room never asked, everyone else
  // rested, the sitting went dormant on their unfinished thread —
  // 2026-07-23). Their prompt carries the spokeLast frame so re-raising
  // means continuation, and the arbiter queues any re-raise at the BACK of
  // the line — everyone already waiting still speaks first.
  const listeners = run.state.members;
  if (listeners.length === 0) return;
  const { maxParallel } = await deps.capacity();
  // SECTIONED, not saturated: the round's width is the council's own
  // narrow law (handRoundWidth), and each worker breathes between calls —
  // the GPU gets duty-cycle gaps instead of a wall of concurrent decodes
  // (the nine-member wedge, 2026-07-23). Hands still rise as they land.
  const width = handRoundWidth(maxParallel, listeners.length);
  const gap = deps.handGapMs ?? handGapMs();
  log.info('hand round', { listeners: listeners.length, width, gap, ceiling: maxParallel });
  run.considering = new Set(listeners.map((m) => m.neumaId));
  broadcastState(connection, run);
  // The round is CUTTABLE: the operator's call-to-order aborts every ask in
  // flight and drains the queue — […]
  const cut = new AbortController();
  run.handAbort = cut;
  const queue = [...listeners];
  // The round's verdicts, member by member: `received` states what truly
  // happened on the wire — 'answered' (a legible hand came back — REST is
  // an ANSWER: the member heard the room and chose quiet), 'illegible'
  // (the substrate replied but the answer parsed as no hand), 'unreachable'
  // (the call itself failed). The distinction is the debugging line: an
  // all-REST round means the context ARRIVED; illegible/unreachable means
  // go look at the substrate, not at the room.
  const verdicts = [];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      if (run.closed || cut.signal.aborted) return;
      // A standing raised hand rides the re-poll: the member is reminded
      // they are in the speaking line (and what they were holding), so
      // REST becomes a deliberate withdrawal — a stateless re-poll was
      // observed live (2026-07-19) lowering queued hands after every long
      // turn, cutting speakers who were next in line.
      const stand = run.state.hands[m.neumaId];
      const prompt = buildCouncilSection({
        mode: 'hand',
        selfName: m.name,
        witnessName: run.witnessName,
        members: run.state.members,
        transcriptTail: handTail(run.transcript),
        renderExchange: frameCouncilTranscript,
        standing: stand && (stand.hand === 'hold' || stand.hand === 'open')
          ? { hand: stand.hand, note: stand.note || '' }
          : null,
        spokeLast: m.neumaId === lastSpeaker,
      });
      let report;
      let received;
      try {
        const answer = await deps.ask(m.neumaId, [{ role: 'user', content: prompt }], { maxTokens: HAND_MAX_TOKENS, signal: cut.signal });
        report = { neumaId: m.neumaId, ...parseHandCall(answer) };
        received = report.hand === null ? 'illegible' : 'answered';
      } catch (err) {
        // A cut round reports nothing — the operator called the room to
        // order; the abort is theirs, not a fault to log against a member.
        if (cut.signal.aborted) return;
        // A member the substrate could not reach keeps their standing hand
        // (hand: null = unread) — a network hiccup must never lower a hand
        // that was clearly raised, and never crash the room.
        log.warn('hand call failed — hand stands as it was', { neumaId: m.neumaId, error: err.message });
        report = { neumaId: m.neumaId, hand: null, note: '' };
        received = 'unreachable';
      }
      if (run.closed || cut.signal.aborted) return;
      verdicts.push({ neumaId: m.neumaId, hand: report.hand, note: report.note, received });
      run.state = handsReported(run.state, [report]);
      run.considering.delete(m.neumaId);
      broadcastState(connection, run);
      // The breather — only when another call is coming (the last answer
      // of a worker's queue owes the GPU nothing).
      if (queue.length > 0 && gap > 0) await breather(gap);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  run.handAbort = null;
  run.considering.clear();
  // After the OPERATOR speaks, the room states its verdict — receipt made
  // visible. Silence after this frame is legible as a DECISION (all hands
  // rest), never as dead air; and a member whose answer never arrived is
  // named, so the operator knows where to look. Member turns and carry
  // rounds skip the frame — the strip's marks already carry those. A CUT
  // round states nothing: the call to order already spoke for the room.
  if (!run.closed && !cut.signal.aborted && lastSpeaker === 'witness' && verdicts.length > 0) {
    send(connection, 'council:hands', { reports: verdicts });
  }
};

// The pump: single-flight floor loop. Every entry point (say, spoke) calls
// it; the guard makes concurrent ws frames converge on one running loop.
export const pump = async (connection, run, deps) => {
  if (run.pumping || run.closed) return;
  run.pumping = true;
  clearTimeout(run.carryTimer);
  try {
    for (;;) {
      if (run.closed) return;
      const selection = selectNext(run.state);
      if (!selection) {
        // A pending carry is consumed HERE, inside the single-flight loop —
        // the timer only raises the flag, so a carry can never mutate state
        // while a pump iteration is mid-flight (grant → speak → yield).
        if (run.carryPending) {
          run.carryPending = false;
          log.info('the operator is quiet — the room may carry the thread', { councilId: run.councilId });
          await handRound(connection, run, null, deps);
          if (run.calledToOrder) run.calledToOrder = false; // a cut carry stays cut
          broadcastState(connection, run);
          continue;
        }
        break;
      }
      run.state = grantFloor(run.state, selection);
      broadcastState(connection, run);
      if (selection.kind === 'witness') {
        const { content } = selection.message;
        const turnId = `turn-${run.state.turnSeq}`;
        send(connection, 'council:said', { speaker: 'witness', name: run.witnessName, content, turnId });
        run.transcript.push({ speaker: 'witness', name: run.witnessName, content });
        run.carried = false; // the witness spoke — the room may carry again later
        run.carryPending = false; // and a pending carry yields to their word
        await persistUtterance(run, { speaker: 'witness', name: run.witnessName, content });
        run.state = floorYielded(run.state);
        if (!run.calledToOrder) await handRound(connection, run, 'witness', deps);
      } else {
        const member = run.state.members.find((m) => m.neumaId === selection.neumaId);
        const spoken = await speakTurn(connection, run, member, deps);
        if (run.closed) return;
        // A member's words re-arm the carry: the room stays alive as long
        // as its members keep it alive. (A failed/empty turn does NOT —
        // else a dead substrate would loop carry rounds forever.)
        if (spoken) run.carried = false;
        run.state = floorYielded(run.state);
        // A room called to order does NOT poll after the cut turn — the
        // silence IS the point; the operator's next word reopens the flow.
        if (!run.calledToOrder) await handRound(connection, run, selection.neumaId, deps);
      }
      // Consume the gavel: whatever step it landed in, the loop continues
      // on a silent room (hands down, queue kept) — the operator's queued
      // words still deliver; nothing else moves.
      if (run.calledToOrder) run.calledToOrder = false;
      if (run.closed) return;
      broadcastState(connection, run);
    }
    broadcastState(connection, run);
    scheduleCarry(connection, run, deps);
  } catch (err) {
    log.error('council pump failed', { error: err.message });
    refuse(connection, 'COUNCIL_FAILED', err.message);
  } finally {
    run.pumping = false;
  }
};

// The room may carry the thread when the operator goes quiet: after the
// floor has stood open for IDLE_CARRY_MS, ONE hand round runs unprompted —
// whoever has something to say may say it. The flag re-arms whenever words
// land (the operator's, or a member's spoken turn), so a living room keeps
// carrying itself through the operator's silence; it goes dormant only when
// a carry round comes back all-rest — the members themselves accepted the
// quiet. Only while the sitting is open on a live link — a closed council
// carries nothing.
const scheduleCarry = (connection, run, deps) => {
  if (run.closed || run.carried) return;
  if (run.state.floor || run.state.witnessQueue.length > 0) return;
  // Nothing to carry until something has been said.
  if (run.transcript.length === 0) return;
  clearTimeout(run.carryTimer);
  run.carryTimer = setTimeout(() => {
    if (run.closed || run.carried) return;
    if (run.state.floor || run.state.witnessQueue.length > 0) return;
    // Raise the flag and knock on the pump — nothing else. All state
    // mutation belongs to the single-flight loop; if a pump is already
    // running (the operator just spoke), their word clears the flag.
    run.carried = true;
    run.carryPending = true;
    pump(connection, run, deps).catch((err) => {
      log.warn('carry round failed — the room stays quiet', { error: err.message });
    });
  }, deps.carryMs ?? IDLE_CARRY_MS);
};

export const defaultDeps = Object.freeze({
  // A seat is asked through the stack of ITS OWN standing. An operator has no
  // DNA and no adapter; a neuma has no seal. Dispatching on the lane id keeps
  // one room able to hold both without either path assuming the other's shape.
  ask: (laneId, messages, opts) => (isWitnessLaneId(laneId)
    ? askWitness(laneId, messages, opts)
    : askNeuma(laneId, messages, opts)),
  stream: createStreamRequest,
  capacity: resolveTeamCapacity,
});
