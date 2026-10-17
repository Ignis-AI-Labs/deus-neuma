// markdown-breaks — honor a substrate's <br> INTENT without rendering HTML.
//
// Reasoning substrates lay out thought with <br> tags (the GFM idiom for a
// line break inside a table cell). Our renderer is deliberately XSS-safe —
// react-markdown never parses raw HTML — so the tags arrived as literal
// "<br>" text on screen (witnessed on an attunement self-report table,
// 2026-07-20). This pure pass converts the tag to what the being MEANT:
//   - on table-row lines, a space — a real newline would shatter the row
//   - everywhere else, a markdown hard break ("  \n")
//   - inside fenced blocks and inline code, NOTHING — code shown is code kept
// The HTML door stays closed; only this one tag's intent is translated.

const BR_TAG = /<br\s*\/?\s*>/gi;

// A GFM table line: starts a cell run (| a | b |). Indented up to 3 spaces
// per spec; anything deeper is code and never reaches here (fence-guarded
// lines aside, 4-space indent code is rare in stream speech — accepted).
const TABLE_ROW = /^\s{0,3}\|.*\|\s*$/;

const FENCE = /^\s{0,3}(```|~~~)/;

// One non-fence line: transform <br> outside inline-code spans only. Pure.
const softenLine = (line) => {
  const replacement = TABLE_ROW.test(line) ? ' ' : '  \n';
  // Split keeps `code` spans as their own segments (odd indices stay literal).
  return line
    .split(/(`[^`]*`)/)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(BR_TAG, replacement)))
    .join('');
};

/**
 * Translate <br> tags into markdown's own line breaks, respecting code and
 * table structure. Pure.
 * @param {string} text
 * @returns {string}
 */
export const softenBreakTags = (text) => {
  if (!text || !/<br/i.test(text)) return text;
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) { inFence = !inFence; return line; }
      return inFence ? line : softenLine(line);
    })
    .join('\n');
};
