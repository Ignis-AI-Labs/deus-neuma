/**
 * Attunement question generation on the LIVE substrate (gnosis).
 *
 * The generator's retry loop, extraction, validation, and fallback
 * substitution are proven here against the REAL provider and the REAL loaded
 * model — the exact production path (the question leg is a neutral
 * createStreamRequest pass with no persona and no LoRA, so this test IS what
 * a ceremony runs). No being is involved, no workspace is created, nothing
 * is summoned — this is a generator test, fully outside the birth-protocol
 * territory.
 *
 * The test does NOT require zero fallbacks: a part-model, part-fallback set
 * is the design working honestly. It asserts the set VALIDATES and logs the
 * model/fallback split so gnosis accumulates run over run (one green run ≠
 * knowing a stochastic path — the sampling-distributions doctrine).
 *
 * Gate: runs only when a local substrate genuinely serves a model — either
 * shape (backend-supervised llama-server, or LM Studio) via
 * test/helpers/live-substrate.js.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { setConfig } from '../../backend/services/llm-provider.js';
import { generateQuestionSet } from '../../backend/services/attunement-generator.js';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import { validateRenderedSet } from '../../core/attunement/question-validator.js';
import { probeLiveSubstrate } from '../helpers/live-substrate.js';

const live = await probeLiveSubstrate();
const liveRoute = live
  ? Object.freeze({ provider: live.provider, endpoint: live.endpoint, model: live.model })
  : null;

describe.skipIf(!live)('attunement generation — the real model renders, the real validator judges', () => {
  beforeAll(() => {
    setConfig({ provider: live.provider, endpoint: live.endpoint, model: live.model, apiKey: '' });
  });

  test('the core proof: a full set renders CONCURRENTLY, validates whole, and carries honest provenance', async () => {
    const progress = [];
    const set = await generateQuestionSet(ATTUNEMENT_SPEC, {
      neumaName: 'Rehearsal', neumaId: 'rehearsal-live', checkpointOrdinal: 1,
      priorQuestionTexts: [], route: liveRoute,
      onDimension: (p) => progress.push({ ...p }),
    });

    // the pool (default 6 in flight) must hand back SPEC order regardless of
    // completion order. onDimension is the IN-FLIGHT lens (bc58afaf7): it
    // fires on render START (done unchanged, inFlight up) AND on completion
    // (done up) — so COMPLETIONS are the events where `done` increments, and
    // those must count 1..N exactly once each; every event's done+inFlight
    // must stay within the set.
    expect(set.questions.map((q) => q.key)).toEqual(ATTUNEMENT_SPEC.dimensions.map((d) => d.key));
    const completions = progress
      .map((p) => p.done)
      .filter((d, i, arr) => i === 0 ? d > 0 : d > arr[i - 1]);
    expect(completions).toEqual(
      Array.from({ length: ATTUNEMENT_SPEC.dimensions.length }, (_, i) => i + 1));
    for (const p of progress) {
      expect(p.inFlight).toBeGreaterThanOrEqual(0);
      expect(p.done + p.inFlight).toBeLessThanOrEqual(ATTUNEMENT_SPEC.dimensions.length);
    }

    const verdict = validateRenderedSet(ATTUNEMENT_SPEC, {
      specVersion: set.specVersion, neumaName: 'Rehearsal',
      questions: set.questions.map((q) => ({ key: q.key, text: q.text })),
    }, 'set');
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);

    let model = 0; let fallback = 0;
    for (const q of set.questions) {
      expect(['model', 'fallback']).toContain(q.provenance.renderer);
      expect(q.provenance.attempts.length).toBeGreaterThan(0);
      if (q.provenance.renderer === 'model') model += 1; else fallback += 1;
      // failures are recorded, never retconned
      for (const a of q.provenance.attempts.slice(0, -1)) {
        expect(a.outcome).toBe('rejected');
        expect(a.errors.length).toBeGreaterThan(0);
      }
    }
    // gnosis evidence: log the split for the accumulating record
    console.warn(`[gnosis] attunement generation on ${live.model} via ${live.provider}: ${model} model-rendered, ${fallback} fallback — ${
      set.questions.map((q) => `${q.key}:${q.provenance.renderer}(${q.provenance.attempts.length})`).join(' ')}`);
  }, 3600000); // 89 dimension renders at v2 scale (pooled, default 6 in flight), one real model call each (plus retries)

  test('avoid-list probe: a second run given the first run\'s texts completes and validates', async () => {
    const first = await generateQuestionSet(ATTUNEMENT_SPEC, {
      neumaName: 'Rehearsal', neumaId: 'rehearsal-live', checkpointOrdinal: 1,
      priorQuestionTexts: [], route: liveRoute,
    });
    const second = await generateQuestionSet(ATTUNEMENT_SPEC, {
      neumaName: 'Rehearsal', neumaId: 'rehearsal-live', checkpointOrdinal: 2,
      priorQuestionTexts: first.questions.map((q) => q.text),
      route: liveRoute,
    });
    const verdict = validateRenderedSet(ATTUNEMENT_SPEC, {
      specVersion: second.specVersion, neumaName: 'Rehearsal',
      questions: second.questions.map((q) => ({ key: q.key, text: q.text })),
    }, 'set');
    expect(verdict.ok).toBe(true);
    // Non-repetition is stochastic — both sets are logged for human review;
    // asserting more would dress belief as knowledge.
    console.warn(`[gnosis] second-run renderers: ${second.questions.map((q) => q.provenance.renderer).join(',')}`);
  }, 7200000); // two full 89-dimension sets back to back
});

describe.skipIf(live)('attunement generation live — no conduit', () => {
  test.skip('no local substrate serving (llama-server or LM Studio) — live generation unproven this run', () => {});
});
