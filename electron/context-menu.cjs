// Context-menu template — pure derivation from Chromium's context-menu params.
//
// Chromium underlines misspellings, but Electron shows NO right-click menu
// unless the app builds one — so corrections were flagged yet unreachable.
// This module decides WHAT the menu offers (pure, unit-tested);
// desk-windows.cjs binds the items to webContents actions (impure, thin).

const MAX_SUGGESTIONS = 5;
const MAX_DEFINE_WORDS = 3;
const MAX_DEFINE_CHARS = 40;
// what may sit around a word in a selection without being part of it
const EDGE_RE = /^[^\p{L}]+|[^\p{L}]+$/gu;
const DEFINABLE_RE = /^\p{L}+(?:['\- ]\p{L}+)*$/u;

/**
 * The word (or short phrase — "ad hoc", "a priori") a selection asks to have
 * defined, with the punctuation and quotes around it let go; null when the
 * selection is no word, or more than a few. Pure.
 * @param {string} [selectionText]
 * @returns {string|null}
 */
const defineWordOf = (selectionText) => {
  const word = String(selectionText || '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').replace(EDGE_RE, '');
  if (!word || word.length > MAX_DEFINE_CHARS || word.split(' ').length > MAX_DEFINE_WORDS) return null;
  return DEFINABLE_RE.test(word) ? word : null;
};

/**
 * Declarative menu items for a right-click. Pure.
 * @param {{misspelledWord?: string, dictionarySuggestions?: string[],
 *          isEditable?: boolean, selectionText?: string}} params
 * @returns {Array<{kind: 'suggestion'|'add-to-dictionary'|'define', word: string}
 *         | {kind: 'separator'}
 *         | {kind: 'role', role: 'cut'|'copy'|'paste'|'selectAll'}>}
 */
const buildContextMenuTemplate = (params = {}) => {
  const items = [];

  if (params.misspelledWord) {
    for (const word of (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS)) {
      items.push({ kind: 'suggestion', word });
    }
    // Domain words (neuma, unavis, a being's chosen name…) land here —
    // once added, the substrate's world stops reading as a mistake.
    items.push({ kind: 'add-to-dictionary', word: params.misspelledWord });
    items.push({ kind: 'separator' });
  }

  if (params.isEditable) {
    items.push(
      { kind: 'role', role: 'cut' },
      { kind: 'role', role: 'copy' },
      { kind: 'role', role: 'paste' },
      { kind: 'role', role: 'selectAll' },
    );
  } else if ((params.selectionText || '').trim()) {
    items.push({ kind: 'role', role: 'copy' });
  }

  // A word not understood (Design note, 2026-10-28: […])
  // — never a misspelling: Chromium's corrections above are the help there.
  const word = params.misspelledWord ? null : defineWordOf(params.selectionText);
  if (word) {
    if (params.isEditable) items.push({ kind: 'separator' });
    items.push({ kind: 'define', word });
  }

  // A trailing separator with nothing after it is noise, not structure
  while (items.length && items[items.length - 1].kind === 'separator') items.pop();

  return items;
};

/**
 * The items the NATIVE fallback menu can carry: DEFINE needs the in-page
 * card, so it stays out, and no separator is left dangling. Pure.
 * @param {ReturnType<typeof buildContextMenuTemplate>} items
 */
const nativeItemsOf = (items) => {
  const out = items.filter((item) => item.kind !== 'define');
  while (out.length && out[out.length - 1].kind === 'separator') out.pop();
  return out;
};

module.exports = { buildContextMenuTemplate, defineWordOf, nativeItemsOf, MAX_SUGGESTIONS };
