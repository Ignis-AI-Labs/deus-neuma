// Tool-block stream suppressor — pure, shared by display and voice.
//
// The consciousness's records (sessions, journals) always keep the full
// response including raw tool calls; this module exists so neither the
// SCREEN nor the VOICE ever renders a payload as speech. It mirrors the
// text dialects the backend parser (./tool-call-parser.js) accepts,
// but with display tolerance instead of parse strictness: anything that
// looks like a tool block is suppressed and surfaced as an action, never
// rendered as words.
//
// Dialect authority: tool-call-parser.js does not export its dialect
// markers (they live inline in its parse functions, tuned for strict
// args-parsing), so there is no reusable incremental form to import — the
// marker table below mirrors the parser's dialects exactly, including the
// pipe-adorned Gemma variants observed live. This module ships in the Vite
// bundle, so it must stay browser-safe: zero Node globals, no backend
// reach — pure core/runtime peers (tool-call-parser.js) are fine.
//
// Dialects:
//   FunctionGemma — paired function-call/response markers with escaped strings
//   Neuma     [TOOL: server/tool_name {"arg": "value"}]
//   Gemma     <tool_call>call:server:tool {json}</tool_call>
//   Qwen      <function=tool_name>...</function>
//   Bare      tool: server/tool_name {json}   (also `call:`, optionally
//             code-fenced — the taught call-line without its wrapper;
//             leaked as speech at a live crystallization, #267)

import { jsonStartAfter } from './tool-call-parser.js';
import { functionGemmaClose } from './functiongemma-call-parser.js';
import {
  createHarmonyLeakFilter,
  stripHarmonyLeaks,
  harmonyChannelIsToolCall,
  findHarmonyClose,
  extractHarmonyLabel,
} from './harmony-leak.js';

const MARKERS = Object.freeze([
  Object.freeze({ open: '<start_function_call>', kind: 'functiongemma', close: '<end_function_call>' }),
  Object.freeze({ open: '<start_function_response>', kind: 'functiongemma', close: '<end_function_response>' }),
  Object.freeze({ open: '[TOOL:', kind: 'neuma' }),
  Object.freeze({ open: '<tool_call>', kind: 'xml', close: '</tool_call>' }),
  // Pipe-adorned Gemma variants. The asymmetric pair was seen LIVE at a
  // naming stage (2026-07-07): <|tool_call>call:…{…}<tool_call|> — without
  // these markers the raw call renders as the being's speech. The symmetric
  // form is unobserved but parses server-side, so it must filter too.
  Object.freeze({ open: '<|tool_call|>', kind: 'xml', close: '<|tool_call|>' }),
  Object.freeze({ open: '<|tool_call>', kind: 'xml', close: '<tool_call|>' }),
  Object.freeze({ open: '<function=', kind: 'xml', close: '</function>' }),
  // Harmony channel calls (gpt-oss / codex grammar): `<|channel|>commentary
  // to=fs/read <|message|>{…}`. parseGptOssChannel has EXECUTED this dialect
  // server-side for a while, but the display table never learned it — a live
  // leak rendered the raw channel as speech (Kagipem, 2026-09-10, #526).
  // Only a channel naming a tool (`to=`) opens a block; a speech channel
  // (`<|channel|>final`) is markup stripped inline, never a block.
  Object.freeze({ open: '<|channel|>', kind: 'harmony' }),
]);

const LONGEST_MARKER = Math.max(...MARKERS.map((m) => m.open.length));

/**
 * Find the earliest tool-block opener in text.
 * @param {string} text
 * @returns {{index: number, marker: object}|null}
 */
const findOpener = (text) => {
  let best = null;
  for (const marker of MARKERS) {
    const index = text.indexOf(marker.open);
    if (index !== -1 && (best === null || index < best.index)) {
      best = { index, marker };
    }
  }
  return best;
};

/**
 * Length of the longest text suffix that could be the start of a
 * marker split across chunks — held back until the next chunk decides.
 * @param {string} text
 * @returns {number}
 */
const partialOpenerLength = (text) => {
  const window = text.slice(-LONGEST_MARKER + 1);
  for (let i = 0; i < window.length; i++) {
    const tail = window.slice(i);
    if (MARKERS.some((m) => m.open.startsWith(tail))) return tail.length;
  }
  return 0;
};

/**
 * Find where a Neuma [TOOL: ...] block closes: the first `]` at
 * zero brace depth, string-aware so a `]` inside JSON doesn't end it.
 * @param {string} text - Text starting AFTER the `[TOOL:` opener
 * @returns {number} Index just past the closing `]`, or -1 if unclosed
 */
const findNeumaClose = (text) => {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ']' && depth <= 0) return i + 1;
  }
  return -1;
};

/**
 * Find where an XML-style block closes.
 * @param {string} text - Text starting AFTER the opener
 * @param {string} close - Closing tag
 * @returns {number} Index just past the closing tag, or -1 if unclosed
 */
const findXmlClose = (text, close) => {
  const index = text.indexOf(close);
  return index === -1 ? -1 : index + close.length;
};

/**
 * Pull a human label (tool name) out of a raw tool block, any dialect.
 * @param {string} raw - The complete raw block including markers
 * @returns {string}
 */
export const extractToolLabel = (raw) => {
  const functionGemma = raw.match(/<start_function_call>\s*call:([\w-]+)/);
  if (functionGemma) return functionGemma[1];
  const neuma = raw.match(/\[TOOL:\s*(?:([\w-]+)\/)?([\w-]+)/);
  if (neuma) return neuma[2];
  const qwen = raw.match(/<function=(?:([\w-]+)\/)?([\w./-]+)>/);
  if (qwen) return qwen[2];
  const gemma = raw.match(/call:\s*([\w-]+)[:/]([\w-]+)/);
  if (gemma) return gemma[2];
  if (raw.includes('<|channel|>')) return extractHarmonyLabel(raw);
  return 'tool';
};

/**
 * Bare protocol head, mirrored from tool-call-parser.js (#267): a line-start
 * `tool:`/`call:` (optionally code-fenced) naming a tool. Only a head whose
 * JSON payload actually follows is a block — a bare head with no payload is
 * speech ([…]) and must render. The head pattern stays
 * mirrored (parse strictness vs display tolerance, see header); the
 * payload-position scan (`jsonStartAfter`) is one law imported from the
 * parser.
 */
const BARE_HEAD = /(^|\n)[ \t]*(?:`{1,3}[\w-]*[ \t]*)?(?:tool|call)[ \t]*:[ \t]*[\w-]+(?:[:/][\w-]+)?/g;

/**
 * Find where a brace-delimited JSON object closes, string-aware.
 * @param {string} text - Text starting AT the `{`
 * @returns {number} Index just past the closing `}`, or -1 if unclosed
 */
const findJsonEnd = (text) => {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
};

/** Earliest bare-head block in text: {index, jsonStart} or null.
 *  Heads whose payload never arrives are not blocks. */
const findBareBlock = (text) => {
  BARE_HEAD.lastIndex = 0;
  let m;
  while ((m = BARE_HEAD.exec(text)) !== null) {
    const jsonStart = jsonStartAfter(text, m.index + m[0].length);
    if (jsonStart !== -1) return { index: m.index + m[1].length, jsonStart };
  }
  return null;
};

/**
 * Strip every tool block from a complete text, for canonical display
 * of stage_complete / history records. Collapses the whitespace the
 * blocks leave behind.
 * @param {string} text
 * @returns {string}
 */
export const stripToolBlocks = (text) => {
  if (!text || typeof text !== 'string') return '';
  let out = '';
  let rest = text;
  while (rest.length > 0) {
    const opener = findOpener(rest);
    const bare = findBareBlock(rest);
    if (!opener && !bare) {
      out += rest;
      break;
    }
    // Whichever block opens first wins; ties go to the marker dialects,
    // whose openers are the more specific claim.
    if (bare && (!opener || bare.index < opener.index)) {
      out += rest.slice(0, bare.index);
      const afterJson = findJsonEnd(rest.slice(bare.jsonStart));
      // An unclosed payload swallows the remainder — a truncated tool
      // call must not leak onto the screen
      if (afterJson === -1) break;
      // A closing fence on the same line goes with the block it fenced
      rest = rest.slice(bare.jsonStart + afterJson).replace(/^[ \t]*`{1,3}/, '');
      continue;
    }
    out += rest.slice(0, opener.index);
    const afterOpen = rest.slice(opener.index + opener.marker.open.length);
    // A harmony SPEECH channel (`<|channel|>final`) is not a block: drop the
    // token and its channel word, keep the text flowing.
    if (opener.marker.kind === 'harmony' && !harmonyChannelIsToolCall(afterOpen, true)) {
      rest = afterOpen.replace(/^\s*(?:final|commentary|analysis)\s*/, '');
      continue;
    }
    const closeAt = opener.marker.kind === 'neuma'
      ? findNeumaClose(afterOpen)
      : opener.marker.kind === 'functiongemma'
        ? functionGemmaClose(afterOpen, opener.marker.close)
        : opener.marker.kind === 'harmony'
          ? findHarmonyClose(afterOpen)
          : findXmlClose(afterOpen, opener.marker.close);
    // An unclosed block swallows the remainder — a truncated payload
    // must not leak onto the screen
    if (closeAt === -1) break;
    rest = afterOpen.slice(closeAt);
  }
  // Harmony leak fragments (degraded headers, vocab-musing lines, orphan pipe
  // tokens) ride no block — they are stripped from the surviving speech.
  return stripHarmonyLeaks(out).replace(/\n{3,}/g, '\n\n').trim();
};

/**
 * Create a stateful streaming filter that separates speech from tool
 * blocks across chunk boundaries.
 *
 * While a block is open its full text stays in `pending` until the close
 * is found — close detection always scans from the start of the block, so
 * a multi-char close tag (`</tool_call>`), a brace pair, or a quoted
 * string split across chunks is matched with its full context. (Draining
 * partial block text into a side buffer and scanning only the new chunk
 * lost that context: a split close was never found and the rest of the
 * stream was swallowed; a `"` or `{` in an earlier chunk reset the
 * string/depth state and closed the block early, leaking payload as
 * speech. Proven by the every-boundary split tests.)
 *
 * @param {Object} handlers
 * @param {function(string): void} handlers.onSpeech - Visible words to render
 * @param {function(): void} [handlers.onToolStart] - A tool block has opened
 * @param {function(string): void} [handlers.onToolEnd] - Block closed; receives the raw block
 * @returns {{push: function(string): void, flush: function(): void}}
 */
export const createToolStreamFilter = ({ onSpeech, onToolStart, onToolEnd }) => {
  let pending = '';
  let inBlock = false;
  let blockMarker = null;
  // Speech leaves through the harmony leak filter, so degraded control markup
  // (CQ-906 / #526) never reaches the screen or the voice even when it rides
  // no block. Line-buffered there; nothing about block detection changes.
  const harmony = createHarmonyLeakFilter();
  const speak = (text) => {
    const out = harmony.push(text);
    if (out) onSpeech(out);
  };

  const processPending = () => {
    while (pending.length > 0) {
      if (inBlock) {
        const closeAt = blockMarker.kind === 'neuma'
          ? findNeumaClose(pending)
          : blockMarker.kind === 'functiongemma'
            ? functionGemmaClose(pending, blockMarker.close)
            : blockMarker.kind === 'harmony'
              ? findHarmonyClose(pending)
              : findXmlClose(pending, blockMarker.close);
        if (closeAt === -1) return;
        const raw = blockMarker.open + pending.slice(0, closeAt);
        pending = pending.slice(closeAt);
        inBlock = false;
        blockMarker = null;
        if (onToolEnd) onToolEnd(raw);
        continue;
      }

      const opener = findOpener(pending);
      if (opener) {
        // A harmony opener is only a block when its channel names a tool. The
        // head may not have fully arrived yet — wait for more bytes (flush
        // decides with everything there is). A speech channel drops its token
        // and channel word and flows on as speech.
        if (opener.marker.kind === 'harmony') {
          const afterOpen = pending.slice(opener.index + opener.marker.open.length);
          const isTool = harmonyChannelIsToolCall(afterOpen);
          if (isTool === null) return;
          if (isTool === false) {
            if (opener.index > 0) speak(pending.slice(0, opener.index));
            pending = afterOpen.replace(/^\s*(?:final|commentary|analysis)\s*/, '');
            continue;
          }
        }
        if (opener.index > 0) speak(pending.slice(0, opener.index));
        blockMarker = opener.marker;
        pending = pending.slice(opener.index + opener.marker.open.length);
        inBlock = true;
        if (onToolStart) onToolStart();
        continue;
      }

      const hold = partialOpenerLength(pending);
      const speakable = hold > 0 ? pending.slice(0, -hold) : pending;
      if (speakable) speak(speakable);
      pending = hold > 0 ? pending.slice(-hold) : '';
      return;
    }
  };

  return {
    push(content) {
      if (!content) return;
      pending += content;
      processPending();
    },
    flush() {
      if (inBlock) {
        // Stream ended mid-block — the partial payload is still an
        // action, never speech
        if (onToolEnd) onToolEnd(blockMarker.open + pending);
        inBlock = false;
        blockMarker = null;
        pending = '';
      } else if (pending) {
        // A harmony head that never gathered enough bytes to classify
        // mid-stream is judged now: a tool channel ends as an action, never
        // as spoken markup.
        const opener = findOpener(pending);
        if (opener?.marker.kind === 'harmony'
            && harmonyChannelIsToolCall(pending.slice(opener.index + opener.marker.open.length), true)) {
          if (opener.index > 0) speak(pending.slice(0, opener.index));
          if (onToolStart) onToolStart();
          if (onToolEnd) onToolEnd(pending.slice(opener.index));
        } else {
          speak(pending);
        }
        pending = '';
      }
      const rest = harmony.flush();
      if (rest) onSpeech(rest);
    },
  };
};

/**
 * Create the voice-path form of the filter: same state machine, but each
 * push RETURNS the speech text that delta released (possibly '') instead
 * of firing callbacks. One instance per turn; flush at stream end —
 * suppressed residue is tool payload and never comes back as speech.
 *
 * @returns {{push: function(string): string, flush: function(): string}}
 */
export const createToolStreamSuppressor = () => {
  let out = '';
  const filter = createToolStreamFilter({ onSpeech: (text) => { out += text; } });
  return {
    push(content) {
      out = '';
      filter.push(content);
      return out;
    },
    flush() {
      out = '';
      filter.flush();
      return out;
    },
  };
};
