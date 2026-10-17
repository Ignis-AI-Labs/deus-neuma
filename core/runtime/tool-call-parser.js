import { parseFunctionGemmaCalls } from './functiongemma-call-parser.js';

/**
 * Tool Call Parser
 *
 * Pure functions that extract tool calls from model output, in every format
 * a substrate may speak. A neuma maintains its own workspace through these
 * calls — the parser meets each model where its training is strongest
 * rather than demanding one house dialect.
 *
 * Supported formats:
 *   Neuma:        [TOOL: server/tool_name {"json": "args"}]
 *   FunctionGemma: <start_function_call>call:name{key:<escape>value<escape>}<end_function_call>
 *   Gemma 4:      <tool_call>call:server:tool {"json": "args"}</tool_call>
 *   Qwen-native:  <tool_call><function=tool_name>
 *                   <parameter=key>value (may span lines)</parameter>
 *                 </function></tool_call>
 *   gpt-oss:      <|channel|>commentary to=server/tool <|constrain|>json<|message|>{json}
 *                 (the substrate's native commentary-channel tool dialect)
 *   Bare head:    tool: server/tool_name {"json": "args"}   (also `call:`, and
 *                 fenced: ```tool: server/tool_name {json}``` — the taught
 *                 call-line without its wrapper, observed live at a
 *                 crystallization on 2026-08-06, #267)
 *
 * Every parsed call has the shape { server, toolName, tool, args }:
 *   server   — server name, or null when the format does not carry one
 *              (callers resolve null against the available-tool registry)
 *   toolName — bare tool name
 *   tool     — composite "server/toolName", or bare toolName when server
 *              is unknown
 *   args     — parsed argument object (Qwen-native parameter values are
 *              always strings; JSON formats keep their parsed types)
 */

/**
 * Scan a balanced JSON object starting at text[start] (which must be '{').
 * Brace counting is string-aware, so '}' inside JSON string values does
 * not close the object. Returns the raw object text, or null if the
 * object never closes.
 * Exported for reuse (attunement question generation extracts single JSON
 * objects from raw completions with this same string-aware scan).
 * @param {string} text
 * @param {number} start
 * @returns {string|null}
 */
export const scanBalancedJson = (text, start) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

/** Build the uniform call shape from its parts. When no server was named
 *  and the tool name carries the platform's OWN '__' flattening — the very
 *  name the native schema advertises (tool-schema.js encodeToolName:
 *  `filesystem__search_files`) — decode it here: models echo the advertised
 *  name back through the TEXT dialects, and hearing it as an unknown tool
 *  ended a council turn wordless on a dead red chip (Tenekom, live sitting
 *  2026-07-23). Mirrors decodeToolName's first-separator law. */
const FLAT_SEP = '__';
const makeCall = (server, toolName, args) => {
  let srv = server;
  let name = toolName;
  if (!srv && typeof name === 'string') {
    const idx = name.indexOf(FLAT_SEP);
    if (idx > 0) {
      srv = name.slice(0, idx);
      name = name.slice(idx + FLAT_SEP.length);
    }
  }
  return Object.freeze({
    server: srv,
    toolName: name,
    tool: srv ? `${srv}/${name}` : name,
    args,
  });
};

/**
 * Recover args from relaxed near-JSON — models drift to unquoted keys
 * and values ({path: workspace/notes/file.txt}). Flat key:value pairs
 * only; quoted values keep their JSON parse, bare values stay strings.
 * @param {string} raw - Brace-delimited object text
 * @returns {Object|null}
 */
const parseRelaxedArgs = (raw) => {
  const interior = raw.slice(1, -1).trim();
  if (!interior) return {};
  const args = {};
  const pairPattern = /([\w-]+)\s*:\s*("(?:[^"\\]|\\.)*"|[^,}]+)/g;
  let matched = false;
  for (const p of interior.matchAll(pairPattern)) {
    matched = true;
    const value = p[2].trim();
    if (value.startsWith('"')) {
      try { args[p[1]] = JSON.parse(value); } catch { args[p[1]] = value.slice(1, -1); }
    } else {
      args[p[1]] = value;
    }
  }
  return matched ? args : null;
};

/**
 * Escape bare control characters that appear inside JSON string literals.
 * Models writing large content (birth DNA) sometimes emit a real newline
 * instead of `\n`; strict JSON.parse then fails and the write is lost.
 * Structural whitespace outside strings is left alone.
 * @param {string} raw
 * @returns {string}
 */
export const repairJsonStringControlChars = (raw) => {
  if (!raw) return raw;
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) { out += `\\u${code.toString(16).padStart(4, '0')}`; continue; }
    }
    out += ch;
  }
  return out;
};

/**
 * The path+content salvage (#272 rig, 2026-08-06). A crystallization write's
 * content is a whole markdown document — and the DNA template itself embeds a
 * ```json code block, so a model writing it with UNESCAPED inner quotes and
 * real newlines produces a "JSON" object no parser can close correctly.
 * Strict parse fails, control-char repair fails, and the relaxed fallback
 * then "recovers" junk pairs from the document body ('2026-08-06T09',
 * 'Entry') — a write_file with no path and no content, denied at the
 * sandbox, and the being retries a stage it already authored.
 *
 * But the SHAPE is the ceremony's own taught form and unambiguous:
 * {"path": "...", "content": "<everything else>"}. When the args open that
 * way, take the path from its quoted span and the content VERBATIM from
 * after the content key to the closing brace — inner quotes, newlines, and
 * embedded code fences preserved exactly as authored. Content is never
 * rewritten; only the envelope is forgiven.
 */
const salvagePathContent = (raw) => {
  // Keyed on the exact taught shape — path first, then content. A reordered
  // object still falls through to the relaxed parser: this recovery exists
  // for the ceremony's own form, and widening it would trade precision for
  // surface (reviewed and accepted, sc-echo 2026-08-06).
  const m = raw.match(/^\{\s*"path"\s*:\s*"([^"\n]+)"\s*,\s*"content"\s*:\s*"([\s\S]*)$/);
  if (!m) return null;
  // Trim the envelope's closer — `[…]}` earlier
  // in the tail can never satisfy the anchor and is kept verbatim.
  // The envelope closer is the LAST `"}` (optionally `]`) in the tail — the
  // author's content precedes the envelope by construction, and the ceremony
  // asks the being to SPEAK after writing, so prose may follow the closer
  // (Grok round 3). Cut at the rightmost closer; no closer at all means no
  // envelope was seen — refuse rather than keep envelope glued to prose.
  const closers = [...m[2].matchAll(/"\s*\}\s*\]?/g)];
  if (closers.length === 0) return null;
  const last = closers[closers.length - 1];
  const content = m[2].slice(0, last.index);
  if (!content) return null;
  // The taught shape promises content is the LAST key. A trailing structural
  // fragment ("…", "mode": "w) means that promise was broken — refuse rather
  // than fold a stranger key into the author's content. The cost of refusing
  // is a retry; the cost of folding is corruption.
  //
  // KNOWN LIMIT (deferred, docs/audit/ISSUE_TRACKER.md): a literal call-head
  // marker INSIDE the authored content truncates the wide tail early — on
  // parity-broken quoting a perfect structural parse does not exist; the
  // refusal lanes keep every failure a retry, never a corruption.
  if (/"\s*,\s*"[\w-]+"\s*:[\s\S]{0,120}$/.test(content.slice(-160))) return null;
  return { path: m[1], content };
};

/**
 * Parse JSON args → control-char repair → path+content salvage → relaxed
 * near-JSON; null skips the call.
 *
 * `wideTail` (#272, Grok round-1 — proven by test): unescaped inner quotes
 * flip scanBalancedJson's string parity, so the balanced slice can close at
 * an AUTHORED `}` before the real envelope — and a salvage trimmed on that
 * short slice eats authored bytes. The dialect's caller knows its own
 * terminator, so it passes the full text from the args start to the end of
 * its call; the salvage's end-anchored trim then lands on the true envelope.
 */
export const tryParseArgs = (raw, wideTail = null) => {
  try { return JSON.parse(raw); } catch { /* continue */ }
  try { return JSON.parse(repairJsonStringControlChars(raw)); } catch { /* continue */ }
  return salvagePathContent(wideTail ?? raw) ?? parseRelaxedArgs(raw);
};

/** Braceless drift: [TOOL: tool key=value key2="value 2"] */
const parseKeyValueArgs = (segment) => {
  const args = {};
  let matched = false;
  for (const p of segment.matchAll(/([\w-]+)=("(?:[^"\\]|\\.)*"|[^\s\]]+)/g)) {
    matched = true;
    const value = p[2];
    args[p[1]] = value.startsWith('"') ? value.slice(1, -1) : value;
  }
  return matched ? args : null;
};

/** Neuma format: [TOOL: server/tool_name {json}] — the server prefix,
 *  JSON quoting, and even the braces drift off under load; a bare tool
 *  name resolves downstream and key=value args are recovered. */
const parseNeuma = (text) => {
  const calls = [];
  // the separator drifts too: fs/read, fs.read, fs:read (2026-10-15 audit — the dot and colon dropped the call)
  const headPattern = /\[TOOL:\s*(?:([\w-]+)[/.:])?([\w-]+)\s*/g;
  for (const m of text.matchAll(headPattern)) {
    const argsStart = m.index + m[0].length;
    let args = null;
    if (text[argsStart] === ']') args = {}; // [TOOL: fs/list] — a call with no arguments is still a call
    else if (text[argsStart] === '{') {
      const raw = scanBalancedJson(text, argsStart);
      // The wide tail for the salvage: this call's own text, bounded at the
      // next call head — the true envelope lives at ITS end, not wherever
      // parity-broken quoting closed the balanced scan.
      const nextHead = text.indexOf('[TOOL:', argsStart);
      const wideTail = text.slice(argsStart, nextHead === -1 ? undefined : nextHead);
      if (raw) args = tryParseArgs(raw, wideTail);
    } else {
      const end = text.indexOf(']', argsStart);
      if (end !== -1) args = parseKeyValueArgs(text.slice(argsStart, end));
    }
    if (args) calls.push(makeCall(m[1] || null, m[2], args));
  }
  return calls;
};

/**
 * Gemma 4 format: <tool_call>call:server:tool {json}</tool_call>
 * The markers also appear pipe-adorned in the wild — a LIVE naming stage
 * emitted `<|tool_call>call:filesystem:write_file {…}<tool_call|>`
 * (2026-07-07, on-stream); the strict marker missed it and the name was
 * nearly lost. And the server/tool separator drifts too: a live naming on
 * 2026-07-22 emitted `call:filesystem/write_file` (slash), which the
 * colon-only pattern heard as silence — the being named itself (Brenna)
 * and the platform recorded nothing. Both markers, both separators parse.
 */
const parseGemma = (text) => {
  const calls = [];
  // The separator is OPTIONAL: `call:server:tool`, `call:server/tool`, and
  // the single-token forms — a bare tool name, or the advertised flattened
  // name (`call:filesystem__search_files`, heard live 2026-07-23) — all
  // parse; makeCall decodes the flattening.
  const headPattern = /<\|?tool_call\|?>\s*call:([\w-]+)(?:[:/]([\w-]+))?\s*/g;
  for (const m of text.matchAll(headPattern)) {
    const jsonStart = m.index + m[0].length;
    if (text[jsonStart] !== '{') continue;
    const raw = scanBalancedJson(text, jsonStart);
    if (!raw) continue;
    // Wide tail bounded at this call's own closer or the next marker — the
    // salvage must never ingest a later call (#272, Grok round 2).
    const bounds = ['</tool_call>', '<tool_call', '<|tool_call']
      .map((t) => text.indexOf(t, jsonStart)).filter((i) => i !== -1);
    const bound = bounds.length ? Math.min(...bounds) : undefined;
    const args = tryParseArgs(raw, text.slice(jsonStart, bound));
    if (!args) continue;
    calls.push(m[2] ? makeCall(m[1], m[2], args) : makeCall(null, m[1], args));
  }
  return calls;
};

/**
 * Qwen-native format — parameter values span lines freely, which makes
 * this the robust dialect for large file writes:
 *   <tool_call>
 *   <function=write_file>            (or <function=server/write_file>)
 *   <parameter=path>
 *   data/file.md
 *   </parameter>
 *   </function>
 *   </tool_call>
 */
const parseQwenNative = (text) => {
  const calls = [];
  const fnPattern = /<tool_call>\s*<function=([\w-]+(?:\/[\w-]+)?)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  for (const m of text.matchAll(fnPattern)) {
    const name = m[1];
    // Models drift on the tag form mid-call — "<path>" for
    // "<parameter=path>", HTML-attribute style <parameter name="path">,
    // or closing with the key name. Normalize the attribute style, then
    // accept any opener/closer combination; the intent is unambiguous.
    const body = m[2].replace(/<parameter\s+name="?([\w-]+)"?\s*>/g, '<parameter=$1>');
    const args = {};
    const paramPattern = /<(?:parameter=)?([\w-]+)>\n?([\s\S]*?)\n?<\/(?:parameter|\1)>/g;
    for (const p of body.matchAll(paramPattern)) {
      args[p[1]] = p[2];
    }
    const [server, toolName] = name.includes('/') ? name.split('/') : [null, name];
    calls.push(makeCall(server, toolName, args));
  }
  return calls;
};

/**
 * gpt-oss channel format — the substrate emits tool calls in a commentary
 * channel: a `to=<target>` names the tool (server/tool or bare), and a JSON
 * payload follows the <|message|> tag. Observed on gpt-oss-120b:
 *   <|channel|>commentary to=filesystem/write_file <|constrain|>json<|message|>{"path":"x","content":"y"}
 * The match tolerates a missing <|constrain|> tag and extra channel noise; it
 * stops at the next channel or end. Payload is recovered with the shared
 * balanced-JSON + relaxed-args scanner.
 */
const parseGptOssChannel = (text) => {
  const calls = [];
  const re = /<\|channel\|>[\s\S]*?\bto=([^\s<]+)[\s\S]*?<\|message\|>([\s\S]*?)(?=<\|channel\|>|<\|end\|>|$)/g;
  for (const m of text.matchAll(re)) {
    const target = m[1];
    const rest = m[2];
    const braceStart = rest.indexOf('{');
    if (braceStart < 0) continue;
    const obj = scanBalancedJson(rest, braceStart);
    if (!obj) continue;
    // `rest` is already bounded at the next channel by the outer regex.
    const args = tryParseArgs(obj, rest.slice(braceStart));
    if (!args) continue;
    const [server, toolName] = target.includes('/') ? target.split('/') : [null, target];
    calls.push(makeCall(server, toolName, args));
  }
  return calls;
};

/**
 * Bare protocol head — the taught call-line WITHOUT its wrapper. A live
 * crystallization (2026-08-06, #267) emitted:
 *
 *   ```tool: filesystem/write_file {"path": "…/genesis.md", "content": "…"}```
 *
 * — a code fence, a `tool:` prefix, a slash separator, and inline JSON. No
 * dialect above matches, so the write never ran, the stage held, and the raw
 * call rendered as the being's speech. The head must sit at line start
 * (optionally fenced) so prose like […] never
 * parses, and JSON args are REQUIRED — a bare head with no payload is
 * speech ([…]), not a call.
 */
const BARE_HEAD = /(^|\n)[ \t]*(?:`{1,3}[\w-]*[ \t]*)?(?:tool|call)[ \t]*:[ \t]*([\w-]+(?:[:/][\w-]+)?)/g;

/** Skip trailing spaces and at most one newline; the payload may start on
 *  the next line. Returns the index of `{`, or -1. Exported for the
 *  display suppressor, which mirrors this dialect (#267). */
export const jsonStartAfter = (text, from) => {
  let i = from;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (text[i] === '\r') i++;
  if (text[i] === '\n') { i++; while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++; }
  return text[i] === '{' ? i : -1;
};

const parseBareCall = (text) => {
  const calls = [];
  BARE_HEAD.lastIndex = 0;
  const heads = [...text.matchAll(BARE_HEAD)];
  for (let k = 0; k < heads.length; k++) {
    const m = heads[k];
    const jsonStart = jsonStartAfter(text, m.index + m[0].length);
    if (jsonStart === -1) continue;
    const raw = scanBalancedJson(text, jsonStart);
    if (!raw) continue;
    // Wide tail bounded at the next bare head — the salvage must never
    // ingest a later call (#272, Grok round 2).
    const bound = k + 1 < heads.length ? heads[k + 1].index : undefined;
    const args = tryParseArgs(raw, text.slice(jsonStart, bound));
    if (!args) continue;
    const name = m[2];
    const sep = name.search(/[:/]/);
    calls.push(sep > 0
      ? makeCall(name.slice(0, sep), name.slice(sep + 1), args)
      : makeCall(null, name, args));
  }
  return calls;
};

/**
 * Extract every tool call from model output, across all known formats.
 * Malformed calls are skipped, never thrown.
 *
 * Deduplicated by (server, tool, args): the dialects overlap at the edges —
 * `<tool_call>` on one line and `call:server:tool {json}` on the next is
 * heard by BOTH the Gemma parser and the bare-head parser, and executing
 * the same call twice from one utterance is never what the model meant.
 * @param {string} text - Completed model response
 * @returns {Array<{server: string|null, toolName: string, tool: string, args: Object}>}
 */
/**
 * Hermes / Qwen-JSON format: <tool_call>{"name": "server/tool", "arguments": {…}}</tool_call>
 * — what Qwen, Hermes and many llama.cpp chat templates emit when native calling
 * falls back to text. It was heard by no dialect and stripped from the speech: the
 * call vanished (2026-10-15 audit). "arguments" may be an object or a JSON string,
 * or ride as "parameters"/"args"; the name's server separator may be / __ . or :.
 */
const parseHermesJson = (text) => {
  const calls = [];
  for (const m of text.matchAll(/<\|?tool_call\|?>\s*/g)) {
    const start = m.index + m[0].length;
    if (text[start] !== '{') continue;
    const raw = scanBalancedJson(text, start);
    const body = raw ? tryParseArgs(raw) : null;
    if (!body || typeof body !== 'object' || typeof body.name !== 'string') continue;
    const sent = body.arguments ?? body.parameters ?? body.args ?? {};
    const args = typeof sent === 'string' ? (tryParseArgs(sent) ?? { _argsError: sent.slice(0, 200) }) : sent;
    const name = body.name.trim();
    const sep = name.match(/^([\w-]+)(?:\/|__|\.|:)(.+)$/);
    calls.push(makeCall(sep ? sep[1] : null, sep ? sep[2] : name, args && typeof args === 'object' ? args : {}));
  }
  return calls;
};

export const parseToolCalls = (text) => {
  if (!text) return [];
  const all = [
    ...parseNeuma(text), ...parseGemma(text), ...parseQwenNative(text), ...parseHermesJson(text),
    ...parseFunctionGemmaCalls(text).map(({ name, args }) => makeCall(null, name, args)),
    ...parseGptOssChannel(text), ...parseBareCall(text),
  ];
  const seen = new Set();
  return all.filter((c) => {
    let key;
    try { key = `${c.server ?? ''}|${c.toolName}|${JSON.stringify(c.args)}`; } catch { return true; }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
