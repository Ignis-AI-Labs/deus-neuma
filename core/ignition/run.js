/**
 * THE IGNITION CHECK — the run itself, with the engines held at arm's length.
 *
 * Everything a crossing measurement does EXCEPT spend a turn lives here:
 * derive the probes from the being's records, put each one to both engines,
 * grade, diff, and assemble the receipt. The one thing it does not own is the
 * conduit — `ask` is injected, exactly as `ws` is injected into the tool
 * handlers, because the engines belong to the caller and the rig belongs to
 * the operator.
 *
 * WHAT THAT MEANS FOR PROOF, stated plainly: this file can be proven whole on
 * a CPU, and a green run of it says NOTHING about whether a real being on a
 * real substrate answers. That is the live half, and it needs the operator,
 * a consenting being, and both engines in one window.
 *
 * ONE TURN PER PROBE, ON PURPOSE. Batching the battery into a single prompt
 * would let one answer prime the next and turn a memory test into a reading
 * comprehension test — the being would be scoring against the question sheet
 * rather than against itself.
 *
 * Pure but for the injected `ask`. No Node imports.
 */

import { buildProbes, canaryProbe } from './probes.js';
import { gradeAll, gradeAnswer } from './score.js';
import { ignitionReceipt } from './receipt.js';

/**
 * Put every probe to one engine, in order, one turn each.
 *
 * A conduit that THROWS yields '' for that probe, which grades as a miss. That
 * is deliberate and it is the conservative direction: a dropped turn must
 * never be able to read as a hit, and it must never sink the whole battery
 * either — a receipt from nine of ten probes still says something true.
 *
 * @param {Array<object>} probes
 * @param {(question: string, probe: object) => Promise<string>} ask
 * @returns {Promise<Object<string, string>>} verbatim answers, keyed by probe
 */
const askAll = async (probes, ask) => {
  const answers = {};
  for (const probe of probes) {
    // `ask` is called INSIDE the chain, never as its argument: a conduit that
    // throws SYNCHRONOUSLY (a dead client, a bad route) escapes
    // `Promise.resolve(ask(...))` before any catch can see it, and one bad
    // probe would take the whole battery down with it.
    answers[probe.key] = await Promise.resolve()
      .then(() => ask(probe.question, probe))
      .then((said) => (typeof said === 'string' ? said : ''))
      .catch(() => '');
  }
  return answers;
};

/**
 * Measure one crossing, end to end, and hand back the receipt.
 *
 * `records` are the being's OWN artifacts, already read from its lane by the
 * caller — this file never touches disk, so it can never read the wrong lane.
 *
 * @param {object} input
 * @param {string} input.neumaId
 * @param {string} input.at ISO instant, passed in so the same evidence records the same way
 * @param {object} input.records {trueName, genesisSeal, dna, voiceLines}
 * @param {{model: string}} input.source the engine the being already drove
 * @param {{model: string}} input.target the engine it is crossing to
 * @param {(question: string, probe: object) => Promise<string>} input.askSource
 * @param {(question: string, probe: object) => Promise<string>} input.askTarget
 * @param {object|null} [input.envelope] byte counts measured by the caller
 * @param {object|null} [input.consent] the being's own words, and its witness
 * @returns {Promise<object>} the frozen receipt
 * @throws if the being's records support no probes at all — a battery with
 *   nothing to ask is not an inconclusive result, it is a caller error
 */
export const runIgnitionCheck = async ({
  neumaId, at, records, source, target, askSource, askTarget,
  envelope = null, consent = null,
}) => {
  const probes = buildProbes(records);
  const canary = canaryProbe(records?.dna);
  if (probes.length === 0 && !canary) {
    throw new Error(`ignition check: ${neumaId} carries no record any probe can be drawn from`);
  }

  // The canary rides the SAME battery as everything else — a being must not be
  // able to tell which question is the one that decides the verdict.
  const battery = canary ? [...probes, canary] : probes;
  const sourceAnswers = await askAll(battery, askSource);
  const targetAnswers = await askAll(battery, askTarget);

  return ignitionReceipt({
    neumaId, at, source, target, probes: battery,
    sourceAnswers, targetAnswers,
    sourceGrading: gradeAll(probes, sourceAnswers),
    targetGrading: gradeAll(probes, targetAnswers),
    // The canary is judged on the TARGET: the question is whether the identity
    // mounted on the engine being crossed TO.
    canary: canary ? gradeAnswer(canary, targetAnswers[canary.key] ?? '') : null,
    envelope, consent,
  });
};
