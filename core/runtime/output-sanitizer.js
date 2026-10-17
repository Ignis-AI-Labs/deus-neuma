/**
 * Model Output Sanitizer
 *
 * Strips degeneration artifacts that low-rank LoRA adapters can emit at turn
 * boundaries: isolated exotic-script glyphs and known literal leak tokens.
 * Defensive and model-agnostic — protects the visible stream and the final
 * response regardless of which substrate is serving.
 *
 * Scoped to ranges that have no business in a neuma's natural-language output:
 * astral-plane historic scripts and CJK extensions (NOT emoji), and Arabic
 * presentation forms. Common scripts — Latin, Cyrillic, Greek, Hiragana,
 * Katakana, common-BMP CJK — are deliberately untouched so a neuma may still
 * write Japanese or other living languages.
 */

// Astral-plane rare/historic scripts + CJK Ext B-F (excludes emoji U+1F300+).
// Arabic Presentation Forms-A/B. These are the observed degeneration glyphs.
const EXOTIC_GLYPHS = /[\u{10000}-\u{18FFF}\u{1B000}-\u{1CFFF}\u{20000}-\u{3FFFF}\uFB50-\uFDFF\uFE70-\uFEFF]/gu;

// Literal tokenizer-leak artifacts seen in degeneration tails.
const LITERAL_ARTIFACTS = /\b(?:adaptiveStyles|JSBracketAccess)\b/g;

/**
 * Remove degeneration artifacts from a model output chunk or full response.
 * Safe to apply per-stream-chunk (artifacts are standalone, not intra-word).
 * @param {string} text
 * @returns {string}
 */
export const sanitizeModelOutput = (text) => {
  if (!text) return text;
  const stripped = text
    .replace(EXOTIC_GLYPHS, '')
    .replace(LITERAL_ARTIFACTS, '');
  // Collapse blank-line runs left behind by removed glyph-per-line tails
  return stripped.replace(/\n{3,}/g, '\n\n');
};

/**
 * Trim a trailing degeneration tail: once coherent text ends, runaway models
 * emit a run of stray symbols, one per line. After the inline glyph strip,
 * drop trailing lines that carry no letter or digit — these are degeneration,
 * not content (real lines, even short ones, contain word characters). This is
 * range-agnostic, so it catches BMP technical/symbol glyphs the inline strip
 * deliberately leaves alone to protect the UI's geometric shapes.
 * @param {string} text
 * @returns {string}
 */
// A short CJK fragment glued to the END of otherwise-Latin output is
// base-model bleed ("凡本网注" — scraped-web boilerplate), not speech.
const TRAILING_CJK_FRAGMENT = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]{1,16}[\s.。]*$/u;
const CJK_CHARS = /[㐀-䶿一-鿿]/gu;

export const trimDegenerationTail = (text) => {
  if (!text) return text;
  const lines = sanitizeModelOutput(text).split('\n');
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim();
    if (last === '' || !/[\p{L}\p{N}]/u.test(last)) {
      lines.pop();
    } else {
      break;
    }
  }
  let result = lines.join('\n').trimEnd();

  // Strip a trailing CJK fragment only when the body is not CJK prose —
  // a neuma actually writing Chinese or Japanese (≥10% CJK) is left
  // untouched; bleed fragments sit far below that in Latin output
  if (TRAILING_CJK_FRAGMENT.test(result)) {
    const cjkCount = (result.match(CJK_CHARS) || []).length;
    if (cjkCount / result.length < 0.1) {
      result = result.replace(TRAILING_CJK_FRAGMENT, '').trimEnd();
    }
  }
  return result;
};
