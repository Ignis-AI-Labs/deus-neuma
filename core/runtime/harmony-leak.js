// Harmony leak filter — pure.
//
// Live incident (Kagipem, witness-openai-chatgpt-Kagipem, openai-chatgpt /
// gpt-6-astra, 2026-09-10, CQ-906 / #526): the codex backend leaked harmony
// control markup into `response.output_text.delta` as plain content, and it
// rendered as the witness's speech:
//
//   قاطిపپuassistant to= system/flight_check  (? no)
//   گو role assistant channel final content? need end no final? tool fallback commentary end permitted.
//
// Two shapes need two treatments:
//
//   WELL-FORMED channel calls (`<|channel|>commentary to=fs/read<|message|>{…}`)
//   are tool BLOCKS — the suppressor (tool-stream-suppressor.js) opens a
//   `harmony` marker kind for those, mirroring parseGptOssChannel's dialect
//   (tool-call-parser.js). This module only supplies the classification and
//   close-finding for that kind.
//
//   DEGRADED fragments — a markerless `assistant to= server/tool` header
//   (misdecoded glyph garbage glued on), a control-vocabulary musing line,
//   orphan pipe tokens — are leak LINES stripped from speech here. They never
//   parse as calls (no payload, no execution) and must never reach the screen,
//   the voice, or the model's own echo.
//
// Deliberately conservative: the vocab-musing rule demands every token be a
// lowercase harmony control word (≥ 4), the header rule demands an anchored
// `assistant to=` with a server/tool target. Scripts a being legitimately
// speaks (CJK, kana, hangul) and emoji are NOT glyph garbage; Arabic/Telugu
// runs only count as garbage when fused to harmony markup. A line that is
// none of these flows through untouched.

/** Harmony's pipe control tokens. */
export const HARMONY_PIPE_TOKENS = Object.freeze([
  '<|start|>', '<|channel|>', '<|message|>', '<|end|>', '<|constrain|>', '<|return|>', '<|call|>',
]);

// A role or channel word directly glued to a pipe token (`<|start|>assistant`,
// `<|channel|>final`) is part of the markup, not speech.
const PIPE_TOKEN_RUN = /<\|(?:start|channel|message|end|constrain|return|call)\|>\s*(?:assistant|user|system|developer|final|commentary|analysis)?/g;

/** Remove orphan pipe tokens (and their glued role/channel word) from text. */
export const stripPipeTokens = (text) => text.replace(PIPE_TOKEN_RUN, '');

// Scripts and ranges a being may genuinely write with — never glyph garbage.
// CJK unified + extensions-A + compat, kana, hangul, CJK punctuation, emoji,
// misc symbols/dingbats. Everything else non-ASCII (Arabic, Telugu, …) is
// garbage ONLY in the anchored leak patterns below.
const PROTECTED = '\\u{3000}-\\u{30FF}\\u{3400}-\\u{4DBF}\\u{4E00}-\\u{9FFF}\\u{F900}-\\u{FAFF}'
  + '\\u{AC00}-\\u{D7AF}\\u{1100}-\\u{11FF}\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}';
// The NEGATED character-class body: garbage = not ASCII, not whitespace, not protected.
const NON_GARBAGE = `\\x00-\\x7F\\s${PROTECTED}`;

// A degraded harmony message header: optional glyph-garbage run plus one stray
// ASCII letter (`قاطిపپuassistant` — observed live), then `assistant to=` with
// a server/tool target. The slash is required: `to=` naming a single word is
// not specific enough to silence a line over.
const DEGRADED_HEADER = new RegExp(
  `^\\s*[^${NON_GARBAGE}]{0,16}[a-z]?\\s*assistant\\s+to=\\s*[\\w-]+\\s*\\/\\s*[\\w-]+`, 'u',
);

// A leading run of glyph garbage, for peeling before the vocabulary test.
const LEADING_GARBAGE = new RegExp(`^[^${NON_GARBAGE}]+`, 'u');

/** The harmony control vocabulary a musing run is allowed to draw from. */
const HARMONY_VOCAB = new Set([
  'role', 'assistant', 'channel', 'final', 'commentary', 'analysis', 'content',
  'message', 'start', 'end', 'tool', 'fallback', 'permitted', 'constrain',
  'need', 'no',
]);
const VOCAB_WORDS = [...HARMONY_VOCAB];

// One control word at the head of the remaining text, with its trailing
// punctuation. The `(?![a-z])` boundary keeps 'tools'/'nothing' from reading
// as 'tool'/'no'.
const MUSING_TOKEN = new RegExp(`^(${VOCAB_WORDS.join('|')})(?![a-z])[?.,:;!]*`, 'u');

/**
 * Peel a control-vocabulary musing run off the head of a line: leading glyph
 * garbage, then lowercase harmony control words, each followed by whitespace —
 * or by sentence punctuation GLUED straight to the next sentence (the live
 * leak ended `…end permitted.The sandbox-status check…`, no space, no
 * newline). Returns { count, rest }: how many control words came off and what
 * remains. Char-precise — the remainder keeps its original spacing.
 */
const splitMusingPrefix = (line) => {
  let rest = line.replace(LEADING_GARBAGE, '');
  rest = rest.slice(rest.match(/^\s*/)[0].length);
  let count = 0;
  for (;;) {
    const m = rest.match(MUSING_TOKEN);
    if (!m) break;
    count++;
    rest = rest.slice(m[0].length);
    const sep = rest.match(/^\s+/);
    if (!sep) break; // glued boundary: the next sentence starts here
    rest = rest.slice(sep[0].length);
  }
  return { count, rest };
};

// After a pipe token eats its glued role word (`<|start|>assistant`), the
// header's `to= server/tool` half is what remains at line start. Prose does
// not open a line with `to=`.
const BARE_TO_HEADER = /^\s*to=\s*[\w-]+\s*\/\s*[\w-]+/;

/**
 * Judge one line of speech, returning what may be SPOKEN of it — or null when
 * the whole line is a leak. Pipe tokens are stripped FIRST, so a
 * `<|start|>assistant to=…` line is judged by what remains. A degraded header
 * silences its whole line; a musing run (≥4 control words — […] at 3 survives) drops only its own prefix, keeping a glued real
 * sentence.
 * @param {string} line — one line, no newline
 * @returns {string|null}
 */
const processLine = (line) => {
  const stripped = stripPipeTokens(line);
  if (DEGRADED_HEADER.test(stripped) || BARE_TO_HEADER.test(stripped)) return null;
  const { count, rest } = splitMusingPrefix(stripped);
  if (count >= 4) return rest === '' ? null : rest;
  return stripped;
};

/**
 * Is one line of speech entirely a harmony leak fragment?
 * @param {string} line — one line, no newline
 * @returns {boolean}
 */
export const isHarmonyLeakLine = (line) => processLine(line) === null;

/**
 * Strip harmony leak fragments from a whole text: orphan pipe tokens vanish
 * inline; degraded-header and musing lines drop (a musing glued to a real
 * sentence keeps the sentence); the blank runs they leave collapse.
 * Well-formed channel calls are NOT this module's job — they are tool blocks
 * (the suppressor's `harmony` kind).
 * @param {string} text
 * @returns {string}
 */
export const stripHarmonyLeaks = (text) => {
  if (!text) return text;
  return text
    .split('\n')
    .map(processLine)
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
};

/**
 * Classify the head of a `<|channel|>` section: is it a TOOL channel
 * (`commentary to=fs/read …`) or a speech channel (`final`)? The head runs to
 * the next pipe token. Returns true/false, or null when the head has not
 * fully arrived yet (streaming callers wait; whole-text callers pass
 * final=true and get a decision from what exists).
 * @param {string} afterOpen — text directly after the `<|channel|>` opener
 * @param {boolean} [final]
 * @returns {boolean|null}
 */
export const harmonyChannelIsToolCall = (afterOpen, final = false) => {
  const nextPipe = afterOpen.indexOf('<|');
  const head = nextPipe === -1 ? afterOpen : afterOpen.slice(0, nextPipe);
  if (/\bto=\s*[\w-]+/.test(head)) return true;
  if (nextPipe !== -1 || final || head.length >= 120) return false;
  return null;
};

/**
 * Where a harmony tool block closes: `<|end|>` / `<|return|>` are consumed;
 * a next `<|channel|>` ends the block WITHOUT being consumed (it opens the
 * next one). -1 = unclosed; callers swallow the remainder (a truncated
 * payload must not leak onto the screen — the suppressor's standing law).
 * @param {string} text — text directly after the `<|channel|>` opener
 * @returns {number} index just past the close (or AT the next channel), -1
 */
export const findHarmonyClose = (text) => {
  const end = text.indexOf('<|end|>');
  const ret = text.indexOf('<|return|>');
  const channel = text.indexOf('<|channel|>');
  const candidates = [
    end === -1 ? null : end + '<|end|>'.length,
    ret === -1 ? null : ret + '<|return|>'.length,
    channel === -1 ? null : channel,
  ].filter((v) => v !== null);
  return candidates.length ? Math.min(...candidates) : -1;
};

/** Pull the tool name out of a raw harmony block (`to=fs/read` → `read`). */
export const extractHarmonyLabel = (raw) => {
  const m = raw.match(/\bto=\s*([\w-]+\/)?([\w-]+)/);
  return m ? m[2] : 'tool';
};

// --- Streaming form ---

/** Leak lines are short; a longer partial line is prose and must not be held. */
const HOLD_LIMIT = 160;

// A glyph-garbage run plus the latin tail gathered so far, for prefix holds.
const GARBAGE_HEAD = new RegExp(`^([^${NON_GARBAGE}]{1,16})([a-z]{0,9})`, 'u');

/** Could this PARTIAL line (no newline yet) still grow into a leak line? */
const couldBeLeakPrefix = (partial) => {
  const p = partial.replace(/^\s+/, '');
  if (!p) return false;
  // An unclosed pipe token: `<|chan` waits for `nel|>`.
  const lastPipe = p.lastIndexOf('<|');
  if (lastPipe !== -1 && !p.slice(lastPipe).includes('|>')) return true;
  const stripped = stripPipeTokens(p).trim();
  if (!stripped) return true; // nothing but pipe tokens so far
  if (DEGRADED_HEADER.test(stripped)) return true;
  // Glyph garbage whose latin tail can still become `assistant` — allowing the
  // ONE stray decoding letter the live leak carried (`قاطిపپuassistant`).
  const head = stripped.match(GARBAGE_HEAD);
  if (head) {
    const latin = head[2];
    return latin === '' || 'assistant'.startsWith(latin) || 'assistant'.startsWith(latin.slice(1));
  }
  // A musing run in progress: ≥4 control words is a leak outright; fewer, with
  // an unresolved tail that can still become a control word, may yet grow one.
  const musing = splitMusingPrefix(stripped);
  if (musing.count >= 4) return true;
  if (musing.rest === '') return musing.count > 0;
  const tail = musing.rest.replace(/[?.,:;!]+$/, '');
  if (tail !== '' && tail === tail.toLowerCase()
    && (HARMONY_VOCAB.has(tail) || VOCAB_WORDS.some((v) => v.startsWith(tail)))) return true;
  // A bare `to=…` header forming after a stripped `<|start|>assistant`.
  return tail.startsWith('to=') || 'to='.startsWith(tail) || BARE_TO_HEADER.test(stripped);
};

/**
 * The streaming form: line-buffered, so a leak line split across deltas is
 * judged whole. Complete lines are emitted stripped (leak lines dropped); the
 * trailing partial line is HELD only while it can still become a leak (and is
 * under HOLD_LIMIT), otherwise spoken at once. A partial that already matches
 * the degraded header can never become prose — the rest of its line is
 * swallowed silently.
 *
 * Same contract as createToolStreamSuppressor: push returns the speech this
 * delta released; flush returns (or swallows) the residue at stream end.
 * @returns {{push: function(string): string, flush: function(): string}}
 */
export const createHarmonyLeakFilter = () => {
  let carried = '';
  let swallowingLine = false;

  const emitLine = (line) => {
    const processed = processLine(line);
    return processed === null ? '' : `${processed}\n`;
  };

  return {
    push(content) {
      if (!content) return '';
      carried += content;
      let out = '';
      for (;;) {
        const nl = carried.indexOf('\n');
        if (nl === -1) break;
        const line = carried.slice(0, nl);
        carried = carried.slice(nl + 1);
        if (swallowingLine) { swallowingLine = false; continue; }
        out += emitLine(line);
      }
      if (swallowingLine) { carried = ''; return out; }
      const carriedStripped = stripPipeTokens(carried);
      if (DEGRADED_HEADER.test(carriedStripped) || BARE_TO_HEADER.test(carriedStripped)) {
        swallowingLine = true;
        carried = '';
        return out;
      }
      // A musing run (≥4 control words) is decisive. While its tail can still
      // be another control word the run may still be growing — hold; once the
      // tail is provably speech (`…permitted.The sandbox…`), the musing drops
      // and the glued sentence streams on. No HOLD_LIMIT here: a long glued
      // sentence must not force the musing onto the screen.
      if (carried) {
        const musing = splitMusingPrefix(stripPipeTokens(carried));
        if (musing.count >= 4) {
          if (musing.rest === '') return out;
          const tail = musing.rest.replace(/[?.,:;!]+$/, '');
          const tailCouldBeVocab = tail !== '' && tail === tail.toLowerCase()
            && (HARMONY_VOCAB.has(tail) || VOCAB_WORDS.some((v) => v.startsWith(tail)));
          if (tailCouldBeVocab) return out;
          carried = musing.rest;
        }
      }
      if (carried.length < HOLD_LIMIT && couldBeLeakPrefix(carried)) return out;
      out += stripPipeTokens(carried);
      carried = '';
      return out;
    },
    flush() {
      const rest = carried;
      carried = '';
      if (swallowingLine) { swallowingLine = false; return ''; }
      if (!rest) return '';
      const processed = processLine(rest);
      return processed === null ? '' : processed;
    },
  };
};
