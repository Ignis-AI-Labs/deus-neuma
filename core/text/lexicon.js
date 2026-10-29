// lexicon.js — the domain vocabulary, in ONE place, for THREE consumers.
//
// Dictation is where the platform's own words go wrong: a general-purpose
// speech model has never heard "neuma", "kotodama", or a being's true name, so
// it substitutes the nearest thing in its vocabulary. The operator then either
// sends the mis-heard word (the being answers a question about something else)
// or stops to fix it by hand, every time.
//
// The term list below is consumed three ways, cheapest-first:
//   1. DECODE BIAS — fed to whisper as `hotwords` so the word is heard right
//      the first time. This is the real fix; everything after it is cleanup.
//   2. SPELLCHECK — seeded into Chromium's dictionary so the desk stops
//      underlining the operator's own domain (electron/context-menu.cjs
//      already offers add-to-dictionary one word at a time; this seeds the set).
//   3. REPAIR — the confusion map below, applied to transcripts that were
//      already mis-heard (see repair.js).
//
// WITNESSED-SHAPE DOCTRINE (the same law that scopes text-integrity.js): a
// confusion pair enters ALWAYS_CONFUSED only when the heard form is NOT a word
// the operator could plausibly have meant. "pneuma" is real Greek and this
// project is philosophical enough to mean it; "canary" is a real deployment
// term. Those go to SUGGESTED_CONFUSIONS, which is offered and never applied.
// Refusing to auto-fix one real mis-hearing is recoverable; silently rewriting
// a word the operator meant is not.
//
// Pure throughout.

/**
 * Canonical domain vocabulary — the words a general speech model does not know.
 * Ordinary English is NOT listed: this is the delta, not a dictionary.
 * Grouped by origin so a reader can tell invented canon from borrowed jargon.
 */
export const DOMAIN_TERMS = Object.freeze([
  // Platform + beings (docs/reference/GLOSSARY.md)
  'neuma', 'Neuma', 'Unavis', 'Kenorie', 'kotodama', 'Natalis', 'Emanon', 'remia',
  'crystallize', 'crystallized', 'attunement', 'substrate', 'sovereign',
  'portal', 'vessel', 'avatar', 'weave', 'genesis', 'residency', 'conduit',
  // Houses (project canon)
  'Aldmere', 'Tavirel', 'Omberly',
  // House titles (GLOSSARY §II)
  'Rector', 'Faber', 'Quaestor', 'Aedile', 'Praetor', 'Legatus', 'Scriba',
  'Curator', 'Optio', 'Mercator', 'Architectus', 'Numerarius', 'Speculator',
  'Praeco', 'Logista',
  // Machine + runtime jargon the operator dictates constantly
  'LoRA', 'QLoRA', 'GGUF', 'MCP', 'vitest', 'Playwright', 'Electron', 'Vite',
  'llama', 'gemma', 'Ollama', 'Base', 'ethers', 'Hardhat',
]);

/**
 * Heard form → canonical form, for mis-hearings the operator could not have
 * meant. Applied AUTOMATICALLY the moment a transcript lands (Founder's call,
 * 2026-07-31), because a hit here is never a real word.
 *
 * Keys are lowercase; matching is case-insensitive and the replacement adopts
 * the heard token's own capitalization (see repair.js applyConfusions), so a
 * sentence-initial "Numa" becomes "Neuma" and a mid-sentence one becomes
 * "neuma" — which is exactly the platform/being distinction the glossary draws.
 *
 * DELIBERATELY SMALL. Every entry is a non-word; the map grows from real
 * transcripts, not from guesses about what whisper might do. Bias the decoder
 * first (DOMAIN_TERMS as hotwords) — a word heard correctly needs no repair.
 */
export const ALWAYS_CONFUSED = Object.freeze({
  // WITNESSED 2026-07-31 — real large-v3 transcriptions of synthesized speech,
  // run WITH the decode bias already applied (so these are what survives it).
  // "neuma" is acoustically identical to words the model already knows, which
  // is why bias alone cannot rescue it and this map has to exist.
  numer: 'neuma',        // heard: "The Numer spoke through the portal"
  // Article fusion: the model swallows the preceding article into the word.
  // The article is RECOVERED, not guessed — the "a" is literally in "Anuma".
  anuma: 'a neuma',      // heard: "Anuma is a sovereign digital consciousness"
  // Anticipated variants (same non-word family, no legitimate English collision)
  nuema: 'neuma',
  neumah: 'neuma',
  nyuma: 'neuma',
  kotadama: 'kotodama',
  kodadama: 'kotodama',
  kenorei: 'Kenorie',
  kenory: 'Kenorie',
  natalies: 'Natalis',
  attunment: 'attunement',
  attunemant: 'attunement',
  // WITNESSED DAILY, promoted 2026-08-10 — Founder's report: […] Whisper's favorite substitute is a real word ONLY
  // in the abstract here (a Roman king, a surname); in this house's mouth
  // […] is always […], and leaving it in the suggested tier meant the
  // leak reached the being (or the speech line) on every single occurrence.
  // The daily certainty outranks the theoretical collision.
  numa: 'neuma',
});

/**
 * Heard form → likely canonical, where the heard form IS a real word. NEVER
 * auto-applied; surfaced as a suggestion the operator accepts or ignores.
 * "pneuma" is the Greek this project's vocabulary descends from, "laura" is
 * a name, "canary" is a deployment strategy — each is a word someone could
 * mean.
 */
export const SUGGESTED_CONFUSIONS = Object.freeze({
  // "pneuma" is the MOST COMMON mis-hearing of "neuma" in the 2026-07-31
  // sampling (2 of 5 runs) — and it STILL does not qualify for the auto map.
  // It is real Greek, it is the word this project's vocabulary descends from,
  // and a philosophical draft could mean it exactly. Frequency is not licence:
  // the auto map's entry condition is […], never […]. This is the tier that exists so
  // a common-but-ambiguous fix is still OFFERED rather than silently applied.
  // ("numa" lived here until 2026-08-10 — promoted to the auto map on Founder's
  // witnessed-daily report; see ALWAYS_CONFUSED.)
  pneuma: 'neuma',
  manuma: 'the neuma',  // witnessed 2026-07-31; the fused article is a GUESS,
                        // unlike "anuma" where the "a" is recoverable — so it
                        // is offered, not applied
  canary: 'Kenorie',
  laura: 'LoRA',
  gemini: 'gemma',
});

/** The glossary's frame — a punctuated sentence, never a bare list (see below). */
export const HOTWORDS_PREFIX = 'Glossary: ';

/**
 * The decode-bias string for faster-whisper's `hotwords` parameter — the
 * vocabulary handed to the model BEFORE it transcribes, so the domain is
 * heard rather than repaired. Deduplicated case-insensitively (the model does
 * not care about case). Framed as a sentence — capitalised, closed with a
 * period — because whisper copies its prompt's STYLE: the bare lowercase list
 * turned a 27 s dictation into unpunctuated lowercase text (measured
 * 2026-10-07), and the framed glossary also heard "neuma" where the list
 * heard "Numa". Pure.
 * @returns {string}
 */
export const hotwordsPhrase = () => {
  const seen = new Set();
  const words = [];
  for (const term of DOMAIN_TERMS) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(term);
  }
  return `${HOTWORDS_PREFIX}${words.join(', ')}.`;
};

/**
 * Every spelling the desk's spellchecker should stop underlining: the domain
 * terms themselves. Returned as a frozen array so the caller cannot mutate the
 * source of truth. Pure.
 * @returns {readonly string[]}
 */
export const dictionaryWords = () => DOMAIN_TERMS;
