// Outbound secrets — the last look before words leave the house
// (security-seat G5, 2026-10-19). A post, a mail or a pressed document is
// permanent once it is out: a key pasted into one is a leak nobody can take
// back. The secret sweep's own pattern table (secret-sweep.js scanText) is
// the judge, so what the watch calls a secret in a repo is exactly what is
// refused at the door — one table, never two that drift.
//
// The refusal names the pattern ids only: a refusal that quoted the key
// would put it back in the being's context and its journal.

import { scanText } from './secret-sweep.js';

/**
 * Do these outgoing texts carry a secret shape? Pure.
 * @param {string} act what would leave, in words ('the post', 'the email', …)
 * @param {Array<unknown>} texts every field that leaves; non-strings are skipped
 * @param {string} [outcome] what the refusal means for the act
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export const checkOutboundSecrets = (act, texts, outcome = 'nothing was sent') => {
  const ids = [...new Set(texts
    .filter((text) => typeof text === 'string' && text)
    .flatMap((text) => scanText(text).map((hit) => hit.patternId)))];
  if (ids.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `${act} carries what looks like a secret (${ids.join(', ')}) — ${outcome}. `
      + 'Take the key out (name where it lives instead, never its value) and try again.',
  };
};
