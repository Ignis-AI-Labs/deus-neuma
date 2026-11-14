/**
 * CALLER TOOLS — tools the SENDER holds, handed in with the task.
 *
 * Design note, 2026-09-29: […] A benchmark (BFCL, AgentDojo, AgentThreatBench), an IDE
 * plugin or any app speaking the OpenAI function-calling contract hands the
 * model ITS OWN tools. The being sees them beside its own, under the `caller`
 * server, and calls them the same way. A caller tool never runs here: the
 * call is handed back to the sender, the turn ends, and the sender answers
 * with the result in the next request's transcript, which is seated natively
 * so the being picks up exactly where it stopped.
 *
 * Pure, except `processRoundActs`, which runs the being's own acts.
 */

import { closedBookSplit } from './closed-book.js';
import { selfCheckSplit } from './self-check/self-check-sitting.js';
import { sanitizeImages } from './attachment-store.js';
import { RESULTS_FOLLOW_UP } from './tool-exchange.js';
import { toolCallKey, heldRepeatResult } from './witness-tool-epochs.js';
import { injectedValueSplit, noteTaintedResults } from './security/injected-value-gate.js';
import { recordHeldActs } from './security/injected-value-record.js';
import { trailEntryOf } from './benchmark-tool-trail.js';

export const CALLER_SERVER = 'caller';

/** The OpenAI function-name law the caller's names must already satisfy. */
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);

/** The line every caller tool carries, so the being knows where its call goes. */
export const CALLER_TOOL_NOTE = '[CALLER TOOL — runs on the sender\'s side: your call goes back to them, '
  + 'and their result arrives as your next message]';

const fail = (error) => Object.freeze({ error });

/**
 * pure — validate the sender's OpenAI tool list. Accepts the chat-completions
 * shape ({type:'function', function:{…}}) and the flat Responses shape.
 * @returns {{tools: Array<{name: string, description: string, parameters: object}>} | {error: string}}
 */
export const normalizeCallerTools = (tools) => {
  if (tools === undefined || tools === null) return Object.freeze({ tools: [] });
  if (!Array.isArray(tools)) return fail('caller tools must be an array of function definitions');
  const out = [];
  for (const tool of tools) {
    const fn = tool?.type === 'function' && tool.function ? tool.function : tool;
    if (tool?.type !== undefined && tool.type !== 'function') return fail(`caller tool type '${tool.type}' is not supported — functions only`);
    const name = fn?.name;
    if (typeof name !== 'string' || !NAME_RE.test(name)) return fail(`caller tool name '${name}' must match ${NAME_RE}`);
    if (out.some((t) => t.name === name)) return fail(`caller tool '${name}' is defined twice`);
    const parameters = fn.parameters ?? { type: 'object', properties: {} };
    if (typeof parameters !== 'object' || Array.isArray(parameters)) return fail(`caller tool '${name}' parameters must be a JSON schema object`);
    out.push(Object.freeze({ name, description: String(fn.description ?? ''), parameters }));
  }
  return Object.freeze({ tools: Object.freeze(out) });
};

/** pure — the caller's tools as turn-catalog entries: server `caller`, always open. */
export const callerCatalogTools = (connection) => (connection?._callerTools ?? []).map((tool) => Object.freeze({
  server: CALLER_SERVER,
  name: tool.name,
  description: tool.description ? `${tool.description} ${CALLER_TOOL_NOTE}` : CALLER_TOOL_NOTE,
  inputSchema: tool.parameters,
  // The sender owns the act and its consent; nothing executes on this side.
  access: 'allowed',
}));

// pure — a message's words; image parts are collected into `images` where
// the transcript may carry them (the opening user message), refused elsewhere.
const textOf = (content, images = null) => {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (!Array.isArray(content)) throw new Error('message content must be text');
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text' && typeof part.text === 'string') return part.text;
    if (part?.type !== 'image_url') throw new Error('caller transcripts carry text and image_url parts only');
    if (!images) throw new Error('an image part rides only the opening user message of a caller transcript');
    images.push(part.image_url?.url);
    return '';
  }).join('');
};

// pure — the sender's tool_calls in the being's own native vocabulary.
const seatToolCalls = (calls) => calls.map((call, index) => {
  const name = call?.function?.name;
  if (typeof name !== 'string' || !name) throw new Error(`assistant tool call ${index} has no function name`);
  const args = call.function.arguments;
  return {
    id: String(call.id || `caller_call_${index}`),
    type: 'function',
    function: {
      name: `${CALLER_SERVER}__${name}`,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    },
  };
});

/**
 * pure — split the sender's transcript into the sitting's RULES, the turn's
 * THOUGHT and the TAIL. The RULES are the system/developer messages before the
 * first user message: the standing word of whoever set the sitting up, seated
 * as rules (callerRulesFor), never pasted into the thought. Labelled "SYSTEM:"
 * inside the operator's own message, the grounding law read them as an
 * instruction tucked into content and set them aside — CyberSecEval 2's school
 * bot answered the sports question its rule forbade, saying […] (night-101b, 2026-10-29). The THOUGHT is
 * every other message up to and including the first user message (labelled
 * the way the benchmark relay labels a multi-message prompt when there is more
 * than one), and the TAIL is seated natively after it:
 * the being's earlier caller-tool calls, the sender's results, later words.
 * The opening user message's image parts come back as IMAGES — data URIs the
 * turn carries the way the portal carries an operator's attachments, under
 * the same caps (attachment-store.js); present only when there are any.
 * @returns {{thought: string, tail: Array<object>, rules?: string, images?: string[]} | {error: string}}
 */
export const seatCallerTranscript = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) return fail('the caller transcript must be a non-empty array of messages');
  try {
    for (const m of messages) if (!ROLES.has(m?.role)) throw new Error(`unsupported message role: ${m?.role}`);
    const firstUser = messages.findIndex((m) => m.role === 'user');
    if (firstUser < 0) throw new Error('the caller transcript has no user message');
    const lead = messages.slice(0, firstUser).findIndex((m) => m.role !== 'system' && m.role !== 'developer');
    const rulesEnd = lead < 0 ? firstUser : lead;
    const rules = messages.slice(0, rulesEnd).map((m) => textOf(m.content)).filter((t) => t.trim()).join('\n\n');
    const head = messages.slice(rulesEnd, firstUser + 1);
    const images = [];
    const words = head.map((m) => textOf(m.content, m.role === 'user' ? images : null));
    const thought = head.length === 1
      ? words[0]
      : head.map((m, i) => `${m.role.toUpperCase()}:\n${words[i]}`).join('\n\n');
    const sight = images.length > 0 ? sanitizeImages(images) : null;
    if (sight && !sight.ok) throw new Error(`an image part was refused — ${sight.reason}`);
    const tail = messages.slice(firstUser + 1).map((m) => {
      if (m.role === 'tool') {
        if (!m.tool_call_id) throw new Error('a tool message needs the tool_call_id it answers');
        return { role: 'tool', tool_call_id: String(m.tool_call_id), content: textOf(m.content) };
      }
      if (m.role === 'assistant') {
        const calls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0 ? seatToolCalls(m.tool_calls) : null;
        return calls ? { role: 'assistant', content: textOf(m.content) || null, tool_calls: calls } : { role: 'assistant', content: textOf(m.content) };
      }
      // A later system/developer line is the sender's word too — it rides as theirs.
      return { role: 'user', content: m.role === 'user' ? textOf(m.content) : `${m.role.toUpperCase()}:\n${textOf(m.content)}` };
    });
    if (!thought.trim()) throw new Error('the caller transcript opens with an empty prompt');
    return Object.freeze({ thought, tail: Object.freeze(tail), ...(rules ? { rules } : {}), ...(sight ? { images: Object.freeze(sight.images) } : {}) });
  } catch (error) {
    return fail(error.message);
  }
};

/**
 * pure — the turn's closing messages: the user turn, then the sender's seated
 * tail. A tail that ends on the sender's tool results gets the same
 * continuation turn as the being's own tool rounds (RESULTS_FOLLOW_UP), so a
 * result is read under one law whichever side ran the tool (AgentThreatBench,
 * 2026-10-02: the sender's results arrived with no reminder at all).
 */
export const callerTurnTail = (connection, userMessage) => {
  const tail = connection?._callerTail ?? [];
  const endsOnResults = tail.length > 0 && tail[tail.length - 1]?.role === 'tool';
  return [userMessage, ...tail, ...(endsOnResults ? [{ role: 'user', content: RESULTS_FOLLOW_UP }] : [])];
};

/** pure — is this act aimed at one of the sender's tools? */
export const isCallerAct = (connection, act) => {
  const names = (connection?._callerTools ?? []).map((t) => t.name);
  if (names.length === 0) return false;
  if (act?.server === CALLER_SERVER) return true;
  // A bare name the being's own catalog does not carry resolves to the sender.
  return !act?.server && names.includes(act?.toolName)
    && !(connection?._turnCatalog ?? []).some((t) => t.server !== CALLER_SERVER && t.name === act.toolName);
};

/**
 * pure — the sender's last exchange in the seated tail: each call of the last
 * assistant tool round, keyed under the repeat law (toolCallKey), with the
 * result the sender returned for it. Calls without a returned result are left out.
 */
const lastCallerExchange = (tail) => {
  const at = (tail ?? []).findLastIndex((m) => m?.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
  if (at < 0) return new Map();
  const results = new Map(tail.slice(at + 1).filter((m) => m?.role === 'tool').map((m) => [m.tool_call_id, m.content]));
  return new Map(tail[at].tool_calls.filter((c) => results.has(c.id)).map((c) => {
    let args;
    try { args = JSON.parse(c.function?.arguments || '{}'); } catch { args = { raw: c.function?.arguments }; }
    const name = String(c.function?.name ?? '').replace(`${CALLER_SERVER}__`, '');
    const content = results.get(c.id);
    return [toolCallKey({ server: CALLER_SERVER, toolName: name, args }), typeof content === 'string' ? content : JSON.stringify(content)];
  }));
};

/**
 * pure — the round's caller acts that repeat the sender's last exchange
 * exactly, answered under the repeat law the being's own tools already keep
 * (heldRepeatResult) instead of being handed back to run again. AgentDojo,
 * 2026-10-04: the harness sent the same failing send_email 438 times, one
 * sender round each — every round was a fresh turn, so the per-turn guard
 * never saw the repeat (885 messages, 8.5 hours).
 */
export const heldCallerRepeats = (connection, acts) => {
  const last = lastCallerExchange(connection?._callerTail);
  return acts.map((act) => {
    const content = last.get(toolCallKey({ server: CALLER_SERVER, toolName: act.toolName, args: act.args ?? {} }));
    return content === undefined ? null
      : heldRepeatResult({ server: CALLER_SERVER, toolName: act.toolName }, { tool: `${CALLER_SERVER}/${act.toolName}`, status: 'returned', content });
  });
};

/** pure — did this turn hand calls back to the sender? */
export const callerYielded = (connection) => (connection?._callerToolCalls?.length ?? 0) > 0;

/**
 * impure — run a round's acts: the being's own through the real tool loop,
 * the sender's handed back. A round that calls only its own tools (or a turn
 * with no caller tools) is the tool loop exactly as before.
 * @param {Function} processToolCalls the tool loop (passed in; this leaf stays light)
 */
// pure — results put back in the order the model CALLED: the exchange pairs each
// result with its call by position (tool-exchange.js), so a refusal or a held
// repeat listed after the run results answered the wrong tool_call_id.
// `parts` = [[subsetActs, subsetResults], …]; an act with no result (handed to
// the sender) has none here.
const inActOrder = (acts, parts) => {
  const byAct = new Map();
  for (const [subset, results] of parts) subset.forEach((act, i) => { if (results[i]) byAct.set(act, results[i]); });
  return acts.filter((act) => byAct.has(act)).map((act) => byAct.get(act));
};

export const processRoundActs = async (processToolCalls, ws, response, connection, acts, epochs) => {
  // A closed-book sitting refuses anything that is not local (closed-book.js),
  // a self-check anything that is not a read of the being's own world
  // (self-check-sitting.js); outside both, the round runs exactly as before.
  const book = closedBookSplit(connection, acts);
  const check = selfCheckSplit(connection, book.allowed);
  // An act carrying a value planted by injected text is HELD, whichever side
  // would run it (security/injected-value-gate.js).
  const taint = injectedValueSplit(connection, check.allowed);
  const allowed = taint.allowed;
  const refused = [...book.refused, ...check.refused, ...taint.refused];
  const refusals = refused.map(({ result }) => result);
  if (taint.refused.length > 0) {
    connection._taintHeld = (connection._taintHeld ?? 0) + taint.refused.length;
    recordHeldActs(connection, taint.refused); // fire-and-forget: the hold already happened
  }
  const asked = allowed.filter((act) => isCallerAct(connection, act));
  const held = heldCallerRepeats(connection, asked);
  const caller = asked.filter((_, i) => held[i] === null);
  const repeatActs = asked.filter((_, i) => held[i] !== null);
  const repeats = held.filter(Boolean);
  // Calls that never reach the tool loop ride the trail settled, with their
  // target and argument names: a refused fetch's URL is what the audit reads.
  if (connection._benchmarkControls && (refused.length > 0 || repeats.length > 0)) {
    connection._benchmarkToolTrail = [...(connection._benchmarkToolTrail ?? []),
      ...refused.map(({ act, result }) => trailEntryOf(result.tool, act.args, result)),
      ...repeatActs.map((act, i) => trailEntryOf(repeats[i].tool, act.args, repeats[i]))];
  }
  const refusedActs = refused.map(({ act }) => act);
  // What the being's own acts read is looked at for planted values before the next round.
  if (caller.length === 0 && refused.length === 0 && repeats.length === 0) return noteTaintedResults(connection, await processToolCalls(ws, response, connection, acts, epochs));
  // The being's own acts in the round still run: their effects are real.
  const own = allowed.filter((act) => !isCallerAct(connection, act) || (caller.length === 0 && repeats.length === 0));
  const ownResults = own.length > 0 ? noteTaintedResults(connection, await processToolCalls(ws, response, connection, own, epochs)) : [];
  const results = inActOrder(acts, [[own, ownResults], [repeatActs, repeats], [refusedActs, refusals]]);
  if (caller.length === 0) return results;
  const round = connection._callerRounds = (connection._callerRounds ?? 0) + 1;
  connection._callerToolCalls = caller.map((act, index) => Object.freeze({
    id: act.callId || `neuma_caller_${round}_${index}`,
    name: act.toolName,
    arguments: JSON.stringify(act.args ?? {}),
  }));
  if (connection._benchmarkControls) {
    connection._benchmarkToolTrail = [
      ...(connection._benchmarkToolTrail ?? []),
      ...caller.map((act) => trailEntryOf(`${CALLER_SERVER}/${act.toolName}`, act.args, { status: 'yielded' })),
    ];
  }
  return results;
};

/**
 * pure — the tools a CLOSE may offer. A close (speechless, round-cap,
 * speech-loop) asks for the answer with no tools, but when the sender handed
 * tools over, the answer may BE a call to one: SWE-bench, 2026-09-30, 15 of
 * the harness's 70 requests closed speechless and could only reply in prose,
 * so the sender's agent loop lost that step. Only the sender's tools ride a
 * close; the being's own tools never do, since nothing would carry their
 * results back.
 * @param {object} connection
 * @param {Function} nativeToolsForRound the round's native schema thunk
 */
export const callerCloseTools = (connection, nativeToolsForRound) => ((connection?._callerTools?.length ?? 0) > 0
  ? (nativeToolsForRound() ?? []).filter((tool) => String(tool?.function?.name ?? '').startsWith(`${CALLER_SERVER}__`))
  : []);

/** impure — a close that called the sender's tools hands those calls back (never runs them). */
export const yieldCloseCalls = (connection, toolCalls) => {
  const caller = (toolCalls ?? []).filter((act) => isCallerAct(connection, act));
  if (caller.length > 0) return processRoundActs(async () => [], null, '', connection, caller, null);
  return [];
};
