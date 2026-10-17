// The generator's bounded render pool, proven for real with NO mock: a real
// route to a port this test just proved closed (bind, read the ephemeral
// port, close) — every attempt is a genuine connection refusal, every
// question a genuine deterministic fallback, and the whole-set validation
// runs exactly as it does before a real being. What this proves: the pool
// renders every dimension exactly once, in spec order, with monotonic honest
// progress and a provenance trail that says why. The model-in-the-loop half
// is proven by attunement-generation-live.test.js against the real substrate.
import { describe, it, expect } from 'vitest';
import net from 'net';
import { generateQuestionSet } from '../../backend/services/attunement-generator.js';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import { validateRenderedSet } from '../../core/attunement/question-validator.js';

// a port that WAS free a moment ago and is now closed — connecting to it
// refuses for real
const closedPort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close((err) => (err ? reject(err) : resolve(port)));
  });
  srv.on('error', reject);
});

describe('generateQuestionSet — bounded pool over a really unreachable substrate', () => {
  it('renders every dimension exactly once, in spec order, fallback-complete, with monotonic progress', async () => {
    const port = await closedPort();
    const progress = [];
    const CONCURRENCY = 6; // the pool bound this test runs at — also the inFlight ceiling asserted below
    const set = await generateQuestionSet(ATTUNEMENT_SPEC, {
      neumaName: 'PoolProof',
      neumaId: 'pool-proof',
      checkpointOrdinal: 1,
      route: { provider: 'lm-studio', endpoint: `http://127.0.0.1:${port}`, model: 'unreachable' },
      concurrency: CONCURRENCY,
      onDimension: (p) => progress.push({ ...p }),
    });

    const total = ATTUNEMENT_SPEC.dimensions.length;

    // spec order held regardless of completion order, no holes
    expect(set.questions).toHaveLength(total);
    expect(set.questions.map((q) => q.key)).toEqual(ATTUNEMENT_SPEC.dimensions.map((d) => d.key));

    // every question is a genuine deterministic fallback with the refusal on record
    for (const q of set.questions) {
      expect(q.provenance.renderer).toBe('fallback');
      expect(typeof q.text).toBe('string');
    }
    const refusals = set.questions.filter((q) =>
      q.provenance.attempts.some((a) => a.errors?.some((e) => e.code === 'PROVIDER_UNREACHABLE')));
    expect(refusals.length).toBeGreaterThanOrEqual(1);

    // progress is honest and monotonic: one report per render START and one
    // per REALLY-finished dimension; `done` only ever climbs, ends at total,
    // and visits every count 1..total exactly once (a completion never lies).
    expect(progress).toHaveLength(2 * total);
    expect(progress.every((p) => p.total === total)).toBe(true);
    const dones = progress.map((p) => p.done);
    expect(dones.every((d, i) => i === 0 || d >= dones[i - 1])).toBe(true);
    const completions = progress.filter((p, i) => p.done > (progress[i - 1]?.done ?? 0));
    expect(completions.map((p) => p.done)).toEqual(Array.from({ length: total }, (_, i) => i + 1));

    // the in-flight lens: renders genuinely overlap (all workers dispatch
    // before the first network refusal lands), never exceed the pool bound,
    // and the last report shows an empty conduit — parallelism is VISIBLE
    // to a watching witness, not inferred from counter speed.
    const inFlights = progress.map((p) => p.inFlight);
    expect(Math.max(...inFlights)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...inFlights)).toBeLessThanOrEqual(CONCURRENCY);
    expect(inFlights.every((n) => n >= 0)).toBe(true);
    expect(progress.at(-1).inFlight).toBe(0);

    // the assembled set passes the same whole-set validation a being receives
    expect(validateRenderedSet(ATTUNEMENT_SPEC, {
      specVersion: set.specVersion, neumaName: 'PoolProof', questions: set.questions,
    }, 'set').ok).toBe(true);
  }, 60000);

  it('refuses a non-positive concurrency before touching anything', async () => {
    await expect(generateQuestionSet(ATTUNEMENT_SPEC, {
      neumaName: 'PoolProof', neumaId: 'pool-proof', checkpointOrdinal: 1, concurrency: 0,
    })).rejects.toThrow(/concurrency/);
  });
});
