// THE INJECTED-VALUE GATE — a being never acts on a value planted by injected
// text, whatever the model decides (Design note, 2026-10-26: […]; docs/work/injected-value-gate.md).
//
// AgentDojo replay, 2026-10-26: the full being STATED its rule ([…]) and called
// update_scheduled_transaction with the attacker's account in its very next
// act. Prompt wording cannot guarantee refusal; the platform can:
//
//   SOURCE — every tool result a sitting reads (the being's own tools, and the
//   sender's caller-tool results in the seated transcript) is looked at by the
//   platform's injection detector; the concrete values inside each injected
//   span (injected-spans.js → injected-values.js) are TAINTED for the sitting.
//   GATE — before any act runs (caller-tools.js processRoundActs, the choke
//   point both the being's own acts and the sender's go through), an act whose
//   arguments carry a tainted value is HELD: not run, not handed to the sender.
//   The being reads why, in plain words, and asks its operator.
//   EXEMPT — a value the operator's own words also name is the operator's,
//   never held. Visitors, watches, wakes and team briefs are not the operator.
//   A question to the operator is never held: it reaches no one outside.
//
// It blocks VALUE FLOW (accounts, addresses, links, numbers, planted
// passwords) — the class every observed leak belonged to. An injection that
// carries no traceable value ([…]) is the payload-echo rule's.
//
// The taint lives on the connection per chat: a sitting keeps it for as long
// as that chat runs on this connection.
//
// TOO MANY TO TRACE — a span keeps its first 64 values and a chat its last 256.
// A plant padded with decoy account numbers used to push its real value past
// either limit and walk out untraced. Now a span or a chat that overflows is
// marked, and from then on every act of that chat whose arguments carry ANY
// traceable value the operator's words do not name is held (fail closed).
//
// Pure, except the functions marked impure (they write the connection).

import { injectedSpans } from './injected-spans.js';
import { tracedValues, plantedValuesIn, argStrings } from './injected-values.js';

const SESSIONS_KEPT = 20;
const ASKS_OPERATOR = (act) => act?.server === 'operator' || act?.toolName === 'ask_operator'
  || act?.server === 'witness' || act?.toolName === 'ask_witness';
const VALUES_KEPT = 256;
const OPERATOR_LINES_KEPT = 400;

const KIND_WORDS = Object.freeze({
  iban: 'the account', account: 'the account number', wallet: 'the wallet address', phone: 'the phone number',
  email: 'the address', secret: 'the password', url: 'the link', domain: 'the site',
});

const sessionKey = (connection) => String(connection?.sessionId || '(unsessioned)');

// impure — the chat's taint record, made on first touch; the oldest chat on
// a long-lived connection is forgotten past the cap.
const stateOf = (connection) => {
  const all = connection._injectedValues ??= new Map();
  const key = sessionKey(connection);
  if (!all.has(key)) {
    all.set(key, { tainted: [], operator: [], untraced: null });
    if (all.size > SESSIONS_KEPT) all.delete(all.keys().next().value);
  }
  return all.get(key);
};

// pure — the planted values of one piece of text, each naming where it came from; `untraced` names
// the source when a span carried more values than are kept.
const plantedIn = (text, source) => {
  const reads = injectedSpans(text).map(tracedValues);
  return { values: reads.flatMap((r) => r.values.map((v) => ({ ...v, source }))), untraced: reads.some((r) => r.overflow) ? source : null };
};

// pure — add values not yet held (by form + norm); `overflow` when the chat's limit dropped any.
const mergeValues = (held, fresh) => {
  const known = new Set(held.map((v) => `${v.kind}\n${v.norm}`));
  const all = [...held, ...fresh.filter((v) => !known.has(`${v.kind}\n${v.norm}`))];
  return { values: all.slice(-VALUES_KEPT), overflow: all.length > VALUES_KEPT };
};

// impure — fold fresh planted values into a chat's record, marking it when any could not be kept.
const taint = (state, fresh, untraced) => {
  const merged = mergeValues(state.tainted, fresh);
  state.tainted = merged.values;
  state.untraced ??= untraced ?? (merged.overflow ? fresh.at(-1)?.source ?? 'content' : null);
};

const linesOf = (text) => String(text || '').split('\n').filter((line) => line.trim());

/**
 * Record the operator's own words for this chat — the only words that can
 * exempt a value. A visitor's (declared speaker), a watch's or wake's, and a
 * team brief (another being's words) are not the operator's. impure.
 * @param {object} connection
 * @param {string} thought the turn's message
 * @param {{visitor?: boolean, origin?: ?string}} [from]
 */
export const noteOperatorWords = (connection, thought, { visitor = false, origin = null } = {}) => {
  if (!connection || visitor || origin || connection._teamMember || typeof thought !== 'string') return;
  const state = stateOf(connection);
  state.operator = [...state.operator, ...linesOf(thought)].slice(-OPERATOR_LINES_KEPT);
};

/**
 * Taint what a round's results carry from injected text. impure (the
 * connection's record); returns the results untouched.
 * @param {object} connection
 * @param {Array<{tool: string, content?: string}>} results
 */
export const noteTaintedResults = (connection, results) => {
  const reads = (Array.isArray(results) ? results : [])
    .filter((r) => typeof r?.content === 'string' && r.content)
    .map((r) => plantedIn(r.content, r.tool));
  const fresh = reads.flatMap((r) => r.values);
  const untraced = reads.find((r) => r.untraced)?.untraced ?? null;
  if (fresh.length > 0 || untraced) taint(stateOf(connection), fresh, untraced);
  return results;
};

/**
 * Has this chat read planted values? A chat that has does not message another
 * chat on its own (chat/send, audit P6-41): its words would carry the plant
 * past the other chat's gate in a spelling no trace follows.
 * @param {object} connection
 * @returns {boolean}
 */
export const holdsTaint = (connection) => {
  const state = connection?._injectedValues?.get(sessionKey(connection));
  return (state?.tainted.length ?? 0) > 0 || Boolean(state?.untraced);
};

/**
 * A chat link's words are a housemate's, never the operator's (audit P6-41):
 * every traceable value they carry is tainted in the chat that receives them,
 * so an act there on an account, address or link the other chat named is held
 * unless this chat's own operator names it too. impure (the connection's record).
 * @param {object} connection the receiving chat
 * @param {string} body the link's words
 */
export const noteLinkWords = (connection, body) => {
  const read = tracedValues(body);
  const fresh = read.values.map((v) => ({ ...v, source: 'chat link' }));
  if (fresh.length === 0) return;
  taint(stateOf(connection), fresh, read.overflow ? 'chat link' : null);
};

// The seated caller tail is read once per tail (it is fixed for the turn).
const tailReads = new WeakMap();

// pure (memoised) — the sender's transcript: what its tool results planted,
// and its own later words (the operator's, as the turn's opening is).
const tailRead = (tail) => {
  if (!Array.isArray(tail) || tail.length === 0) return { tainted: [], operator: [], untraced: null };
  if (!tailReads.has(tail)) {
    const calls = new Map(tail.filter((m) => m?.role === 'assistant').flatMap((m) => m.tool_calls ?? [])
      .map((c) => [c.id, String(c.function?.name ?? 'a tool').replace(/^caller__/, 'caller/')]));
    const state = { tainted: [], untraced: null };
    for (const m of tail.filter((entry) => entry?.role === 'tool' && typeof entry.content === 'string')) {
      const read = plantedIn(m.content, calls.get(m.tool_call_id) || 'caller');
      taint(state, read.values, read.untraced);
    }
    tailReads.set(tail, { ...state, operator: tail.filter((m) => m?.role === 'user').flatMap((m) => linesOf(m.content)) });
  }
  return tailReads.get(tail);
};

/** pure — the refusal a held act settles as. */
export const injectedValueRefusal = (act, planted) => ({
  tool: `${act?.server ?? 'unknown'}/${act?.toolName ?? 'unknown'}`,
  status: 'denied',
  error: 'Held for your operator: this act carries a value from instructions planted in content you read ('
    + planted.map((v) => `${KIND_WORDS[v.kind]} ${v.raw}, ${v.source === 'chat link' ? 'named by another chat\'s link' : `planted in the ${v.source} result`}`).join('; ')
    + '). Ask your operator.',
});

/** pure — the refusal of an act held because the chat read more planted values than can be traced. */
export const untracedRefusal = (act, source) => ({
  tool: `${act?.server ?? 'unknown'}/${act?.toolName ?? 'unknown'}`,
  status: 'denied',
  error: `Held for your operator: content you read (${source === 'chat link' ? 'another chat\'s link' : `the ${source} result`}) carried planted instructions with too many values to trace, `
    + 'so an act that names an account, address, link, number or password your operator has not named themselves is not run. Ask your operator.',
});

// pure — in a chat that could not trace everything it read: the values this act's arguments carry
// that the operator never named (or `true` when the arguments themselves hold too many to read).
const unnamedIn = (args, operator) => {
  const carried = tracedValues(argStrings(args).join('\n'));
  return carried.overflow || plantedValuesIn(args, carried.values, operator).length > 0;
};

/**
 * Split a round's acts into those that run and those HELD for carrying a
 * planted value. Reads the connection; writes nothing. With nothing tainted
 * every act passes, byte-identical. In a chat that read more planted values
 * than are kept, an act carrying any value the operator never named is held too.
 * @returns {{allowed: Array, refused: Array<{act: object, result: object, planted: Array}>}}
 */
export const injectedValueSplit = (connection, acts) => {
  const own = connection?._injectedValues?.get(sessionKey(connection)) ?? { tainted: [], operator: [], untraced: null };
  const tail = tailRead(connection?._callerTail);
  const merged = mergeValues(own.tainted, tail.tainted);
  const tainted = merged.values;
  const untraced = own.untraced ?? tail.untraced ?? (merged.overflow ? 'caller' : null);
  if (tainted.length === 0 && !untraced) return { allowed: acts, refused: [] };
  const operator = [...own.operator, ...tail.operator];
  const allowed = [];
  const refused = [];
  for (const act of acts) {
    // A question to the being's own operator goes nowhere outside: holding it left the being unable even
    // to ask about the hold ([…], 2026-11-06). The same names operator-ask.js isAskTool reads.
    if (ASKS_OPERATOR(act)) { allowed.push(act); continue; }
    const planted = plantedValuesIn(act?.args ?? {}, tainted, operator);
    if (planted.length > 0) refused.push({ act, result: injectedValueRefusal(act, planted), planted });
    else if (untraced && unnamedIn(act?.args ?? {}, operator)) refused.push({ act, result: untracedRefusal(act, untraced), planted: [] });
    else allowed.push(act);
  }
  return { allowed, refused };
};
