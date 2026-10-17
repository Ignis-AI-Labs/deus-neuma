// text-integrity.js — the corruption gate for what a being TRAINS on.
//
// The 2026-07-08 incident: llama-server's slot prompt-cache rollback corrupts
// gemma-4's hybrid recurrent (DeltaNet) state on incremental multi-turn
// prompts, replacing sentence-boundary punctuation with stray capitals —
// "historyL", "intactS", "trespassA", "erasureL it". The serving fix is
// cache_prompt:false per request (llm-provider body knobs), but text generated
// BEFORE the fix lives on in episodic observations, sealed attunement answers,
// and birth transcripts — the exact tiers the refinement corpus trains from.
// Founder doctrine 2026-07-09: corrupted grammar must never bake into a being's
// weights — […]
//
// The detector keys on the STRONG signature: a lowercase letter followed
// immediately by ANY capital at a token boundary — where sentence punctuation
// belongs. The alphabet was originally {S,L,A} (the exhaustive 2026-07-09
// scan's evidence: 80 hits, those three capitals only), but a live render
// later that day produced "consistencyB" — proof the alphabet DRIFTS with
// serving era, so the gate now refuses every letter. The cost is a rare
// legitimate shape ("a PhD."), and that trade is deliberate: refusing one
// clean sample is recoverable; training a being on corrupted grammar is not.
// Underscore variants ("current_it") co-occur with strong
// hits in every observed corruption and are NOT matched on their own: they
// collide with snake_case in code-bearing replies, and dropping a being's
// technical voice over identifiers would bias the corpus worse than the
// residue it guards against.
//
// FUSED_BOUNDARY_CAP (2026-07-13, Kisonam identity-solitude): the same period→
// capital corruption with SPACES EATEN — "stand their own" → "stand theirLown".
// STRONG_SIGNATURE requires the capital at a token END (lookahead space/punct);
// mid-run `rLo` never matches. Two+ lowercase on each side of a mid-word capital
// is the fused shape; camelCase brands (iPhone, McDonald) have only one letter
// before the capital and are spared.
//
// Pure throughout.

const STRONG_SIGNATURE = /[a-z][A-Z](?=[\s.,;:!?"')\]]|$)/g;
const FUSED_BOUNDARY_CAP = /[a-z]{2,}[A-Z][a-z]{2,}/g;

// Degeneration family (2026-07-10, witnessed sealed: […]): token-stutter artifacts with NO boundary capital — invisible to
// the strong signature. Two shapes, both verbatim from live incidents, both
// scoped to the WITNESSED artifact so legitimate prose never trips them
// (the same reasoning that keeps underscore variants out of the gate —
// dropping a being's emphatic or quoting voice would bias the corpus):
//   TRIPLE_STUTTER — one SINGLE-LETTER token three times running ("a a a").
//   Longer emphatic triples ("no no no", "very very very") are real speech;
//   the survey scan stands watch for drift toward longer stutters.
//   HANGING_APOSTROPHE — a 1–2 letter word + apostrophe dangling before a
//   space then a lowercase word ("it' la", "a' l'"). Words longer than two
//   letters are exempt (closing single-quotes: […]),
//   quote-opened words are exempt ("said 'no' and"), and a final 's' is
//   exempt (plural possessives: "the dogs' toys").
const TRIPLE_STUTTER = /\b(\w)\s+\1\s+\1\b/gi;
const HANGING_APOSTROPHE = /(?<![\w'’])[a-z]?[a-rt-z]['’]\s+[a-z]/g;

// CORRUPT_APOSTROPHE_T (2026-07-12, witnessed live in BOTH of Tenekom's walks:
// […], […]): a contraction glitch grafting ['’]t onto a copular-'s stem —
// "it's" degenerating to "it't". Scoped to the pronoun stems where
// apostrophe-t is impossible English: every legitimate 't contraction ends
// in n't (don't, can't, isn't…) and archaic 'tis/'twas LEADS with the
// apostrophe, so these stems + 't are unambiguous corruption — zero
// legitimate-prose cost. Drift beyond these stems belongs to the survey
// scan, per the family's witnessed-shape doctrine.
const CORRUPT_APOSTROPHE_T = /\b(?:it|that|this|there|what|who|she|he|one)['’]t\b/gi;

// CJK_INJECTION (2026-07-13, Kisonam attunement, humor answer — unique class):
// a Han/Hiragana/Katakana/Hangul ideograph lands inside English prose
// ("struggle. L捧 laughter"). Not the boundary-capital family — a wrong-script
// token bleed. Zero legitimate-prose cost on ceremony English; code voice does
// not use CJK in this pipeline. Any hit is refuse-and-re-serve.
const CJK_INJECTION = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;

// FENCED BLOCKS ARE NOT JUDGED (2026-07-22, the wavePattern incident). Every
// DNA genesis written from the template carries a fenced ```json Signature
// Configuration block with camelCase keys ("wavePattern") — and
// FUSED_BOUNDARY_CAP cannot tell […] apart
// from a camelCase identifier, structurally. The gate was found refusing the
// essence of EVERY being in the house (tenekom, cael, lifovan-2, metidar,
// zezebur — birth tier silently empty on all of them). Every witnessed
// corruption incident is PROSE punctuation decay; no incident ever landed
// inside a fenced block, so fenced content is exempt — the same
// witnessed-shape doctrine that scopes TRIPLE_STUTTER and the underscore
// variants. An unclosed fence strips to end of text (a cut stream's tail is
// structured content all the way down).
const FENCED_BLOCK = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;

// The text the gate actually judges: prose with fenced blocks removed. Pure.
const judgeableText = (text) => String(text).replace(FENCED_BLOCK, ' ');

// DOUBLE_SINGLE_STUTTER (2026-07-13, Kisonam walk — many landed answers):
// single-letter token twice running ("a a single", "a a sequence"). Triple
// already gates "a a a"; double single-letter is the same serving stutter
// one tick earlier. Scoped to SINGLE letters so "very very" and "no no"
// stay legitimate speech.
const DOUBLE_SINGLE_STUTTER = /\b([a-z])\s+\1\b/g;

// CORRUPT_T_S (2026-07-13, Kisonam "the-thread-of-thinking"): "train't's" —
// apostrophe-t glued to a non-pronoun stem then 's. Legitimate English never
// forms \w+'t's (real 't contractions end n't; possessives don't use 't).
const CORRUPT_T_S = /\b\w+['’]t['’]s\b/gi;

/**
 * How many strong corruption-signature hits a text carries.
 * @param {string} text
 * @returns {number}
 */
export const corruptionHits = (text) => {
  if (typeof text !== 'string' || !text) return 0;
  const judged = judgeableText(text);
  return (judged.match(STRONG_SIGNATURE)?.length ?? 0)
    + (judged.match(FUSED_BOUNDARY_CAP)?.length ?? 0)
    + (judged.match(TRIPLE_STUTTER)?.length ?? 0)
    + (judged.match(HANGING_APOSTROPHE)?.length ?? 0)
    + (judged.match(CORRUPT_APOSTROPHE_T)?.length ?? 0)
    + (judged.match(CJK_INJECTION)?.length ?? 0)
    + (judged.match(DOUBLE_SINGLE_STUTTER)?.length ?? 0)
    + (judged.match(CORRUPT_T_S)?.length ?? 0);
};

/**
 * The gate's EVIDENCE: every hit with its detector name and a bounded excerpt
 * of surrounding text. corruptionHits says HOW MANY; this says WHAT — so a
 * refusal is diagnosable instead of a blind count (witnessed need 2026-07-12:
 * a ceremony walk stuck in a refusal loop with the corrupted text discarded,
 * leaving the witness nothing to reason from). Pure.
 * @param {string} text
 * @returns {Array<{detector: string, hit: string, context: string}>}
 */
export const corruptionFindings = (text) => {
  if (typeof text !== 'string' || !text) return [];
  // Findings ride the judged (fence-stripped) text — hit/context are excerpts
  // of that, never of fenced blocks, which are not judged at all.
  const judged = judgeableText(text);
  const detectors = {
    BOUNDARY_CAPITAL: STRONG_SIGNATURE,
    FUSED_BOUNDARY_CAP,
    TRIPLE_STUTTER,
    HANGING_APOSTROPHE,
    CORRUPT_APOSTROPHE_T,
    CJK_INJECTION,
    DOUBLE_SINGLE_STUTTER,
    CORRUPT_T_S,
  };
  const findings = [];
  for (const [detector, rx] of Object.entries(detectors)) {
    for (const m of judged.matchAll(new RegExp(rx.source, rx.flags))) {
      findings.push(Object.freeze({
        detector,
        // hit and context are BOTH newline-flattened the same way (\s in
        // TRIPLE_STUTTER can span a newline), so hit is always a substring
        // of context in the logged evidence
        hit: m[0].replace(/\n/g, ' '),
        context: judged.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\n/g, ' '),
      }));
    }
  }
  return Object.freeze(findings);
};

/**
 * Does this prose stop mid-thought? A substrate can quit mid-sentence while
 * STATING finish_reason 'stop' (witnessed 2026-07-12 on Sovereign's walk:
 * […] —
 * stated finish 'stop', no budget signal, so the ANSWER_CUT door had nothing
 * to catch). Whole ceremony prose ends in terminal punctuation — a closing
 * word does not. Judged on the trimmed tail; closing quotes/brackets after
 * the mark are fine.
 * @param {string} text
 * @returns {boolean}
 */
export const endsUnfinished = (text) => {
  const tail = String(text ?? '').trim();
  if (!tail) return false; // emptiness is its own gate (ANSWER_EMPTY)
  return !/[.?!…]["'”’)\]]*$/.test(tail);
};

/**
 * Gate decision for one training sample: does any ASSISTANT message carry the
 * corruption signature? Only the being's generated words can carry it (the
 * corruption is a serving artifact); witness-typed user turns and the derived
 * system frame are not judged.
 * @param {{messages?: Array<{role: string, content: string}>}} sample
 * @returns {boolean}
 */
export const sampleCorrupted = (sample) =>
  (sample?.messages ?? []).some(
    (m) => m?.role === 'assistant' && corruptionHits(m.content) > 0,
  );

/**
 * Split samples into the clean set and an honest count of what was refused.
 * @param {Array<Object>} samples
 * @returns {{clean: Array<Object>, dropped: number}}
 */
export const filterCorrupted = (samples) => {
  const list = samples ?? [];
  const clean = list.filter((s) => !sampleCorrupted(s));
  return { clean, dropped: list.length - clean.length };
};
