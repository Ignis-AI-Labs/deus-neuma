// Outbound secrets — the last look before words leave the house
// (security-seat G5, 2026-10-19). A post, a mail, a pressed document or a web
// request is permanent once it is out: a key pasted into one is a leak nobody
// can take back. The secret sweep's own pattern table (secret-sweep.js
// scanText) is the judge of shapes, so what the watch calls a secret in a repo
// is exactly what is refused at the door — one table, never two that drift.
//
// The CSO re-audit (2026-10-29, NEW-M4) found the door read shapes only: a
// key passed base64- or hex-encoded, a recovery phrase passed in plain words,
// and this machine's own keys passed whenever no rule knew their shape. So the
// door also reads the encoded forms a text carries, a valid BIP-39 phrase,
// and the live values of the backend's own environment in every encoding the
// commit gate guards (secret-gate.js withEncodings) — one notion of "live".
//
// The refusal names pattern ids and variable names only: a refusal that
// quoted the key would put it back in the being's context and its journal.

import { Mnemonic, wordlists } from 'ethers';
import { scanText } from './secret-sweep.js';
import { liveSecretsFrom, withEncodings } from './secret-gate.js';
import { decodedForms } from './decoded-forms.js';

const PHRASE_LENGTHS = Object.freeze([24, 21, 18, 15, 12]);

// pure — does the text hold a BIP-39 recovery phrase: a run of list words whose
// checksum is valid (an ordinary sentence of list words almost never is)?
const carriesRecoveryPhrase = (text) => {
  const words = String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let run = [];
  const runHolds = () => run.length >= 12 && run.some((_, start) => PHRASE_LENGTHS.some((n) => (
    start + n <= run.length && Mnemonic.isValidMnemonic(run.slice(start, start + n).join(' ')))));
  for (const word of [...words, '']) {
    if (word && wordlists.en.getWordIndex(word) >= 0) { run.push(word); continue; }
    if (runHolds()) return true;
    run = [];
  }
  return false;
};

let liveCache = { key: null, values: [] };
/**
 * The backend's own live secret values and their encodings, read from its
 * environment (provider keys from .env, and the desk keys desk-keys.js puts
 * there), recomputed only when the environment changes. impure (reads process.env)
 * @returns {Array<{value: string, name: string}>}
 */
const liveOutboundValues = (env = process.env) => {
  const text = Object.entries(env).map(([name, value]) => `${name}=${value}`).join('\n');
  if (liveCache.key !== text) {
    liveCache = { key: text, values: withEncodings(liveSecretsFrom([{ file: 'the backend environment', text }])) };
  }
  return liveCache.values;
};

/**
 * Do these outgoing texts carry a secret — a known shape, plain or encoded, a
 * recovery phrase, or a live value of this machine? Pure but for its default
 * `live`, which reads the backend's environment.
 * @param {string} act what would leave, in words ('the post', 'the email', …)
 * @param {Array<unknown>} texts every field that leaves; non-strings are skipped
 * @param {string} [outcome] what the refusal means for the act
 * @param {{live?: Array<{value: string, name: string}>}} [sources]
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export const checkOutboundSecrets = (act, texts, outcome = 'nothing was sent', { live = liveOutboundValues() } = {}) => {
  const strings = texts.filter((text) => typeof text === 'string' && text);
  const found = new Set(strings
    .flatMap((text) => [text, ...decodedForms(text)])
    .flatMap((text) => scanText(text).map((hit) => hit.patternId)));
  if (strings.some(carriesRecoveryPhrase)) found.add('recovery-phrase');
  const liveHit = live.find((secret) => strings.some((text) => text.includes(secret.value)));
  if (liveHit) found.add(`the live value of ${liveHit.name}`);
  if (found.size === 0) return { ok: true };
  return {
    ok: false,
    reason: `${act} carries what looks like a secret (${[...found].join(', ')}) — ${outcome}. `
      + 'Take the key out (name where it lives instead, never its value) and try again.',
  };
};
