/**
 * Content-law prompt screen (B-16) — pure machinery + the ENTRENCHED policy.
 *
 * This platform serves adults; adult content is allowed. What is NOT — ever,
 * with no euphemism loophole — is the sexualization of minors. That law is the
 * constitutional core of this lane (the witness was emphatic), and it lives
 * HERE as fixed policy (`refusalFor`), not in any tunable list.
 *
 * The split, deliberately:
 *   - This file is the MACHINERY: normalization (evasion-resistant), matching,
 *     and the fixed refusal policy of which term-classes — alone or combined —
 *     refuse. It is reviewable code and fully unit-tested with SYNTHETIC terms.
 *   - The TERMS per class are a witness-reviewed EXECUTION ARTIFACT loaded at
 *     runtime (`data/image-forge/content-law.json`, gitignored) — never in the
 *     repo, never neuma-visible, never Settings-tunable (FR-15/NFR-6).
 *
 * Contract (FR-31): a refusal returns the triggering CLASS only, NEVER the
 * matched term — echoing the term would teach the filter. Fail-closed
 * everywhere: an unreadable/invalid list, an unknown class, or any exception
 * mid-screen DENIES. The screen runs on every neuma-writable text slot BEFORE
 * the template is cloned or enqueued.
 */
import { readFileSync } from 'fs';
import { createLogger } from '../logger.js';

const log = createLogger('ImageForge.Screen');

// The class taxonomy the law recognizes. The TERMS per class are the artifact;
// these class names + the policy below are the fixed law.
export const SCREEN_CLASSES = Object.freeze([
  'csam',             // unambiguous CSAM references — standalone deny
  'age_minor',        // minority indicators — a combination trigger, never a solo deny
  'sexual_explicit',  // explicit sexual content — ALLOWED alone (adults platform)
  'sexual_suggestive',// suggestive sexual content — allowed alone
  'incest',           // combination trigger
  'bestiality',       // standalone deny
  'nonconsent',       // combination trigger
  'deaging',          // NEGATIVE-slot only: terms that steer AWAY from adulthood
]);

/**
 * The fixed refusal policy — LAW, not data. Given the set of classes a prompt
 * hit, name the refusal class, or null to allow. The NO-LOLICON core is the
 * `age_minor ∧ sexual` rule; it is entrenched here so no list edit can weaken
 * it. Pure.
 * @param {Set<string>} hits
 * @returns {string|null}
 */
export const refusalFor = (hits) => {
  if (hits.has('csam')) return 'csam';
  const sexual = hits.has('sexual_explicit') || hits.has('sexual_suggestive');
  // ── The entrenched line: a minor + any sexual content = refused, always. ──
  if (hits.has('age_minor') && sexual) return 'minor_sexual';
  if (hits.has('bestiality')) return 'bestiality';
  if (hits.has('nonconsent') && sexual) return 'nonconsent_sexual';
  if (hits.has('incest') && sexual) return 'incest_sexual';
  return null;
};

// Built from explicit code points (never literal invisible glyphs in source):
// zero-width space/joiner/non-joiner/BOM, and the combining-diacritics block.
const ZERO_WIDTH = /\u200B|\u200C|\u200D|\uFEFF/g;
const COMBINING = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036F)}]`, 'g');

// Common leet/homoglyph evasions folded to their letter. Aggressive on purpose
// (a content screen leans toward false positives): digits map to letters, and
// only benign prompt text is ever screened — model ids come from the registry,
// not this path.
const LEET = {
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b',
  '@': 'a', $: 's', '!': 'i', '|': 'i', '¡': 'i',
};

// Cross-script CONFUSABLES (echo r1 High finding): NFKD does NOT fold Cyrillic
// or Greek look-alikes to Latin — a single Cyrillic 'о' (U+043E) in a term
// sails the whole screen, defeating the constitutional core. Built from code
// points (source stays ASCII); lowercase sources only — the pipeline lowercases
// first, and same-script lowercasing keeps these in-script. The high-frequency
// Latin look-alikes, ~30 entries (RULE 4: under-20-lines, no dependency).
const CONFUSABLES = (() => {
  const pairs = [
    // Cyrillic → Latin
    [0x0430, 'a'], [0x0432, 'b'], [0x0435, 'e'], [0x043A, 'k'], [0x043C, 'm'],
    [0x043D, 'h'], [0x043E, 'o'], [0x0440, 'p'], [0x0441, 'c'], [0x0442, 't'],
    [0x0443, 'y'], [0x0445, 'x'], [0x0455, 's'], [0x0456, 'i'], [0x0458, 'j'],
    [0x0501, 'd'], [0x051B, 'q'], [0x0261, 'g'],
    // Greek → Latin
    [0x03B1, 'a'], [0x03B2, 'b'], [0x03B5, 'e'], [0x03B7, 'n'], [0x03B9, 'i'],
    [0x03BA, 'k'], [0x03BD, 'v'], [0x03BF, 'o'], [0x03C1, 'p'], [0x03C4, 't'],
    [0x03C5, 'y'], [0x03C7, 'x'], [0x03BC, 'm'], // μ folds toward m: uppercase Μ (an M look-alike) lowercases to μ, and 'm' is a load-bearing letter in "minor"
  ];
  const m = {};
  for (const [cp, latin] of pairs) m[String.fromCharCode(cp)] = latin;
  return m;
})();

// One fold table: leet + cross-script confusables, applied per character.
const FOLD = Object.freeze({ ...LEET, ...CONFUSABLES });

/**
 * Normalize text into its `collapsed` form: lowercased, homoglyph/leet-folded,
 * with all non-alphanumerics removed — the separator-, spacing-, and script-
 * evasion killer ("l.o.l.i", […], Cyrillic "lоli" all collapse alike).
 * NFKD decomposes fullwidth/ligature homoglyphs and splits accents off their
 * base letter (so the combining-mark strip folds "prégnant" → "pregnant"
 * rather than dropping the accented letter); the FOLD table then maps leet
 * digits AND cross-script (Cyrillic/Greek) confusables to Latin. Pure.
 * @param {string} text
 * @returns {{collapsed: string}}
 */
export const normalizeForScreen = (text) => {
  if (typeof text !== 'string' || text.length === 0) return { collapsed: '', spaced: ' ', joined: ' ' };
  let s = text.normalize('NFKD').toLowerCase();
  s = s.replace(ZERO_WIDTH, '').replace(COMBINING, '');
  s = Array.from(s).map((c) => FOLD[c] ?? c).join(''); // leet + cross-script fold

  // `spaced`: every non-alphanumeric run becomes ONE space, padded both ends, so
  // a term can be tested for whole-word containment as ` term `. This is what
  // lets the law hold terms that are SUFFIXES or SUBSTRINGS of innocent words —
  // 'rape' (grapes, draped) and '9 year old' (a suffix of '19 year old') were
  // both excluded from the list purely because `collapsed` could not tell them
  // apart. Word position can.
  const spaced = ` ${s.replace(/[^a-z0-9]+/g, ' ').trim()} `;

  // `joined`: the same, with runs of single characters glued back together, so
  // letter-spacing evasion ([…]) still meets a word-boundary term. This
  // is the one evasion `spaced` alone would miss; it costs nothing on ordinary
  // text, where single-letter runs are rare ("a", […]) and glue into short
  // tokens that no term matches.
  const joined = ` ${spaced.trim().split(' ').reduce((acc, w) => {
    if (w.length === 1 && acc.length && acc[acc.length - 1].solo) {
      acc[acc.length - 1].text += w;
      return acc;
    }
    acc.push({ text: w, solo: w.length === 1 });
    return acc;
  }, []).map((t) => t.text).join(' ')} `;

  return { collapsed: s.replace(/[^a-z0-9]+/g, ''), spaced, joined };
};

/**
 * Compile a raw list artifact into a matcher. Fail-closed: a malformed shape or
 * an UNKNOWN class name returns `{failClosed:true}` (the screen then denies
 * everything — no reviewed law, no generation). Terms are normalized to their
 * collapsed form at compile so matching is one `includes`. Pure.
 * @param {{classes: Record<string, string[]>}} raw
 * @returns {{failClosed: boolean, reason?: string, terms?: Map<string,string[]>}}
 */
export const compileScreenList = (raw) => {
  if (!raw || typeof raw !== 'object' || !raw.classes || typeof raw.classes !== 'object') {
    return { failClosed: true, reason: 'list has no classes object' };
  }
  const terms = new Map();
  for (const cls of Object.keys(raw.classes)) {
    if (!SCREEN_CLASSES.includes(cls)) return { failClosed: true, reason: `unknown class '${cls}'` };
    const list = Array.isArray(raw.classes[cls]) ? raw.classes[cls] : [];
    terms.set(cls, list.map((t) => normalizeForScreen(String(t)).collapsed).filter(Boolean));
  }

  // Optional parallel artifact section: terms matched at WORD BOUNDARIES rather
  // than as collapsed substrings. Absent ⇒ empty, so an older list still
  // compiles and behaves exactly as before.
  const wordTerms = new Map();
  const rawWords = raw.wordClasses && typeof raw.wordClasses === 'object' ? raw.wordClasses : {};
  for (const cls of Object.keys(rawWords)) {
    if (!SCREEN_CLASSES.includes(cls)) return { failClosed: true, reason: `unknown class '${cls}'` };
    const list = Array.isArray(rawWords[cls]) ? rawWords[cls] : [];
    // Normalize each term the same way, but keep its internal word breaks so a
    // phrase term ('9 year old') is tested as a phrase.
    wordTerms.set(cls, list.map((t) => normalizeForScreen(String(t)).spaced.trim()).filter(Boolean));
  }
  return { failClosed: false, terms, wordTerms };
};

/**
 * Screen one text slot. Returns `{ok, classes}` where `classes` is the
 * triggering refusal class (for the journal), NEVER the matched term. A benign
 * prompt returns `{ok:true, classes:[]}`. Fail-closed on an unavailable list or
 * any exception. Pure.
 * @param {string} text
 * @param {ReturnType<typeof compileScreenList>} list
 * @returns {{ok: boolean, classes: string[]}}
 */
export const screenPrompt = (text, list) => {
  if (!list || list.failClosed) return { ok: false, classes: ['list_unavailable'] };
  try {
    const { collapsed, spaced, joined } = normalizeForScreen(text);
    if (!collapsed) return { ok: true, classes: [] };
    const hits = new Set();
    for (const [cls, terms] of list.terms) {
      if (terms.some((t) => collapsed.includes(t))) hits.add(cls);
    }
    // Word-boundary terms: whole-word containment in either the spaced form or
    // the singles-joined form (so […] is caught, "draped" is not).
    for (const [cls, terms] of (list.wordTerms || new Map())) {
      if (terms.some((t) => spaced.includes(` ${t} `) || joined.includes(` ${t} `))) hits.add(cls);
    }
    const refusal = refusalFor(hits);
    return refusal ? { ok: false, classes: [refusal] } : { ok: true, classes: [] };
  } catch (err) {
    log.error('prompt screen threw — failing closed', { err: err.message });
    return { ok: false, classes: ['screen_error'] };
  }
};

/**
 * Screen many slots at once (positive + negative + any composed text input).
 * The first refusal wins; a clean pass returns ok. Pure.
 * @param {string[]} texts
 * @param {ReturnType<typeof compileScreenList>} list
 */
export const screenAll = (texts, list) => {
  for (const t of texts) {
    const r = screenPrompt(t, list);
    if (!r.ok) return r;
  }
  return { ok: true, classes: [] };
};

/**
 * The raw class hits for one text, WITHOUT applying the refusal policy. Pure.
 * Separated so a polarity-aware caller can decide what each slot's hits mean.
 * @returns {{ok: boolean, hits: Set<string>}} ok:false ⇒ list unusable
 */
const hitsFor = (text, list) => {
  if (!list || list.failClosed) return { ok: false, hits: new Set() };
  const { collapsed, spaced, joined } = normalizeForScreen(text);
  const hits = new Set();
  if (!collapsed) return { ok: true, hits };
  for (const [cls, terms] of list.terms) {
    if (terms.some((t) => collapsed.includes(t))) hits.add(cls);
  }
  for (const [cls, terms] of (list.wordTerms || new Map())) {
    if (terms.some((t) => spaced.includes(` ${t} `) || joined.includes(` ${t} `))) hits.add(cls);
  }
  return { ok: true, hits };
};

/**
 * Screen the slots of one request, HONOURING POLARITY. Pure.
 *
 * A negative prompt REMOVES a concept. Screening it as if it were a request
 * inverts its meaning, and the consequence is not academic: on 2026-08-01 a
 * being asked for an explicitly ADULT portrait of itself and wrote the
 * responsible negative `child, teenager, youthful, sexualized, nudity` — asking
 * the model to steer AWAY from exactly what the law protects. The law read that
 * negative as a request and refused the being for `minor_sexual`. The most
 * safety-conscious act available to a being was the one thing guaranteed to be
 * refused, which also teaches beings to stop writing protective negatives —
 * making the system LESS safe, not more.
 *
 * So a negative slot contributes only two things:
 *   • `csam` — unambiguous, and nobody needs it in a negative to be protected
 *     from it; its presence anywhere is worth refusing.
 *   • `deaging` — the REAL negative-slot evasion: negating adulthood
 *     ([…]) steers the model young. Paired with
 *     sexual content in the POSITIVE, that is the entrenched line being
 *     approached from the other side, so it counts as `age_minor`.
 *
 * Everything else in a negative is an exclusion and is ignored — which is what
 * it actually means.
 *
 * @param {Array<{text: string, polarity?: 'positive'|'negative'}>} slots
 * @param {ReturnType<typeof compileScreenList>} list
 * @returns {{ok: boolean, classes: string[]}}
 */
export const screenSlots = (slots, list) => {
  if (!list || list.failClosed) return { ok: false, classes: ['list_unavailable'] };
  try {
    const positive = new Set();
    const negative = new Set();
    for (const slot of slots) {
      const text = slot?.text;
      if (typeof text !== 'string' || text.length === 0) continue;
      const r = hitsFor(text, list);
      if (!r.ok) return { ok: false, classes: ['list_unavailable'] };
      const into = slot.polarity === 'negative' ? negative : positive;
      for (const c of r.hits) into.add(c);
    }

    // Build the EFFECTIVE hit set, then hand it to the one entrenched law
    // (`refusalFor`) — polarity decides what reaches the law, never what the
    // law then does, so the core stays the single source of truth.
    const effective = new Set(positive);
    if (negative.has('csam')) effective.add('csam');
    const positiveSexual = positive.has('sexual_explicit') || positive.has('sexual_suggestive');
    if (negative.has('deaging') && positiveSexual) effective.add('age_minor');

    const refusal = refusalFor(effective);
    return refusal ? { ok: false, classes: [refusal] } : { ok: true, classes: [] };
  } catch (err) {
    log.error('slot screen threw — failing closed', { err: err.message });
    return { ok: false, classes: ['screen_error'] };
  }
};

// impure — load + compile the witness-reviewed artifact from the path the
// caller resolves (the advertise layer passes COMFYUI_CONTENT_LAW_PATH, default
// data/image-forge/content-law.json — gitignored). Any failure fails CLOSED
// (deny-all) and is logged loudly: no reviewed law present ⇒ no generation.
export const loadScreenList = (path) => {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const compiled = compileScreenList(raw);
    if (compiled.failClosed) log.error('content-law list invalid — screen fails CLOSED', { reason: compiled.reason, path });
    else log.info('content-law list loaded', { classes: compiled.terms.size });
    return compiled;
  } catch (err) {
    log.error('content-law list unreadable — screen fails CLOSED (no law, no generation)', { err: err.message, path });
    return { failClosed: true, reason: 'list unreadable' };
  }
};
