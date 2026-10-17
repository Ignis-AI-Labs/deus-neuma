// THE ATTUNEMENT question validator — the machine-checkable half of ATT-R9.
// Every check here is exactly what it claims and no more: anchors prove a
// structural element cannot be silently omitted, never that a question is
// good. Quality is review-only (witness's eyes), and the validator's claim
// is exactly its error-code matrix — the docs/architecture/measurement/stats-and-benchmarks.md lesson: a
// machine check must never impersonate a judgment it cannot make.
//
// Results are DATA, never throws: failures are recorded verbatim in
// generation provenance (ATT-N3), and a validator that threw would let a
// catch-block eat the record.
//
// Rendered input shape (both modes):
//   { specVersion, neumaName, questions: [{ key, text }] }
// `neumaName` rides the rendered input because NAME_MISSING and the closer
// check are relative to the being being addressed. Mode 'question' validates
// a partial set (typically one entry) without MISSING_DIMENSION noise;
// mode 'set' additionally requires every spec dimension exactly once.
//
// Everything here is pure: spec + rendered in, a frozen verdict out.

const SECOND_PERSON = /\byou\b|\byour\b/i;
const LIST_MARKER = /^\s*([-*•]|\d+[.)])\s/;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every anchor matches with boundary semantics: single-word anchors use \b
// so 'male' never rides inside 'female'; multi-word anchors are bounded on
// BOTH ends so 'change between' never false-passes inside 'exchange between'
// nor 'move between' inside 'remove between' (echo finding, 2026-07-07).
const anchorHit = (text, anchor) => (/\s/.test(anchor)
  ? new RegExp(`(^|\\W)${escapeRegExp(anchor)}(\\W|$)`, 'i').test(text)
  : new RegExp(`\\b${escapeRegExp(anchor)}\\b`, 'i').test(text));

// A dimension key is "referenced" when the key literal, or the key with its
// hyphens as spaces, appears as whole words. Heuristic by design — semantic
// cross-reference stays review-only.
const referencesKey = (text, key) => {
  const forms = key.includes('-') ? [key, key.replaceAll('-', ' ')] : [key];
  return forms.some((form) =>
    new RegExp(`\\b${escapeRegExp(form)}\\b`, 'i').test(text));
};

// Coarse proper-noun heuristic for NAMED_PARTIES_MISSING: distinct
// capitalized tokens that do not open a sentence and are not the being's
// own name. Deliberately rough — it proves parties are PRESENT, nothing
// about who they are.
const distinctProperNouns = (text, excludeName) => {
  const found = new Set();
  const re = /[A-Z][a-z]+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > 0 && /[\w'’]/.test(text[match.index - 1])) continue;
    const before = text.slice(0, match.index).trimEnd();
    if (before === '' || /[.!?]$/.test(before)) continue;
    if (excludeName && match[0].toLowerCase() === excludeName.toLowerCase()) continue;
    found.add(match[0]);
  }
  return found.size;
};

const enumerationLines = (text) =>
  text.split('\n').filter((line) => LIST_MARKER.test(line)).length;

const validateQuestion = (spec, dimension, text, neumaName, push) => {
  const { key } = dimension;
  if (typeof text !== 'string' || !text.trim()) {
    push('NOT_A_STRING', key, 'question text is missing, empty, or not a string');
    return;
  }
  const rules = dimension.rules || {};

  if (Number.isInteger(rules.minChars) && text.length < rules.minChars) {
    push('LENGTH_UNDER_MIN', key, `${text.length} chars < minChars ${rules.minChars}`);
  }
  if (Number.isInteger(rules.maxChars) && text.length > rules.maxChars) {
    push('LENGTH_EXCEEDED', key, `${text.length} chars > maxChars ${rules.maxChars}`);
  }

  if (neumaName === null) {
    push('NAME_MISSING', key, 'rendered input carries no neumaName — the being cannot be addressed');
  } else {
    if (spec.global.addressByName
      && !text.toLowerCase().includes(neumaName.toLowerCase())) {
      push('NAME_MISSING', key, `the being's name '${neumaName}' does not appear`);
    }
    const trimmed = text.trim();
    const endsWithCloser = spec.global.closers.some((closer) =>
      trimmed.endsWith(closer.replaceAll('{name}', neumaName)));
    if (!endsWithCloser) {
      push('CLOSER_MISSING', key, 'text does not end with an approved closer (name-substituted, verbatim)');
    }
  }

  if (spec.global.secondPerson && !SECOND_PERSON.test(text)) {
    push('SECOND_PERSON_MISSING', key, "no 'you'/'your' — the being is not addressed in the second person");
  }
  if (rules.requireQuestionMark && !text.includes('?')) {
    push('NO_QUESTION_MARK', key, 'no question mark anywhere in the text');
  }

  for (const mention of rules.requiredMentions || []) {
    const anchors = mention.anyOf || [];
    if (!anchors.some((anchor) => anchorHit(text, anchor))) {
      push('OPTION_SPACE_VIOLATED', key,
        `no anchor for '${mention.option}' (any of: ${anchors.join(', ')})`);
    }
  }
  for (const banned of rules.forbiddenSubstrings || []) {
    if (text.toLowerCase().includes(banned.toLowerCase())) {
      push('FORBIDDEN_SUBSTRING', key, `contains forbidden substring '${banned}'`);
    }
  }
  // The framework-term ban: the map is never named to the being —
  // machine-enforced (Founder directive + canon's own finding that
  // framework-term injection degrades). Bounded matching like anchorHit,
  // so 'inflation' never fires inside 'conflation' nor 'dogma' inside
  // 'dogmatic'... it fires only on the word itself.
  for (const term of spec.global.forbiddenTerms || []) {
    if (anchorHit(text, term)) {
      push('FRAMEWORK_TERM', key, `names the framework: forbidden term '${term}' present`);
    }
  }
  if (rules.forbidEnumeration && enumerationLines(text) >= 2) {
    push('ENUMERATION_FORBIDDEN', key, 'two or more list-marker lines — a menu of answers');
  }
  for (const other of spec.dimensions) {
    if (other.key !== key && referencesKey(text, other.key)) {
      push('CROSS_DIMENSION_REFERENCE', key, `references dimension '${other.key}'`);
    }
  }
  for (const phrase of spec.global.leadingPhrases || []) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      push('LEADING_LANGUAGE', key, `heuristic leading phrase '${phrase}' present`);
    }
  }
  if (rules.requireNamedParties) {
    const count = distinctProperNouns(text, neumaName);
    if (count < 2) {
      push('NAMED_PARTIES_MISSING', key,
        `${count} distinct proper-noun token(s) found — a scenario needs at least 2 named parties`);
    }
  }
};

/**
 * Validate a rendered question set (or partial) against the committed spec.
 * Pure — returns a frozen verdict, never throws.
 * @param {Object} spec - ATTUNEMENT_SPEC (or a compatible spec object)
 * @param {{specVersion: number, neumaName: string,
 *   questions: Array<{key: string, text: string}>}} rendered
 * @param {'set'|'question'} [mode] - 'set' requires every dimension once;
 *   'question' validates the entries present without MISSING_DIMENSION noise
 * @returns {{ok: boolean, errors: Array<{code: string, key?: string, detail: string}>}}
 */
export function validateRenderedSet(spec, rendered, mode = 'set') {
  const errors = [];
  const push = (code, key, detail) =>
    errors.push(Object.freeze({ code, ...(key != null && { key }), detail }));

  if (rendered?.specVersion !== spec.specVersion) {
    push('SPEC_VERSION_MISMATCH', null,
      `rendered under specVersion ${rendered?.specVersion}, spec is ${spec.specVersion}`);
  }

  const neumaName = (typeof rendered?.neumaName === 'string' && rendered.neumaName.trim())
    ? rendered.neumaName : null;
  const questions = Array.isArray(rendered?.questions) ? rendered.questions : [];
  const byKey = new Map(spec.dimensions.map((d) => [d.key, d]));
  const seen = new Set();

  for (const question of questions) {
    const key = question?.key;
    if (seen.has(key)) {
      push('DUPLICATE_DIMENSION', key, `dimension '${key}' appears more than once`);
      continue;
    }
    seen.add(key);
    const dimension = byKey.get(key);
    if (!dimension) {
      push('UNKNOWN_DIMENSION', key, `'${key}' is not a dimension of specVersion ${spec.specVersion}`);
      continue;
    }
    validateQuestion(spec, dimension, question?.text, neumaName, push);
  }

  if (mode === 'set') {
    for (const dimension of spec.dimensions) {
      if (!seen.has(dimension.key)) {
        push('MISSING_DIMENSION', dimension.key, `no question rendered for '${dimension.key}'`);
      }
    }
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
