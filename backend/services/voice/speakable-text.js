// speakable-text.js — markdown is for the EYE, not the mouth.
//
// The being writes in markdown because the desk renders markdown. The TTS
// engine does not render anything: it says what it is given, and it says the
// punctuation too.
//
// MEASURED against the real Kokoro sidecar, 2026-08-01 (Founder: […]):
//
//   "That is important."        1092 ms
//   "That is **important**."    3343 ms   ← 3x, all of it spoken asterisks
//   "That is *important*."      1691 ms
//   "## The Result"             1015 ms vs 797 ms plain
//
// So this is not cosmetic: bold text costs three times its own duration and
// the extra is pure noise. This runs on the SPEECH path only — the display
// keeps every character the being wrote, because the markdown is meaningful
// there.
//
// pure — no imports, no IO.

// Fence lines (```js) and horizontal rules (---, ***, ___) carry no words.
const FENCE_LINE = /^\s*(?:```+|~~~+).*$/gm;
const RULE_LINE = /^\s*(?:[-*_]\s*){3,}$/gm;
// Line-leading furniture: headings, blockquotes, and bullet markers. Numbered
// list markers are LEFT ALONE — "1." reads naturally as "one" and carries real
// ordering the listener wants.
const LEADING_MARKER = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+)/gm;
// Images before links, so ![alt](src) does not leave a stray "!".
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
// Emphasis, longest marker first so ** is never eaten as two singles. No
// newline inside: an unclosed marker must not swallow the rest of a reply.
const BOLD_ITALIC = /\*\*\*([^*\n]+)\*\*\*/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const ITALIC = /\*([^*\n]+)\*/g;
const STRIKE = /~~([^~\n]+)~~/g;
// Inline code: the words inside are usually the point ("open `portal`"), the
// backticks never are.
const CODE_SPAN = /`+([^`\n]*)`+/g;
// Whatever emphasis punctuation survived — an unpaired ** at a sentence edge,
// a lone backtick clinging to a word. Dropped rather than spoken.
//
// NARROW ON PURPOSE. A marker is markup when it CLINGS to text or comes in a
// run; a single one standing alone between spaces is arithmetic ("2 * 3"), and
// eating it would change what the being said. Over-stripping corrupts words to
// fix a symbol, which is the worse trade.
const STRAY = /(?<=\S)[*`~]+|[*`~]+(?=\S)|[*`~]{2,}/g;
const SPACES = /[ \t]{2,}/g;

/**
 * pure — the words of a passage, with the markup that is only for the eye
 * removed. Never changes the WORDS: nothing is reordered, substituted or
 * summarised, so what is heard is what was written.
 *
 * UNDERSCORES ARE DELIBERATELY UNTOUCHED. `_text_` is valid markdown emphasis,
 * but in this house's conversations underscores are far more often identifiers
 * — `use_live_voice`, `min_silence_ms` — and stripping those would corrupt the
 * being's actual words to fix a rarer cosmetic problem. Speaking an underscore
 * is a smaller failure than mangling a name.
 *
 * @param {string} text
 * @returns {string}
 */
export const speakableText = (text) => {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  out = out.replace(FENCE_LINE, '');
  out = out.replace(RULE_LINE, '');
  out = out.replace(IMAGE, '$1');
  out = out.replace(LINK, '$1');
  out = out.replace(LEADING_MARKER, '');
  out = out.replace(BOLD_ITALIC, '$1');
  out = out.replace(BOLD, '$1');
  out = out.replace(ITALIC, '$1');
  out = out.replace(STRIKE, '$1');
  out = out.replace(CODE_SPAN, '$1');
  out = out.replace(STRAY, '');
  out = out.replace(SPACES, ' ');
  return out.trim();
};
