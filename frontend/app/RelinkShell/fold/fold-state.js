// fold-state.js — when a folded section stands open (design-language.md § FOLD). Pure, but for the two storage calls.
//
// A section is a line first: its name, its state, its counts. It stands OPEN when it waits on the operator, and
// folded otherwise; once the operator opens or folds it by hand, their choice is kept for that section.

const KEY = (id) => `neuma:fold:${id}`;

/** pure — open or folded: the operator's own choice when they made one, else open exactly when it waits on them. */
export const foldOpen = (stored, waits) => (stored === '1' ? true : stored === '0' ? false : Boolean(waits));

/** impure — the operator's kept choice for one section ('1' open, '0' folded, null none). */
export const readFold = (id) => { try { return globalThis.localStorage?.getItem(KEY(id)) ?? null; } catch { return null; } };

/** impure — keep the operator's choice. */
export const keepFold = (id, open) => { try { globalThis.localStorage?.setItem(KEY(id), open ? '1' : '0'); } catch { /* a desk without storage still folds */ } };

/** pure — a stat as the line shows it: plain words, or words with a tone ('on' good, 'alert' waits). */
export const statOf = (stat) => (typeof stat === 'string' ? { text: stat, tone: null } : { text: String(stat?.text ?? ''), tone: stat?.tone ?? null });
