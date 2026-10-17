// live-markdown.js — the live speech view-model: what the eye should see
// WHILE a turn is still arriving.
//
// The settle path reparses the whole segment as Markdown once per settle.
// The live path must never pay that per frame — but raw `**markers**` on
// screen for an entire stream read as broken, not fast (Design note, 2026-07-28:
// […]). The compromise, all pure:
//
//   splitStablePrefix — block-level settle DURING the stream. Text up to the
//   last completed block boundary (blank line, fence-aware) is stable: it
//   renders through the real <Markdown> (memoized by the caller, so it
//   reparses once per block close, never per frame).
//
//   tokenizeInline — the still-open tail gets lightweight inline formatting:
//   only CLOSED spans (`**…**`, `*…*`, `_…_`, `` `…` ``, `~~…~~`) become
//   elements; an unclosed marker stays literal and self-corrects as the
//   stream completes it. Linear scan, no regex backtracking, O(visible).
//
// The settled render at turn end is unchanged — full <Markdown> either way.

/**
 * Split visible text into a stable closed prefix (completed blocks) and the
 * open tail. A block closes at a blank line OUTSIDE a fenced code block.
 * Pure.
 * @param {string} text
 * @returns {{ closed: string, open: string }}
 */
export const splitStablePrefix = (text) => {
  let inFence = false;
  let lastBoundary = -1; // index just past the most recent blank line
  let lineStart = 0;
  while (lineStart < text.length) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd);
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    if (!inFence && line.trim() === '') lastBoundary = nl === -1 ? text.length : nl + 1;
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  return lastBoundary === -1
    ? { closed: '', open: text }
    : { closed: text.slice(0, lastBoundary), open: text.slice(lastBoundary) };
};

// Inline marker table. `code` swallows its content literally (no nesting);
// the others render their content as plain text inside the element — the
// tail is transient, so nested emphasis is the settle render's job, not ours.
const MARKERS = Object.freeze([
  Object.freeze({ open: '`', close: '`', kind: 'code' }),
  Object.freeze({ open: '**', close: '**', kind: 'bold' }),
  Object.freeze({ open: '~~', close: '~~', kind: 'strike' }),
  Object.freeze({ open: '*', close: '*', kind: 'italic' }),
  Object.freeze({ open: '_', close: '_', kind: 'italic', wordBoundary: true }),
]);

const isAlnum = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

/**
 * Tokenize the open tail into inline spans. Only CLOSED marker pairs
 * produce a styled span; anything unclosed stays literal text. Pure.
 * @param {string} text
 * @returns {Array<{ kind: 'text'|'bold'|'italic'|'code'|'strike', text: string }>}
 */
export const tokenizeInline = (text) => {
  const spans = [];
  let buffer = '';
  const flush = () => {
    if (buffer) spans.push({ kind: 'text', text: buffer });
    buffer = '';
  };

  let i = 0;
  while (i < text.length) {
    let matched = null;
    for (const m of MARKERS) {
      if (!text.startsWith(m.open, i)) continue;
      if (m.wordBoundary && isAlnum(text[i - 1])) continue; // snake_case is not emphasis
      const contentStart = i + m.open.length;
      const closeAt = text.indexOf(m.close, contentStart);
      if (closeAt === -1 || closeAt === contentStart) continue; // unclosed or empty — literal
      if (m.wordBoundary && isAlnum(text[closeAt + m.close.length])) continue;
      matched = { kind: m.kind, content: text.slice(contentStart, closeAt), end: closeAt + m.close.length };
      break;
    }
    if (matched) {
      flush();
      spans.push({ kind: matched.kind, text: matched.content });
      i = matched.end;
    } else {
      buffer += text[i];
      i += 1;
    }
  }
  flush();
  return spans;
};

/**
 * The live view-model for one frame of the reveal: a closed Markdown prefix
 * plus the inline-tokenized open tail. Pure.
 * @param {string} shown - the currently visible slice (text.slice(0, visible))
 * @returns {{ closed: string, spans: Array<{ kind: string, text: string }> }}
 */
export const liveSpeechView = (shown) => {
  const { closed, open } = splitStablePrefix(shown);
  return Object.freeze({ closed, spans: Object.freeze(tokenizeInline(open)) });
};
