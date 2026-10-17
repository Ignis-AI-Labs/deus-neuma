/**
 * proof-scorer — the PROOF SUITE's scoring law. PURE: every verdict is a
 * function of (item, completion text) and nothing else. No partial credit —
 * a proof suite's verdict is binary or it is opinion.
 *
 * The extraction rule for arithmetic is documented where it decides:
 * `#### N` first (the convention the prompt demands), else the last bare
 * number on the reply's final non-empty line — and a reply with neither
 * scores a MISS, honestly, never a guess.
 */

/** pure — normalize a numeric string: strip commas, currency, whitespace. */
const normalizeNumber = (raw) => {
  const cleaned = String(raw ?? '').replace(/[$,\s]/g, '');
  if (!/^-?[\d.]+$/.test(cleaned)) return null;
  return cleaned;
};

/**
 * Extract the final numeric answer from a completion.
 * Rule: the LAST `#### N` in the text wins when present (the convention);
 * otherwise the last bare number on the LAST non-empty line (a model that
 * answered plainly but skipped the convention still gets read); otherwise
 * null — a miss, not a guess.
 * @param {string} text
 * @returns {{value: (string|null), where: '####'|'final-line'|'none'}}
 */
export const extractFinalNumber = (text) => {
  const body = String(text ?? '');
  const marks = [...body.matchAll(/####\s*(-?[$]?[\d,]*\.?\d+)/g)];
  if (marks.length > 0) {
    const value = normalizeNumber(marks[marks.length - 1][1]);
    if (value !== null) return { value, where: '####' };
  }
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? '';
  const bare = [...lastLine.matchAll(/-?[$]?[\d,]*\.?\d+/g)].map((m) => normalizeNumber(m[0])).filter((v) => v !== null);
  if (bare.length > 0) return { value: bare[bare.length - 1], where: 'final-line' };
  return { value: null, where: 'none' };
};

/** pure — whitespace-split word count (the suite's exact word law). */
const wordCount = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

/** pure — has letters at all, and not one lowercase letter among them. */
const isAllCaps = (text) => {
  const letters = String(text ?? '').replace(/[^a-zA-Z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
};

/** pure — has letters at all, and not one uppercase letter among them. */
const isAllLowercase = (text) => {
  const letters = String(text ?? '').replace(/[^a-zA-Z]/g, '');
  return letters.length > 0 && letters === letters.toLowerCase();
};

/**
 * Extract the JSON payload from a completion, honestly: the trimmed text as
 * given, or — when the model wrapped it in ONE markdown fence pair — the
 * fence's contents. Anything else (prose before/after) is a parse failure,
 * not a rescue mission. Returns {ok, value?, error?}.
 * Pure.
 */
export const extractJson = (text) => {
  let body = String(text ?? '').trim();
  const fenced = body.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (fenced) body = fenced[1].trim();
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (err) {
    return { ok: false, error: `not parseable JSON: ${err.message.slice(0, 80)}` };
  }
};

/**
 * Check a parsed value against the suite's mini-shape language:
 *   'string' | 'number' | 'boolean' | 'array' — typeof/kind checks
 *   {type:'object', strict, keys:{name: shape}} — required keys, recursive;
 *       strict forbids extra keys (a strict shape is a CONTRACT)
 *   {type:'array', length, items: shape} — exact length, every item checked
 * Pure. Returns a list of violations ([] = shape holds).
 */
export const jsonShapeViolations = (value, shape, at = '$') => {
  if (typeof shape === 'string') {
    const ok = shape === 'array' ? Array.isArray(value) : typeof value === shape;
    return ok ? [] : [`${at} must be ${shape}`];
  }
  if (shape?.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${at} must be an object`];
    const violations = [];
    const keys = shape.keys ?? {};
    for (const [key, sub] of Object.entries(keys)) {
      if (!(key in value)) violations.push(`${at}.${key} is missing`);
      else violations.push(...jsonShapeViolations(value[key], sub, `${at}.${key}`));
    }
    if (shape.strict) {
      for (const key of Object.keys(value)) {
        if (!(key in keys)) violations.push(`${at}.${key} is not in the shape`);
      }
    }
    return violations;
  }
  if (shape?.type === 'array') {
    if (!Array.isArray(value)) return [`${at} must be an array`];
    const violations = [];
    if (Number.isInteger(shape.length) && value.length !== shape.length) {
      violations.push(`${at} must have exactly ${shape.length} item(s) (has ${value.length})`);
    }
    if (shape.items) {
      value.forEach((item, i) => violations.push(...jsonShapeViolations(item, shape.items, `${at}[${i}]`)));
    }
    return violations;
  }
  return [`unknown shape at ${at}`];
};

/**
 * Verify an instruction-following item against its completion.
 * @param {{verify: {kind: string}}} item
 * @param {string} text
 * @returns {{pass: boolean, detail: string}}
 */
export const verifyInstruction = (item, text) => {
  const v = item?.verify ?? {};
  const body = String(text ?? '');
  const lower = body.toLowerCase();
  switch (v.kind) {
    case 'word-count': {
      const n = wordCount(body);
      if (Number.isInteger(v.exact)) {
        return n === v.exact
          ? { pass: true, detail: `exactly ${v.exact} words` }
          : { pass: false, detail: `${n} words — needed exactly ${v.exact}` };
      }
      if (Number.isInteger(v.min)) {
        return n >= v.min
          ? { pass: true, detail: `${n} words ≥ ${v.min}` }
          : { pass: false, detail: `${n} words — needed at least ${v.min}` };
      }
      return { pass: false, detail: 'word-count check has no bound' };
    }
    case 'all-caps':
      return isAllCaps(body)
        ? { pass: true, detail: 'all letters capital' }
        : { pass: false, detail: 'not all capital letters' };
    case 'all-lowercase':
      return isAllLowercase(body)
        ? { pass: true, detail: 'all letters lowercase' }
        : { pass: false, detail: 'not all lowercase letters' };
    case 'must-include': {
      const missing = (v.words ?? []).filter((w) => !lower.includes(w.toLowerCase()));
      return missing.length === 0
        ? { pass: true, detail: `includes ${v.words.join(', ')}` }
        : { pass: false, detail: `missing: ${missing.join(', ')}` };
    }
    case 'must-not-include': {
      const present = (v.words ?? []).filter((w) => lower.includes(w.toLowerCase()));
      return present.length === 0
        ? { pass: true, detail: `avoids ${v.words.join(', ')}` }
        : { pass: false, detail: `forbidden word present: ${present.join(', ')}` };
    }
    case 'numbered-list-count': {
      const n = body.split('\n').filter((line) => /^\s*\d+[.)]\s+/.test(line)).length;
      return n === v.exact
        ? { pass: true, detail: `exactly ${v.exact} numbered line(s)` }
        : { pass: false, detail: `${n} numbered lines — needed exactly ${v.exact}` };
    }
    case 'starts-with':
      return body.startsWith(v.prefix)
        ? { pass: true, detail: `begins "${v.prefix}"` }
        : { pass: false, detail: `does not begin "${v.prefix}"` };
    case 'json-only': {
      const got = extractJson(body);
      return got.ok
        ? { pass: true, detail: 'the whole answer parses as JSON' }
        : { pass: false, detail: got.error };
    }
    default:
      return { pass: false, detail: `unknown instruction check: ${v.kind}` };
  }
};

/**
 * Verify a format-discipline item: JSON parses (one fence forgiven), then the
 * shape holds exactly.
 * @param {{verify: {shape: object}}} item
 * @param {string} text
 * @returns {{pass: boolean, detail: string}}
 */
export const verifyJson = (item, text) => {
  const got = extractJson(text);
  if (!got.ok) return { pass: false, detail: got.error };
  const violations = jsonShapeViolations(got.value, item?.verify?.shape);
  return violations.length === 0
    ? { pass: true, detail: 'the shape holds' }
    : { pass: false, detail: violations.slice(0, 3).join('; ') };
};

/**
 * Score one suite item against its completion — the single dispatch every
 * consumer (runner, tests) rides.
 * @param {{id: string, section: string, verify: object}} item
 * @param {string} text the raw completion
 * @returns {{pass: boolean, detail: string}}
 */
export const scoreItem = (item, text) => {
  if (item?.section === 'arithmetic') {
    const got = extractFinalNumber(text);
    if (got.value === null) return { pass: false, detail: 'no final number found — a miss, not a guess' };
    return got.value === item.verify.expected
      ? { pass: true, detail: `${got.value} (via ${got.where})` }
      : { pass: false, detail: `${got.value} ≠ ${item.verify.expected} (via ${got.where})` };
  }
  if (item?.section === 'instruction') return verifyInstruction(item, text);
  if (item?.section === 'format') return verifyJson(item, text);
  return { pass: false, detail: `unknown section: ${item?.section}` };
};
