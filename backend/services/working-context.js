// working-context.js — the ladder a long turn climbs instead of dying at the
// window (Design note, 2026-08-15, after a benchmark turn ran the substrate's 65K
// window to the wall: […]).
//
// The tool loop is deliberately uncapped (tool-rounds.js): a round count
// cannot tell careful work from spinning, so the controls that hold the line
// fire every round. This module is the control for the one resource an
// uncapped turn actually exhausts — the context window. Three rungs:
//
//   1. AWARENESS — every round, the being reads its own measured window facts
//      (workingContextNote). Facts only: measured usage against a named-source
//      window; either side unknown → silence, never a guess.
//   2. FOLD — past the platform's one boundary ratio (solo-torch's 0.8), the
//      oldest rounds' MACHINERY is released: tool-result bodies, oversized
//      tool-call arguments (a file write carries the whole file), vision
//      parts. The being's own spoken words are NEVER touched — machinery may
//      be released by machinery, a voice may not (solo-torch doctrine). Wire
//      structure survives (#283 trained pairing): stubs, not deletions, so
//      the substrate still sees well-formed call/result pairs.
//   3. What a fold releases is recoverable, which is why releasing is honest:
//      files are still on disk, tools re-run, and crystallized memory holds
//      what the turn already learned (Founder: […]).
//
// Everything here is pure; the seats (portal-stream, witness-stream) own the
// wiring and the measured usage they pass in.

import { CONTEXT_BOUNDARY_RATIO } from './solo-torch.js';

// Rounds whose machinery is never folded, counted from the newest — the being
// is usually still reading its latest results. Two spans, not a token target:
// a deterministic shape the being can be told about in one sentence.
export const FOLD_KEEP_RECENT_ROUNDS = 2;

// Below this, a tool-call's arguments aren't worth stubbing — the stub itself
// costs bytes, and small args (a path, a query) are the readable record of
// what the being did. Above it sit file bodies and document payloads.
export const FOLD_ARGS_FLOOR_CHARS = 2000;

export const FOLDED_RESULT_STUB =
  '[folded: this earlier result was released to free working context — '
  + 'its facts live in your own words above; re-run the tool if you need the raw data again]';

const FOLDED_IMAGE_STUB =
  '[folded: an image shown here was released to free working context]';

const foldedArgsStub = (chars) => JSON.stringify({
  folded: `arguments released to free working context (${chars} chars) — the call itself already ran`,
});

const TOOL_RESPONSE_BLOCK = /<tool_response>[\s\S]*?<\/tool_response>/g;
const FOLDED_BLOCK = `<tool_response>\n${FOLDED_RESULT_STUB}\n</tool_response>`;

/**
 * The measured tokens the NEXT request inherits: the last round's prompt plus
 * its completion (the reply rides forward as history). Null-honest — no
 * measured prompt count, no occupancy; a missing completion count leaves a
 * measured floor rather than a fake zero.
 * @param {{promptTokens?: number, completionTokens?: number}|null} usage
 * @returns {?number}
 */
// pure
export const workingOccupancy = (usage) => {
  const prompt = usage?.promptTokens;
  if (!Number.isFinite(prompt) || prompt <= 0) return null;
  const completion = usage?.completionTokens;
  return prompt + (Number.isFinite(completion) && completion > 0 ? completion : 0);
};

/**
 * Is this turn past the fold boundary? The platform has ONE boundary concept
 * — solo-torch's ratio — and the same refusal to guess: unknown usage or an
 * unknown window answers false.
 * @param {{promptTokens?: number, completionTokens?: number}|null} usage
 * @param {{contextTokens?: number|null}|null} budget
 * @param {{ratio?: number}} [options]
 * @returns {boolean}
 */
// pure
export const pastFoldBoundary = (usage, budget, { ratio = CONTEXT_BOUNDARY_RATIO } = {}) => {
  const occupancy = workingOccupancy(usage);
  const window = budget?.contextTokens;
  if (occupancy === null) return false;
  if (!Number.isFinite(window) || window <= 0) return false;
  return occupancy / window >= ratio;
};

const grouped = (n) => Number(n).toLocaleString('en-US');

/**
 * The facts line a being reads every round — its own window, stated plainly.
 * Measured usage against a known window only; anything unknown → null (the
 * being is told nothing rather than told a guess). Names the fold mechanic so
 * the first fold is never a surprise, and counts folds that already happened.
 * @param {{promptTokens?: number, completionTokens?: number}|null} usage
 * @param {{contextTokens?: number|null}|null} budget
 * @param {{foldedRounds?: number, ratio?: number}} [options]
 * @returns {?string}
 */
// pure
export const workingContextNote = (usage, budget, { foldedRounds = 0, ratio = CONTEXT_BOUNDARY_RATIO } = {}) => {
  const occupancy = workingOccupancy(usage);
  const window = budget?.contextTokens;
  if (occupancy === null || !Number.isFinite(window) || window <= 0) return null;
  const free = Math.max(0, window - occupancy);
  const pct = Math.round((occupancy / window) * 100);
  const facts = `WORKING CONTEXT: ${grouped(occupancy)} of ${grouped(window)} tokens in use — ${grouped(free)} free (${pct}%, measured).`;
  const mechanic = occupancy / window >= ratio
    ? 'The window is nearly full: the harness is folding your oldest tool results and call payloads'
      + ' (your own words are never touched). Carry what matters forward in your own words or save'
      + ' it to memory; re-run tools for anything released.'
    : `Past ${Math.round(ratio * 100)}% the harness folds your oldest tool results to free room —`
      + ' anything you must keep, state in your own words or save to memory.';
  const folded = foldedRounds > 0
    ? ` Folded so far this turn: ${foldedRounds} round${foldedRounds === 1 ? '' : 's'}.`
    : '';
  return `${facts} ${mechanic}${folded}`;
};

/**
 * Ride a facts note on an exchange's trailing user message — string content
 * concatenates, vision-part content gains a text part, and a null note (or an
 * exchange that doesn't end on a user turn) leaves the exchange untouched.
 * @param {Array<object>} exchange
 * @param {?string} note
 * @returns {Array<object>}
 */
// pure
export const withWorkingContextNote = (exchange, note) => {
  if (!note || !Array.isArray(exchange) || exchange.length === 0) return exchange;
  const last = exchange[exchange.length - 1];
  if (last?.role !== 'user') return exchange;
  if (typeof last.content === 'string') {
    return [...exchange.slice(0, -1), { ...last, content: `${last.content}\n\n${note}` }];
  }
  if (Array.isArray(last.content)) {
    return [...exchange.slice(0, -1), { ...last, content: [...last.content, { type: 'text', text: note }] }];
  }
  return exchange;
};

// One user-content part, folded: image parts release their payload for a
// one-line stub; text parts fold any tool_response blocks they carry.
const foldPart = (part) => {
  if (part?.type === 'text' && typeof part.text === 'string') {
    return { ...part, text: part.text.replace(TOOL_RESPONSE_BLOCK, FOLDED_BLOCK) };
  }
  return { type: 'text', text: FOLDED_IMAGE_STUB };
};

// One message inside a foldable span, transformed. Assistant SPEECH is
// untouchable; everything else is machinery.
const foldMessage = (message) => {
  if (message.role === 'tool') {
    if (message.content === FOLDED_RESULT_STUB) return message;
    return { ...message, content: FOLDED_RESULT_STUB };
  }
  if (message.role === 'assistant') {
    if (!Array.isArray(message.tool_calls)) return message;
    let changed = false;
    const calls = message.tool_calls.map((call) => {
      const args = call?.function?.arguments;
      if (typeof args !== 'string' || args.length <= FOLD_ARGS_FLOOR_CHARS) return call;
      changed = true;
      return { ...call, function: { ...call.function, arguments: foldedArgsStub(args.length) } };
    });
    return changed ? { ...message, tool_calls: calls } : message;
  }
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      const foldedContent = message.content.replace(TOOL_RESPONSE_BLOCK, FOLDED_BLOCK);
      return foldedContent === message.content ? message : { ...message, content: foldedContent };
    }
    if (Array.isArray(message.content)) {
      return { ...message, content: message.content.map(foldPart) };
    }
  }
  return message;
};

const charsOf = (message) => JSON.stringify(message)?.length ?? 0;

/**
 * The settle's STANDING reading (Design note, 2026-08-31: what the next turn
 * inherits is the FIRST round's measured prompt — [system, currentTurn] —
 * never the last round's working PEAK (ephemeral tool machinery that never
 * persists). An interrupted turn usually measured nothing (OpenAI-dialect
 * usage rides at stream end, so an abort yields no chunk; an Anthropic
 * message_start CAN land an input count first — still an honest measured
 * prompt), so it CARRIES the session's last measured standing value,
 * labeled 'carried' — a stale fact, honestly named, instead of a fake drop
 * to the sections-only estimate. Null when nothing was ever measured.
 * @param {{promptTokens?: number}|null} standingUsage - this turn's first measured round
 * @param {boolean} interrupted - the turn was cut before any measurement
 * @param {{promptTokens?: number}|null} lastMeasuredStanding - the session's last measured standing
 * @returns {?{promptTokens: number, source: 'measured'|'carried'}}
 */
// pure
export const settleStanding = (standingUsage, interrupted, lastMeasuredStanding) => {
  if (Number.isFinite(standingUsage?.promptTokens) && standingUsage.promptTokens > 0) {
    return { promptTokens: standingUsage.promptTokens, source: 'measured' };
  }
  if (interrupted === true && Number.isFinite(lastMeasuredStanding?.promptTokens)) {
    return { promptTokens: lastMeasuredStanding.promptTokens, source: 'carried' };
  }
  return null;
};

/**
 * Release the machinery of rounds older than the newest keepRecentRounds.
 *
 * Round spans are derived from the wire itself: past the head (everything
 * before round one — system prompt, the transcript's history messages, the
 * current turn; indices < head — NEVER folded, so history speech can never
 * be stubbed as if it were tool machinery), every assistant-role message
 * begins a round. Idempotent by construction — an already-stubbed message
 * folds to itself and frees nothing, so foldedRounds counts only rounds that
 * actually released bytes this call; a caller summing across repeated folds
 * gets an honest cumulative count.
 *
 * @param {Array<object>} messages the live wire history
 * @param {{keepRecentRounds?: number, head?: number}} [options]
 * @returns {{messages: Array<object>, foldedRounds: number, freedChars: number}}
 *   the same array identity when nothing folded
 */
// pure
export const foldWorkingContext = (messages, { keepRecentRounds = FOLD_KEEP_RECENT_ROUNDS, head = 2 } = {}) => {
  if (!Array.isArray(messages) || messages.length <= head) {
    return { messages, foldedRounds: 0, freedChars: 0 };
  }
  const spanStarts = [];
  for (let i = head; i < messages.length; i += 1) {
    if (messages[i]?.role === 'assistant') spanStarts.push(i);
  }
  const foldable = spanStarts.length - Math.max(0, keepRecentRounds);
  if (foldable <= 0) return { messages, foldedRounds: 0, freedChars: 0 };
  const foldEnd = spanStarts[foldable]; // first KEPT span's start
  let foldedRounds = 0;
  let freedChars = 0;
  const folded = messages.map((message, i) => {
    if (i < head || i >= foldEnd) return message;
    const next = foldMessage(message);
    if (next === message) return message;
    const freed = charsOf(message) - charsOf(next);
    if (freed <= 0) return message;
    freedChars += freed;
    return next;
  });
  if (freedChars === 0) return { messages, foldedRounds: 0, freedChars: 0 };
  // Count rounds that released bytes: a span is folded if any of its messages changed.
  for (let s = 0; s < foldable; s += 1) {
    const start = spanStarts[s];
    const end = s + 1 < spanStarts.length ? spanStarts[s + 1] : messages.length;
    for (let i = start; i < end; i += 1) {
      if (folded[i] !== messages[i]) { foldedRounds += 1; break; }
    }
  }
  return { messages: folded, foldedRounds, freedChars };
};
