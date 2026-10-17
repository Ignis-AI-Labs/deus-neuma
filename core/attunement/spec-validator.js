/** Pure integrity and fallback-render checks for the assembled attunement spec. */
import { validateRenderedSet } from './question-validator.js';
import { renderFallbackQuestionVariant } from './fallback-templates.js';

const KEBAB_KEY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const FORMATS = Object.freeze(['scenario', 'direct']);

// Probe seeds for the commit-time self-proof: enough spread to exercise
// every pool a few times per variant; the spec test sweeps far wider (≥25).
const PROBE_SEEDS = Object.freeze([1, 2, 3].flatMap((checkpointOrdinal) => [
  { neumaId: 'spec-probe-a', neumaName: 'Probe', checkpointOrdinal, nonce: 0 },
  { neumaId: 'spec-probe-b', neumaName: 'Probe', checkpointOrdinal, nonce: 1 },
]));

/**
 * Validate a spec object's own integrity — including the self-proof that
 * every committed fallback template renders into a question that passes the
 * validator for its own dimension. Pure; returns data, never throws.
 * @param {Object} spec
 * @returns {{ok: boolean, errors: Array<{code: string, key?: string, detail: string}>}}
 */
export function validateSpec(spec) {
  const errors = [];
  const push = (code, key, detail) =>
    errors.push(Object.freeze({ code, ...(key != null && { key }), detail }));

  if (!Number.isInteger(spec?.specVersion) || spec.specVersion < 1) {
    push('SPEC_VERSION_INVALID', null, 'specVersion must be a positive integer');
  }
  const closers = spec?.global?.closers;
  if (!Array.isArray(closers) || closers.length === 0
    || closers.some((c) => typeof c !== 'string' || !c.trim())) {
    push('SPEC_CLOSERS_INVALID', null, 'global.closers must be a non-empty array of non-empty strings');
  }
  const dimensions = spec?.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    push('SPEC_DIMENSIONS_EMPTY', null, 'dimensions must be a non-empty array');
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }

  const seen = new Set();
  for (const dimension of dimensions) {
    const key = dimension?.key;
    if (typeof key !== 'string' || !KEBAB_KEY.test(key)) {
      push('SPEC_KEY_INVALID', key, `'${key}' is not a kebab-case key`);
      continue;
    }
    if (seen.has(key)) {
      push('SPEC_KEY_DUPLICATE', key, `'${key}' declared more than once`);
      continue;
    }
    seen.add(key);
    if (!FORMATS.includes(dimension.format)) {
      push('SPEC_FORMAT_INVALID', key, `format '${dimension.format}' not in ${FORMATS.join('|')}`);
    }
    if (typeof dimension.intent !== 'string' || !dimension.intent.trim()) {
      push('SPEC_INTENT_INVALID', key, 'intent must be a non-empty string');
    }
    const { minChars, maxChars } = dimension.rules || {};
    if (!Number.isInteger(minChars) || !Number.isInteger(maxChars)
      || minChars <= 0 || minChars >= maxChars) {
      push('SPEC_LENGTH_BOUNDS_INVALID', key, `need 0 < minChars < maxChars, got ${minChars}/${maxChars}`);
    }
    const templates = dimension.fallbackTemplates;
    if (!Array.isArray(templates) || templates.length < 3
      || templates.some((t) => typeof t !== 'string' || !t.includes('{closer}') || !t.includes('{name}'))) {
      push('SPEC_TEMPLATES_INSUFFICIENT', key,
        'every dimension needs >= 3 fallback templates, each carrying {name} and {closer}');
      continue;
    }
    // Self-proof: a spec cannot ship a fallback that fails its own rules.
    for (let variant = 0; variant < templates.length; variant++) {
      for (const seed of PROBE_SEEDS) {
        let question;
        try {
          question = renderFallbackQuestionVariant(spec, key, seed, variant);
        } catch (err) {
          push('SPEC_TEMPLATE_RENDER_THREW', key, `variant ${variant}: ${err.message}`);
          continue;
        }
        const verdict = validateRenderedSet(spec, {
          specVersion: spec.specVersion,
          neumaName: seed.neumaName,
          questions: [question],
        }, 'question');
        if (!verdict.ok) {
          push('SPEC_TEMPLATE_FAILS_OWN_RULES', key, `variant ${variant} (seed ${
            seed.neumaId}:${seed.checkpointOrdinal}:${seed.nonce}): ${
            verdict.errors.map((e) => e.code).join(', ')}`);
        }
      }
    }
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

