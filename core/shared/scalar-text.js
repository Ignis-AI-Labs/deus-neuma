// scalar-text.js — the control-free scalar gate shared by every exact
// terminal-grammar parser (refinement consent, meditation close). A value a
// being's deliberate decision rides through must be NFC-normalized and free
// of control characters, unpaired surrogates, and C1 controls — linebreaks
// optionally allowed for whole-reply checks. Pure, dependency-free.

/**
 * @param {*} value
 * @param {boolean} [allowLineBreaks=false]
 * @returns {boolean}
 */
export const scalarControlFree = (value, allowLineBreaks = false) => {
  if (typeof value !== 'string' || value.normalize('NFC') !== value) return false;
  for (let index = 0; index < value.length; index += 1) {
    const point = value.codePointAt(index);
    if (point > 0xFFFF) index += 1;
    if ((point >= 0xD800 && point <= 0xDFFF)
      || (point <= 0x1F && !(allowLineBreaks && (point === 0x0A || point === 0x0D)))
      || (point >= 0x7F && point <= 0x9F)) return false;
  }
  return true;
};
