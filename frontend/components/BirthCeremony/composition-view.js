// composition-view.js — pure view model for the ceremony's disclosure panel.
//
// Turns one `birth:composition` event into rows the scene renders. The event
// carries the EXACT substrings sent to the substrate (core/birth/ceremony-disclosure.js),
// so this layer only labels and measures — it never summarizes, paraphrases,
// or reorders. Anything it dropped would be a hidden prop again.
//
// pure — no DOM, no IO.

/** Sections carry their own separators so their join is the message; the
 *  leading blank lines are plumbing, not content, and are not worth a scroll. */
const displayText = (text) => String(text || '').replace(/^\n+/, '');

/** Thousands-separated, en-US — the ceremony's data register reads in digits. */
const count = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * pure — one row per disclosed component, in send order.
 * @param {Object} event - a `birth:composition` event
 * @returns {ReadonlyArray<Readonly<Object>>} frozen rows
 */
export const compositionRows = (event = {}) => Object.freeze(
  (event.components || []).map((c) => Object.freeze({
    id: c.id,
    label: c.label,
    origin: c.origin,
    channel: c.channel,
    chars: c.chars,
    charsLabel: count(c.chars),
    text: displayText(c.text),
    // The operator's own voice and the line appended to it are the two rows
    // that answer […] — the scene marks them apart.
    mine: c.channel === 'operator',
    appended: c.channel === 'ceremony',
  })),
);

/**
 * pure — the one-line read of the whole request. Counts only: no percentage,
 * no verdict, nothing the operator cannot check by adding up the rows.
 * @param {Object} event - a `birth:composition` event
 * @returns {Readonly<{components: number, chars: number, yours: number, headline: string}>}
 */
export const compositionSummary = (event = {}) => {
  const totals = event.totals || {};
  const components = totals.components || 0;
  const chars = totals.chars || 0;
  const yours = totals.yours || 0;
  return Object.freeze({
    components,
    chars,
    yours,
    headline: `${count(components)} COMPONENTS · ${count(chars)} CHARACTERS · ${count(yours)} YOURS`,
  });
};

/**
 * pure — the request settings that carry no prompt text (provider, model,
 * temperature, token ceiling, function schemas).
 * @param {Object} event - a `birth:composition` event
 * @returns {ReadonlyArray<Readonly<{label: string, value: string}>>}
 */
export const compositionParameters = (event = {}) => Object.freeze(
  (event.parameters || []).map((p) => Object.freeze({ label: p.label, value: String(p.value) })),
);
