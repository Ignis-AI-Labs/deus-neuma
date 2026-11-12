/**
 * THE TOOL HUD — what a model holds of its tools on every turn, as little as
 * possible (Design note, 2026-10-14: […]).
 *
 * TWO DOORS, AND THEY NEVER CHANGE. On llama.cpp a model can call only a tool
 * whose full schema is declared on the wire, and the declared list sits at the
 * TOP of the prompt — so every schema added mid-chat re-read the whole chat,
 * which is why whole families (and a being's habits) were pre-loaded at
 * ~2,000-3,600 tokens a message. Now the wire carries `system/tool_search` and
 * `system/call` (plus a sender's own task tools) — always the same, so nothing
 * is ever re-read for a tool and no schema rides a turn that never uses it:
 *
 *   - know the tool → `system/call {tool: "fs/read", args: {...}}`
 *   - not sure → `system/tool_search` answers with the CONTRACT itself (the full
 *     argument schema for an exact id; compact signatures for a family/phrase)
 *
 * A call through the door is unwrapped to the call it names (`unwrapCall`) at
 * the one place every act is executed — so every gate, card, sandbox and
 * journal judges the REAL tool exactly as before. The transcript keeps what the
 * model actually sent (`_wire`), so the conversation it reads back is its own.
 *
 * Pure — every function here is data in, data out.
 */

import { signatureOf } from '../../core/runtime/tool-signature.js';
import { tryParseArgs } from '../../core/runtime/tool-call-parser.js';

export const CALL_ID = 'system/call';

export const CALL_TOOL = Object.freeze({
  server: 'system',
  name: 'call',
  description: 'Call any of your tools by its exact id with its arguments. Learn an unfamiliar tool\'s arguments with system/tool_search first.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      tool: Object.freeze({ type: 'string', description: 'The exact tool id, server/name — e.g. fs/read' }),
      args: Object.freeze({ type: 'object', description: 'That tool\'s own arguments' }),
    }),
    required: Object.freeze(['tool']),
  }),
});

const isCallDoor = (match) => {
  const name = String(match?.tool || '').toLowerCase();
  const bare = String(match?.toolName || '').toLowerCase();
  // `call` with no server is the door too: no other tool is named call — and the
  // joiner drifts (system__call, system.call, system-call, system:call, system_call)
  return name === CALL_ID || ((match?.server === 'system' || !match?.server) && bare === 'call')
    || (!match?.server && /^system(__|[._:-])call$/.test(bare));
};

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A call through the door becomes the call it names. The arguments may ride in
 * `args` or — a model that flattens them — beside `tool` itself, as objects or
 * JSON strings; the name may ride as tool / name / tool_name / id. A door call
 * naming nothing stays the door (labeled system/call; the loop reports it
 * unavailable, honestly — a closed-book audit reads a platform door, not an
 * unknown server, found 2026-10-15 on BigCodeBench).
 * @param {{server?: string, toolName?: string, tool?: string, args?: object, callId?: string}} match
 * @returns {object} the named call, carrying `_wire` (what the model sent)
 */
// a model may send arguments as a JSON string, at either level — read it as sent, with the
// repairs a text call gets (a written document's raw newlines and unescaped quotes, 2026-11-04)
const asObject = (value) => {
  if (plain(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = tryParseArgs(value.trim());
  return plain(parsed) ? parsed : null;
};
const NAME_KEYS = Object.freeze(['tool', 'name', 'tool_name', 'id']);
const FLAT_JOIN = '__'; // tool-schema.js encodeToolName

export const unwrapCall = (match) => {
  if (!isCallDoor(match)) return match;
  const sent = asObject(match.args) || {};
  // arguments that will not read are SAID, never run as {} (portal-tool-loop answers _argsError)
  const unread = typeof match.args === 'string' && !asObject(match.args) ? match.args.slice(0, 200) : null;
  if (unread !== null) return Object.freeze({ ...match, server: 'system', toolName: 'call', tool: CALL_ID, _argsError: unread });
  const nameKey = NAME_KEYS.find((k) => typeof sent[k] === 'string' && sent[k].trim());
  const id = String(nameKey ? sent[nameKey] : '').trim().replace(/^\/+/, '');
  // naming nothing, the call stays the door itself — labeled as the door, never a bare `call`
  if (!id) return Object.freeze({ ...match, server: 'system', toolName: 'call', tool: CALL_ID });
  const { [nameKey]: _named, args: nested, ...flat } = sent;
  const args = asObject(nested) || flat;
  const nestedUnread = typeof nested === 'string' && !asObject(nested) ? nested.slice(0, 200) : null;
  // `server/tool`, or the native function spelling `server__tool` the model
  // reads in its own function list — split as the parser and the native decode
  // split it. Kept whole, `caller__get_all_hotels_in_city` reached no server and
  // was refused as unavailable: 238 wasted rounds, 2026-10-25..11-08 (tool fluency).
  const slash = id.indexOf('/');
  const at = slash > 0 ? slash : id.indexOf(FLAT_JOIN);
  const server = at > 0 ? id.slice(0, at) : null;
  const toolName = at > 0 ? id.slice(at + (slash > 0 ? 1 : FLAT_JOIN.length)) : id;
  // the door naming the door is refused, never peeled again: a second unwrap
  // downstream would run the inner call past every check that judged the door
  if (isCallDoor({ server, toolName, tool: server ? `${server}/${toolName}` : toolName })) {
    return Object.freeze({ ...match, server: 'system', toolName: 'call', tool: CALL_ID, _doorError: true });
  }
  return Object.freeze({
    ...match,
    server,
    toolName,
    tool: server ? `${server}/${toolName}` : toolName,
    args,
    ...(nestedUnread !== null ? { _argsError: nestedUnread } : {}),
    _wire: Object.freeze({ server: 'system', toolName: 'call', args: sent }),
  });
};

/** Unwrap every call of a round. */
export const unwrapCalls = (matches) => (Array.isArray(matches) ? matches.map(unwrapCall) : matches);

/**
 * What tool_search answers for each match: the id, its words, its tier, and —
 * when the search named exactly one tool — its full argument schema; for a
 * broader search, the signature line (the exact contract is one search away).
 * @param {Array<object>} matches
 * @param {boolean} exact the query named a single tool by its id
 */
export const contractsOf = (matches, exact) => matches.map((tool) => ({
  id: `${tool.server}/${tool.name}`,
  description: tool.description,
  access: tool.access,
  ...(exact ? { args: tool.inputSchema ?? null } : { signature: signatureOf(tool.inputSchema) }),
  call: `system/call {"tool": "${tool.server}/${tool.name}", "args": {…}}`,
}));

// pure — Levenshtein distance, small strings only (tool and field names)
export const distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
};

/**
 * What to tell a model that called a tool it does not have — never a bare
 * "unavailable" it can only guess past (BigCodeBench 2026-10-15: coding/run,
 * three times). The same name under another server, else the closest name it
 * holds, and always the door that finds tools. Pure.
 * @param {string} toolName the name it called (no server)
 * @param {Array<{server: string, name: string}>} catalog this turn's tools
 * @param {string|null} [server] the server it named, if any — its real tools are listed
 * @param {Array<{name: string, fieldsForPrompt?: string, descriptionForPrompt?: string}>} [intents] this turn's intent types
 * @returns {string}
 */
export const unknownToolHint = (toolName, catalog, server = null, intents = []) => {
  const name = String(toolName || '').toLowerCase();
  // an act the lane FILES, called as a tool (2026-10-17 flight: an Optio called "dispatch" for staff/dispatch)
  const intent = (Array.isArray(intents) ? intents : []).find((t) => {
    const id = String(t?.name || '').toLowerCase();
    return id === `${String(server || '').toLowerCase()}/${name}` || id.split('/')[1] === name;
  });
  if (intent) {
    return `${intent.name} is not a tool — it is an intent you FILE: write a JSON file into your intents folder (named in your Intents section) `
      + `holding {"type": "${intent.name}"} and its fields ${intent.fieldsForPrompt || ''}. ${intent.descriptionForPrompt || ''}`.trim();
  }
  const tools = (Array.isArray(catalog) ? catalog : []).filter((t) => t?.server && t?.name && t.server !== 'system');
  const family = server ? tools.filter((t) => t.server === server) : [];
  const same = tools.find((t) => t.name.toLowerCase() === name);
  const near = same ? null : tools
    .map((t) => ({ t, d: distance(name, t.name.toLowerCase()) }))
    .filter(({ t, d }) => d <= Math.max(2, Math.floor(t.name.length / 3)) || t.name.toLowerCase().includes(name) || name.includes(t.name.toLowerCase()))
    .sort((x, y) => x.d - y.d)[0]?.t;
  const pick = same || near;
  const inFamily = !pick && family.length ? ` ${server}/ holds: ${family.map((t) => t.name).join(', ')}.` : '';
  return `No tool named ${toolName || '(none)'}.${pick ? ` Did you mean ${pick.server}/${pick.name}?` : ''}${inFamily} `
    + 'system/tool_search {"query": "what you need"} finds the right tool and its arguments.';
};

/**
 * The answer to a call that never dispatches because the door itself refused
 * it: arguments that would not read, or system/call naming system/call. Null
 * for every call that may go on. Pure.
 * @param {object} match an unwrapped call
 * @returns {?object}
 */
export const doorRefusal = (match) => {
  if (match?._argsError !== undefined) return unreadArgsResult(match.tool || match.toolName, match._argsError);
  if (!match?._doorError) return null;
  return Object.freeze({
    tool: CALL_ID,
    status: 'invalid',
    error: 'system/call cannot call system/call, so nothing ran. '
      + 'Send system/call once, naming the tool itself: {"tool": "fs/read", "args": {...}}.',
  });
};

/**
 * What a model hears when its arguments would not read as a JSON object —
 * instead of the call running on {} (2026-10-15 audit). Pure.
 * @param {string} tool the call's id
 * @param {string} raw what it sent (capped)
 */
export const unreadArgsResult = (tool, raw) => Object.freeze({
  tool,
  // 'invalid', never 'error': nothing was dispatched — an audit reads 'error' as "ran and failed"
  status: 'invalid',
  error: `The arguments for ${tool} were not a JSON object, so nothing ran: ${JSON.stringify(String(raw))}. `
    + 'Send the call again with its arguments as one JSON object — inside a string, every quotation mark written \\" and every line break \\n.',
});
