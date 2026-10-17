// Sentence-boundary stream transformer.
//
// The LLM stream (`portal-stream.js` `_runLLMStream`) emits text chunks at
// token granularity — sub-word fragments. TTS engines need clause-sized
// chunks (1-30 words) to produce natural prosody. This pure transformer
// buffers chunks and emits complete sentences as they form.
//
// Same wrapper pattern as `createThinkFilter` (`llm-provider.js:250`):
// wrap the downstream `onContent` callback, push raw chunks in, sentences
// come out. Call `.flush()` at stream end to drain the residual buffer.
//
// Boundaries:
//   - strong terminators (. ! ? … 。 ！ ？) followed by space/newline/EOF
//   - paragraph breaks (newline)
//   - soft terminators (, ; : —) only when buffer exceeds minLength
//   - last-resort: nearest space when buffer exceeds maxLength
//
// Known limitation: no abbreviation handling (Mr. / e.g. / i.e. will split).
// Acceptable for TTS — prosody engines smooth these out.

// A terminator ends a sentence only when WHITESPACE OR THE END follows it.
//
// THE STAMMER (Design note, 2026-08-01: […]). This used to end in
// `\s*` — zero or more — so any full stop anywhere was a sentence end, and the
// splitter shredded ordinary speech: […]
// became […] + […], and […] became
// […] + […]. Nine fragments out of four sentences, measured.
// Every fragment is its own synthesis request, and every request arrives with
// ~400 ms of head and ~550 ms of tail silence baked in by the engine — so the
// fragmentation did not merely mangle the prosody, it multiplied the dead air
// by the fragment count. A lookahead costs nothing and kills the whole class:
// decimals, version numbers, file names, IPs, abbreviations.
// Two dialects, because the ambiguity is not the same in both. An ASCII full
// stop is only a sentence end when whitespace or the end of the text follows
// it — that one lookahead is what keeps "portal-stream.js", "24.0" and "v2.0"
// whole. The CJK fullwidth terminators are unambiguous by construction: 。！？
// are never decimal points or filename separators, and CJK does not space its
// sentences, so requiring whitespace there would stop splitting Japanese
// entirely. Whitespace is still CONSUMED when present, so the residual buffer
// never opens with the previous sentence's space.
const STRONG_SOURCE = '(?:[.!?…]["\'’”’\\)\\]]?(?:\\s+|$)|[。！？]["\'’”’\\)\\]]?\\s*)';
// The same rule, walkable — splitBuffer needs every boundary, not just the
// first, so it can take the one that clears the floor.
const STRONG_BOUNDARY_G = new RegExp(STRONG_SOURCE, 'gu');
const SOFT_BOUNDARY = /[,;:—]\s+/u;
const DEFAULT_MIN = 24;
const DEFAULT_MAX = 240;
// The first sentence of a turn only — see createSentenceStream. Short enough
// that a real opening ([…] / […]) leaves at once, long
// enough that a bare "Yes." or an abbreviation's full stop does not become a
// sentence of its own.
const DEFAULT_FIRST_MIN = 10;

// pure — given a buffer, return [head, tail] where head is a complete sentence
// (or the longest acceptable chunk) and tail is the residual. Returns
// [null, buffer] if the buffer is not yet ready to emit.
const splitBuffer = (buffer, minLength, maxLength) => {
  if (buffer.length < minLength) return [null, buffer];

  // Take the first boundary that lands AT OR PAST the floor. The floor used to
  // decide only whether to LOOK, never where to CUT — so with a floor of 24 a
  // buffer of […] still emitted "Sure." as its own synthesis
  // request. Every request costs ~950 ms of engine padding at its seams, so a
  // one-word chunk is close to a second of dead air for one word. Coalescing
  // short sentences into the next one is what the reference pipelines do, for
  // exactly this reason: fewer calls, and prosody that survives the boundary.
  STRONG_BOUNDARY_G.lastIndex = 0;
  let strong;
  while ((strong = STRONG_BOUNDARY_G.exec(buffer)) !== null) {
    const cut = strong.index + strong[0].length;
    if (cut >= minLength) return [buffer.slice(0, cut), buffer.slice(cut)];
  }

  if (buffer.length < maxLength) return [null, buffer];

  // Over maxLength with no strong boundary — fall back to soft, then space.
  const window = buffer.slice(0, maxLength + 1);
  const softMatch = window.match(SOFT_BOUNDARY);
  if (softMatch && softMatch.index !== undefined) {
    const cut = softMatch.index + softMatch[0].length;
    return [buffer.slice(0, cut), buffer.slice(cut)];
  }

  const spaceIdx = window.lastIndexOf(' ');
  if (spaceIdx > minLength) {
    return [buffer.slice(0, spaceIdx), buffer.slice(spaceIdx + 1)];
  }

  // No boundary at all — emit the whole window as a last resort.
  return [buffer.slice(0, maxLength), buffer.slice(maxLength)];
};

/**
 * Wrap a downstream `onSentence` callback with a buffering sentence splitter.
 *
 * @param {(sentence: string) => void} onSentence - receives each emitted sentence
 * @param {Object} [options]
 * @param {number} [options.minLength=24] - minimum chars before a strong boundary will emit
 * @param {number} [options.maxLength=240] - force-split beyond this length
 * @returns {{ push: (chunk: string) => void, flush: () => void, reset: () => void }}
 */
export const createSentenceStream = (onSentence, options = {}) => {
  const minLength = options.minLength ?? DEFAULT_MIN;
  const maxLength = options.maxLength ?? DEFAULT_MAX;
  // THE FIRST SENTENCE LEAVES EARLY (Design note, 2026-08-01: […]).
  //
  // Time-to-first-audio is what a conversation FEELS like: every later
  // sentence is synthesized while the previous one is still playing, so only
  // the first one is ever waited on. Holding […] back for another
  // dozen characters buys prosody nobody is listening for yet and costs the
  // one delay the witness actually experiences. Later sentences keep the full
  // buffer — that is where clause-sized chunks earn their naturalness.
  const firstMinLength = options.firstMinLength ?? DEFAULT_FIRST_MIN;
  let buffer = '';
  let emitted = 0;

  const drain = () => {
    while (true) {
      const floor = emitted === 0 ? firstMinLength : minLength;
      const [head, tail] = splitBuffer(buffer, floor, maxLength);
      if (head === null) break;
      const trimmed = head.trim();
      if (trimmed) { onSentence(trimmed); emitted += 1; }
      buffer = tail;
    }
  };

  return {
    push(chunk) {
      if (!chunk) return;
      buffer += chunk;
      drain();
    },
    flush() {
      const trimmed = buffer.trim();
      if (trimmed) onSentence(trimmed);
      buffer = '';
    },
    reset() {
      buffer = '';
      emitted = 0; // a reset stream is a fresh turn — its first sentence leaves early again
    },
  };
};

/**
 * pure — is there anything here for an engine to SAY?
 *
 * A tail fragment can be punctuation, a stray bullet, an emoji or a lone
 * bracket. Kokoro answers such a request with 500 […]
 * (seen in a real sitting, 2026-08-01) — a wasted round trip, a warn in the
 * log, and with voice-gated display a sentence whose words wait on the error
 * path instead of the audio path. Letters or digits in any script count;
 * punctuation and symbols alone do not.
 *
 * @param {string} text
 * @returns {boolean}
 */
export const hasSpeakableContent = (text) =>
  typeof text === 'string' && /[\p{L}\p{N}]/u.test(text);

// pure — exported for unit tests
export const _splitBuffer = splitBuffer;
