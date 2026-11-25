// typed-text — what dictation may type into another app's window. Pure.
//
// The typist (ydotool, xdotool) presses keys for whatever text it is handed, in whatever window has
// focus. Speech is words; a speech engine's answer is only text, and text can carry keys nobody
// spoke: a line break is Enter, and in a terminal Enter runs the line. An answer of
// […] typed as it came would run a command as the operator (PR600 audit P6-59).
// So what is typed is words on one line: every line break becomes a space, every control character
// (the C0 and C1 sets, Escape and Delete among them) is dropped, and the length is bounded.

/** The most characters one hold types: about ten minutes of speech. */
export const MAX_TYPED_CHARS = 8000;

/**
 * The text as the typist may type it: one line, no control characters, bounded. Pure.
 * @param {unknown} text
 * @returns {string}
 */
export const typeableText = (text) => String(text ?? '')
  .replace(/[\r\n\v\f\t\p{Zl}\p{Zp}]+/gu, ' ')
  .replace(/\p{Cc}/gu, '')
  .replace(/ {2,}/g, ' ')
  .trim()
  .slice(0, MAX_TYPED_CHARS);
