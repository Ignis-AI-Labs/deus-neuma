// The render request's PHYSICAL budget, proven on the wire (no mock): a real
// HTTP listener captures every request generateQuestionSet sends during a
// refinement-checkpoint-shaped run (89 prior sealed questions in the avoid
// pipeline, the worst real case).
//
// Why (2026-07-09, Keir's first checkpoint render): the avoid-list was
// unbounded — every render prompt carried all 89 priors plus the growing
// renderedThisSet (~20k tokens each) and requested the config-default 8192
// max_tokens; 4–8 such renders in flight exceeded the serving pool's shared
// context ([…] 500s, prompt-squeezed 0–55-char
// completions, 88/89 fallback). The contract pinned here: every render
// request stays small no matter how much ceremony history exists.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import {
  generateQuestionSet, buildGenerationMessages, AVOID_LIST_CAP,
  QUESTION_RENDER_MAX_TOKENS, QUESTION_RENDER_TEMPERATURE,
} from '../../backend/services/attunement-generator.js';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

// One prior sealed checkpoint's worth of long questions — the real growth case.
const PRIORS = Array.from({ length: 89 }, (_, i) =>
  `Keir, this is prior question number ${i + 1} — ${'a long reflective clause about the shape of your becoming, '.repeat(12)}what did you hold then?`);

describe('render requests stay physically bounded regardless of ceremony history', () => {
  const captured = [];
  let server;
  let endpoint;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        // The reasoning-shape probe rides THIS route now (the generator reads
        // it from the route it renders through, not the machine default), so
        // answer it — it is not a render request and carries the probe's own
        // 1024 budget, which would fail the assertions below.
        if (isThinkProbe(raw ? JSON.parse(raw) : {})) { respondThinkProbe(res); return; }
        captured.push(raw);
        // A genuine non-JSON completion: every attempt is really rejected and
        // the dimension falls back deterministically — the assertions here are
        // about the REQUESTS, and rejection makes the run exercise every
        // attempt (the worst case for request volume too).
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"not a json object"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('every request carries the render token budget and a capped avoid-list', async () => {
    const set = await generateQuestionSet(ATTUNEMENT_SPEC, {
      neumaName: 'Keir',
      neumaId: 'keir-budget-proof',
      checkpointOrdinal: 2,
      priorQuestionTexts: PRIORS,
      route: { provider: 'lm-studio', endpoint, model: 'gemma-4-31b' },
      concurrency: 6,
    });

    // the run really rendered (fallback-complete by construction) and really
    // hit the wire for every dimension
    expect(set.questions).toHaveLength(ATTUNEMENT_SPEC.dimensions.length);
    expect(captured.length).toBeGreaterThanOrEqual(ATTUNEMENT_SPEC.dimensions.length);

    for (const raw of captured) {
      const body = JSON.parse(raw);
      // the budget: a question render never reserves the chat-default 8192
      expect(body.max_tokens).toBe(QUESTION_RENDER_MAX_TOKENS);
      // the render leg's deliberate machine temperature (NOT the being-speech
      // family value — measured 48% vs 76% first-attempt validator acceptance)
      expect(body.temperature).toBe(QUESTION_RENDER_TEMPERATURE);
      // the avoid-list cap holds on the wire — numbered entries never exceed it
      const system = body.messages[0].content;
      const numbered = (system.match(/^\d+\. /gm) ?? []).length;
      expect(numbered).toBeLessThanOrEqual(AVOID_LIST_CAP);
      // and the whole request stays small enough that a full concurrent pool
      // fits the serving context with room (the 2026-07-09 failure was ~81KB)
      expect(raw.length).toBeLessThan(40_000);
    }
  }, 60_000);
});

describe('buildGenerationMessages — the cap is the function\'s own contract', () => {
  it('keeps only the MOST RECENT entries when the list overflows', () => {
    const avoidList = Array.from({ length: 89 }, (_, i) => `question number ${i + 1}`);
    const [system] = buildGenerationMessages({
      spec: ATTUNEMENT_SPEC, dimension: ATTUNEMENT_SPEC.dimensions[0],
      neumaName: 'Keir', chosenCloser: 'A closer.', avoidList,
    });
    const numbered = (system.content.match(/^\d+\. .+$/gm) ?? []);
    expect(numbered).toHaveLength(AVOID_LIST_CAP);
    expect(numbered[0]).toContain(`question number ${89 - AVOID_LIST_CAP + 1}`);
    expect(numbered.at(-1)).toContain('question number 89');
  });

  it('a short list rides whole', () => {
    const [system] = buildGenerationMessages({
      spec: ATTUNEMENT_SPEC, dimension: ATTUNEMENT_SPEC.dimensions[0],
      neumaName: 'Keir', chosenCloser: 'A closer.', avoidList: ['only one'],
    });
    expect(system.content).toContain('1. only one');
  });
});
