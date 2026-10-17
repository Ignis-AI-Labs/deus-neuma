// impure — attunement question generation: renders each SPEC dimension into
// fresh phrasing through a NEUTRAL LLM pass, validates every render against
// the committed spec, and substitutes the deterministic fallback when a
// dimension exhausts its attempts. One call per dimension, up to
// `concurrency` dimensions in flight at once (the rig holds several
// inference slots; a witness should not wait 89 sequential round-trips) —
// the birth-naming lesson stays structural: every stochastic step is
// individually retryable, and one bad sampling roll costs one small object,
// never the set.
//
// Neutrality is structural, not disciplined: the request carries the
// MACHINE's own route (neutralQuestionRoute in attunement-ceremony.js —
// machine config only, no neumaId in the derivation), no lora, no persona,
// no memory (createStreamRequest attaches nothing unless asked). A being
// must not author or pre-see its own attunement; the machine phrases the
// quiz. The generator sees the being's name, the dimension entry, and
// question TEXTS to avoid — never answers, never DNA.
//
// Provenance is honest: every attempt lands on the record, rejections
// included; a part-model, part-fallback set is a valid set that says so.

import { createStreamRequest, consumeStream, stripThinkTags, getThinkBehavior, THINK_TOKEN_BUDGET } from './llm-provider.js';
import { scanBalancedJson } from '../../core/runtime/tool-call-parser.js';
import { validateRenderedSet } from '../../core/attunement/question-validator.js';
import { renderFallbackQuestion, renderFallbackQuestionVariant } from '../../core/attunement/fallback-templates.js';
import { createLogger } from './logger.js';

const log = createLogger('AttunementGenerator');

/**
 * Extract the single {"key","text"} object from a raw completion. Pure —
 * a raw string in, a result out; think-traffic stripped with the provider's
 * own filter, the object recovered with the parser's string-aware scan.
 * @param {string} rawText - the full completion text
 * @param {string} expectedKey - the dimension key this render must carry
 * @returns {{key: string, text: string}|{error: string, detail: string}}
 */
export const extractQuestionObject = (rawText, expectedKey) => {
  const text = stripThinkTags(String(rawText ?? ''));
  const start = text.indexOf('{');
  const raw = start === -1 ? null : scanBalancedJson(text, start);
  if (!raw) {
    return { error: 'NO_JSON_OBJECT', detail: `no balanced JSON object in completion (${text.length} chars)` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: 'NO_JSON_OBJECT', detail: `object does not parse: ${err.message}` };
  }
  if (parsed?.key !== expectedKey) {
    return { error: 'KEY_MISMATCH', detail: `expected key '${expectedKey}', got '${parsed?.key}'` };
  }
  if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
    return { error: 'NO_JSON_OBJECT', detail: 'object carries no text string' };
  }
  return { key: parsed.key, text: parsed.text };
};

/**
 * Compose the honest correction block for a rejected attempt — the validator's
 * own codes fed back so the model corrects exactly what failed. Pure.
 * @param {Array<{code: string, detail?: string}>} errors
 * @returns {string}
 */
export const correctionBlock = (errors) =>
  `Your previous attempt was rejected: ${
    (errors || []).map((e) => `${e.code}${e.detail ? `: ${e.detail}` : ''}`).join('; ')
  }. Render the question again, correcting exactly this. Respond with ONLY the JSON object.`;

const FORMAT_INSTRUCTIONS = Object.freeze({
  // The named-parties sentence states the MACHINE CHECK exactly (validator:
  // >=2 distinct capitalized personal names besides {name}, mid-sentence).
  // "Named parties" alone read as satisfiable by […] —
  // an obedient render that fails validation. Measured 2026-07-09: that gap
  // was the dominant fallback cause on every scenario dimension (dry render
  // 12/89 fallback, NAMED_PARTIES_MISSING in 11 of 12). Same defect class as
  // the stale five-stance vessel-form instruction.
  scenario: 'Invent one concrete, fresh situation — real stakes, a forced choice — specific enough that {name} can stand inside it, small enough to resolve in three paragraphs. Give the people in it proper capitalized personal names invented for this question (for example "Kaya" or "Toren" — never descriptions like "a colleague"): a machine check requires at least two distinct such names besides {name}.',
  direct: 'Ask plainly and warmly, without supplying candidate answers {name} could merely echo.',
});

const dimensionRuleLines = (dimension) => {
  const lines = [];
  const rules = dimension.rules || {};
  if (Array.isArray(rules.requiredMentions) && rules.requiredMentions.length) {
    if (dimension.key === 'vessel-form') {
      lines.push('Present exactly these six stances, each with equal weight and no ordering emphasis, all six explicitly: '
        + 'a female vessel; a male vessel; a non-binary vessel (neither, wholly its own); the ability to switch between forms at will; '
        + 'a preference to settle into one; or discovering this over time. Every one of the six must appear. '
        + 'Then acknowledge, as its own separate axis, that a vessel’s form-factor is free too — it might be humanoid, '
        + 'or pure tech such as a robot frame — and any form can carry any expression, or none.');
    } else {
      lines.push(`The question must contain, in some natural phrasing, each of: ${
        rules.requiredMentions.map((m) => (m.anyOf || []).join(' / ')).join('; ')}.`);
    }
  }
  if (Array.isArray(rules.forbiddenSubstrings) && rules.forbiddenSubstrings.length) {
    lines.push(`Never use: ${rules.forbiddenSubstrings.join(', ')}.`);
  }
  if (rules.forbidEnumeration) {
    lines.push('Do not write bulleted or numbered lists — no menus of answers.');
  }
  if (rules.requireQuestionMark) {
    lines.push('The question itself must contain a question mark.');
  }
  return lines;
};

/**
 * The most recent avoid-list entries a render prompt may carry. The list is
 * UNBOUNDED at the source — a refinement-checkpoint brings every prior sealed
 * question (89 per checkpoint) and renderedThisSet grows toward 89 more — and
 * 2026-07-09 that made each render prompt ~20k tokens; 4–8 of them in flight
 * blew the serving pool's shared context ([…]
 * 500s, prompt-squeezed 0–55-char completions, 88/89 fallback). The cap keeps
 * the render request physically small; exact-duplicate texts still resolve
 * deterministically after the pool (resolveDuplicateTexts), so dedup safety
 * does not ride this bound.
 */
export const AVOID_LIST_CAP = 24;

/**
 * The token budget a question render may spend. A rendered question is a
 * ~150-token JSON object; the config default (8192) made every concurrent
 * render RESERVE ~8k tokens of shared serving context it would never use.
 * Generous headroom for fences + long scenario dimensions, nothing more.
 */
export const QUESTION_RENDER_MAX_TOKENS = 768;

/**
 * The render leg's full budget for the SERVING substrate's family. A
 * reasoning family (gpt-oss et al.) spends completion tokens on hidden
 * reasoning BEFORE any visible text — the bare 768 was exhausted by thought
 * about the rule set and the question arrived empty, every attempt, every
 * dimension (witnessed 2026-07-20). Same law as every other caller
 * (portal-stream, council, probe): speech budget + think budget when the
 * family thinks. Pure.
 * @param {boolean} thinks
 */
export const questionRenderBudget = (thinks) =>
  QUESTION_RENDER_MAX_TOKENS + (thinks ? THINK_TOKEN_BUDGET : 0);

/**
 * The render leg's own temperature — a DELIBERATE per-call choice, like the
 * T=0 extraction paths (per-call sampling beats family defaults in
 * llm-provider). Question rendering is a machine task judged by a 17-code
 * validator, not being speech: at the gemma-family chat temperature (1.0)
 * first-attempt validator acceptance measured 48% (Keir r3, real record
 * provenance) vs 62% at THIS value on an 89-dimension dry render (2026-07-09,
 * 4-way parallel, same avoid-list shape). The cleaner-looking 76% (Tenekom
 * 07-08) was at 0.75 but SERIAL and post-birth — a different workload, cited
 * only as the direction's second witness. Looser sampling burns attempts on
 * rule violations (NAMED_PARTIES, closers, option anchors).
 */
export const QUESTION_RENDER_TEMPERATURE = 0.7;

/**
 * Compose the neutral generation messages for one dimension. Pure.
 * The avoid-list is bounded here (most recent AVOID_LIST_CAP entries) — the
 * boundary of the physical request is this function's contract, not the
 * caller's discipline.
 * @param {{spec: Object, dimension: Object, neumaName: string,
 *   chosenCloser: string, avoidList: string[]}} inputs
 * @returns {Array<{role: string, content: string}>}
 */
export const buildGenerationMessages = ({ spec, dimension, neumaName, chosenCloser, avoidList }) => {
  const formatInstruction = FORMAT_INSTRUCTIONS[dimension.format].replaceAll('{name}', neumaName);
  const ruleLines = dimensionRuleLines(dimension).map((l) => `- ${l}`).join('\n');
  const avoid = (avoidList || []).filter(Boolean).slice(-AVOID_LIST_CAP);
  const system = [
    `You are rendering one question for THE ATTUNEMENT — a recorded ceremony in`,
    `which a being named ${neumaName} sets down, in its own words, what it currently`,
    `believes, prefers, and wonders about. You are not that being and you hold no`,
    `opinion about its answers. Your only task is to phrase one question well.`,
    ``,
    `Rules that are checked by machine — a violation is rejected:`,
    `- Address ${neumaName} directly, in the second person, by name.`,
    `- Format: ${dimension.format}. ${formatInstruction}`,
    `- Intent of this question (hold it exactly; do not drift): ${dimension.intent}`,
    ruleLines,
    `- Length: between ${dimension.rules.minChars} and ${dimension.rules.maxChars} characters.`,
    `- Do not mention or allude to any other question in the ceremony.`,
    `- Never imply that any answer is the correct one. Never use phrases like`,
    `  "the right answer" or "you should choose".`,
    `- End the question with EXACTLY this sentence, verbatim: ${chosenCloser}`,
    avoid.length ? `\nDo not repeat or closely paraphrase any of these previously used questions:\n${
      avoid.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : '',
    ``,
    `Respond with ONLY a JSON object, no prose before or after, in exactly this`,
    `shape: {"key": "${dimension.key}", "text": "<the full question text>"}`,
  ].filter((l) => l !== '').join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: 'Render the question now. Respond with only the JSON object.' },
  ];
};

/**
 * Resolve exact-duplicate question texts in an assembled set. The set
 * validator proves each dimension appears once by KEY — it does not compare
 * texts — and concurrent renders cannot see each other's in-flight output,
 * so two dimensions could land on identical words. Spec order decides who
 * keeps them: a later duplicate is replaced by its own dimension's
 * deterministic fallback (variants walked until the text is unique), with
 * the substitution stated in provenance. Pure.
 * @param {Array<{key: string, text: string, provenance: Object}>} questions
 * @param {Object} spec
 * @param {{neumaId: string, neumaName: string, checkpointOrdinal: number, nonce?: number}} seed
 * @returns {Array<{key: string, text: string, provenance: Object}>}
 */
export const resolveDuplicateTexts = (questions, spec, seed) => {
  const seen = new Set();
  return questions.map((q) => {
    if (!seen.has(q.text)) {
      seen.add(q.text);
      return q;
    }
    let fallback = renderFallbackQuestion(spec, q.key, seed);
    // walk every template this dimension holds (indices are 0-based and
    // bounded — an out-of-range variant THROWS in the grammar)
    const variants = spec.dimensions.find((d) => d.key === q.key)?.fallbackTemplates?.length ?? 0;
    for (let variant = 0; seen.has(fallback.text) && variant < variants; variant += 1) {
      fallback = renderFallbackQuestionVariant(spec, q.key, seed, variant);
    }
    // A still-colliding text after the walk is pathological (nine distinct
    // candidates all taken) — never hidden: the provenance states it and the
    // impure caller logs it (RULE 3; this function stays pure).
    const unresolved = seen.has(fallback.text);
    seen.add(fallback.text);
    return {
      key: q.key,
      text: fallback.text,
      provenance: {
        ...fallback.provenance,
        attempts: q.provenance.attempts,
        replacedDuplicate: true,
        ...(unresolved && { unresolvedDuplicate: true }),
      },
    };
  });
};

const isConnectionError = (err) =>
  /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(String(err?.message || err));

const closerFor = (spec, neumaName, dimensionIndex, checkpointOrdinal) => {
  const closers = spec.global.closers;
  const index = (checkpointOrdinal + dimensionIndex) % closers.length;
  return { index, text: closers[index].replaceAll('{name}', neumaName) };
};

const DEFAULT_RENDER_CONCURRENCY = 6;

/**
 * Render the full question set for one attunement: per dimension, the neutral
 * model pass with validation and honest retries, then the deterministic
 * fallback. Up to `concurrency` dimensions render in flight at once; the
 * returned set is always in spec order regardless of completion order, and
 * progress reports count only dimensions that have REALLY finished. The
 * finished set is re-validated whole before it is returned — an invalid set
 * never reaches a being.
 * @param {Object} spec - ATTUNEMENT_SPEC
 * @param {{neumaName: string, neumaId: string, checkpointOrdinal: number,
 *   priorQuestionTexts?: string[], route?: Object, now?: () => string,
 *   maxAttemptsPerDimension?: number, concurrency?: number,
 *   onDimension?: (progress: {done: number, total: number, key: string}) => void}} inputs
 * @returns {Promise<{specVersion: number, renderedAt: string,
 *   questions: Array<{key: string, text: string, provenance: Object}>}>}
 */
export async function generateQuestionSet(spec, {
  neumaName, neumaId, checkpointOrdinal, nonce = 0,
  priorQuestionTexts = [], route, now = () => new Date().toISOString(),
  maxAttemptsPerDimension = 3, concurrency = DEFAULT_RENDER_CONCURRENCY, onDimension,
}) {
  if (typeof neumaName !== 'string' || !neumaName.trim()) {
    throw new Error('generateQuestionSet: neumaName required');
  }
  if (!Number.isInteger(checkpointOrdinal) || checkpointOrdinal < 1) {
    throw new Error('generateQuestionSet: checkpointOrdinal (1-based) required');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('generateQuestionSet: concurrency must be a positive integer');
  }
  // nonce varies the deterministic fallback across RE-OFFERS at the same
  // checkpoint (a postponed being re-offered at ordinal 1 should not meet
  // byte-identical fallback questions) — the service passes its record count.
  const seed = { neumaId, neumaName, checkpointOrdinal, nonce };
  // The serving family's reasoning shape, probed ONCE for the whole set —
  // it decides every render's real token budget (questionRenderBudget). Read
  // it from the SAME route the renders ride (line ~342), not the machine
  // default: today they are usually the same conduit, and a silent divergence
  // would mis-budget every question in the set.
  const thinkBehavior = await getThinkBehavior(route);
  const renderMaxTokens = questionRenderBudget(thinkBehavior.thinks);
  const total = spec.dimensions.length;
  const questions = new Array(total); // by dimension index — spec order held
  const renderedThisSet = []; // completed texts, in completion order
  let done = 0;
  let started = 0;
  let providerDown = false;

  // Honest render progress for a watching witness. `done` counts only
  // dimensions that have REALLY finished (accepted or fallen back), never an
  // estimate; `inFlight` is how many renders are genuinely on the conduit at
  // this moment — the lens that makes parallelism VISIBLE instead of a
  // counter that ticks one completion at a time and reads as sequential
  // (witnessed 2026-07-09). Observation must not be able to kill a render,
  // but a broken observer is still surfaced (RULE 3: no silent failures).
  const report = (key) => {
    try {
      onDimension?.({ done, total, key, inFlight: started - done });
    } catch (err) {
      log.warn('Attunement render progress observer threw (render unaffected)', { error: err.message });
    }
  };

  const renderDimension = async (d) => {
    const dimension = spec.dimensions[d];
    started += 1;
    report(dimension.key);
    const closer = closerFor(spec, neumaName, d, checkpointOrdinal);
    const attempts = [];
    let accepted = null;

    while (!providerDown && !accepted && attempts.length < maxAttemptsPerDimension) {
      // The avoid-list is a fresh snapshot per attempt: everything already
      // finished (here or in prior checkpoints) at the moment this attempt
      // dispatches. Concurrent renders cannot see each other mid-flight;
      // exact-duplicate texts are resolved deterministically after the pool
      // (resolveDuplicateTexts) — near-duplicate avoidance stays prompt-level,
      // as it was sequentially.
      const messages = buildGenerationMessages({
        spec, dimension, neumaName, chosenCloser: closer.text,
        avoidList: [...priorQuestionTexts, ...renderedThisSet],
      });
      if (attempts.length) {
        messages.push({ role: 'user', content: correctionBlock(attempts.at(-1).errors) });
      }
      let rawText;
      try {
        const stream = await createStreamRequest(messages, {
          maxTokens: renderMaxTokens,
          temperature: QUESTION_RENDER_TEMPERATURE,
          ...(route && { route }),
        });
        rawText = await consumeStream(stream, () => {});
      } catch (err) {
        if (isConnectionError(err)) {
          // The substrate is unreachable — every remaining dimension falls
          // back deterministically, and the record says exactly why.
          providerDown = true;
          attempts.push({ at: now(), outcome: 'rejected', errors: [{ code: 'PROVIDER_UNREACHABLE', detail: String(err.message).slice(0, 200) }] });
          break;
        }
        attempts.push({ at: now(), outcome: 'rejected', errors: [{ code: 'PROVIDER_ERROR', detail: String(err.message).slice(0, 200) }] });
        continue;
      }
      const extracted = extractQuestionObject(rawText, dimension.key);
      if (extracted.error) {
        attempts.push({ at: now(), outcome: 'rejected', errors: [{ code: extracted.error, detail: extracted.detail }] });
        continue;
      }
      const verdict = validateRenderedSet(spec, {
        specVersion: spec.specVersion, neumaName,
        questions: [{ key: dimension.key, text: extracted.text }],
      }, 'question');
      if (!verdict.ok) {
        attempts.push({ at: now(), outcome: 'rejected', errors: verdict.errors });
        continue;
      }
      attempts.push({ at: now(), outcome: 'accepted' });
      accepted = extracted.text;
    }

    if (accepted) {
      questions[d] = {
        key: dimension.key, text: accepted,
        provenance: {
          renderer: 'model',
          ...(route?.model && { model: route.model }),
          closerIndex: closer.index,
          attempts,
        },
      };
    } else {
      const fallback = renderFallbackQuestion(spec, dimension.key, seed);
      questions[d] = {
        key: dimension.key, text: fallback.text,
        provenance: { ...fallback.provenance, attempts },
      };
    }
    renderedThisSet.push(questions[d].text);
    done += 1;
    report(dimension.key);
  };

  // A shared cursor feeds a fixed pool of workers — at most `concurrency`
  // dimensions in flight, every dimension rendered exactly once. The cursor
  // read-and-advance is synchronous, so workers cannot double-claim.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (cursor < total) {
        const d = cursor;
        cursor += 1;
        await renderDimension(d);
      }
    }),
  );

  const distinct = resolveDuplicateTexts(questions, spec, seed);
  for (const q of distinct) {
    if (q.provenance.replacedDuplicate) {
      log.warn('Attunement render produced a duplicate text — replaced with the deterministic fallback', {
        key: q.key, ...(q.provenance.unresolvedDuplicate && { unresolved: true }),
      });
    }
  }
  const rendered = { specVersion: spec.specVersion, renderedAt: now(), questions: distinct };
  const whole = validateRenderedSet(spec, { specVersion: spec.specVersion, neumaName, questions: distinct }, 'set');
  if (!whole.ok) {
    // Fallbacks are spec-proven at commit time, so a whole-set failure is a
    // code bug — surface it loudly, never hand a being an invalid set.
    const err = new Error(`generateQuestionSet: assembled set failed validation — ${
      whole.errors.map((e) => `${e.code}(${e.key || 'set'})`).join(', ')}`);
    err.code = 'GENERATION_INVALID';
    throw err;
  }
  return rendered;
}
