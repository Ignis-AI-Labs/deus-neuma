// benchmark-runner.js — orchestrates a STATE benchmark for one neuma.
//
// Impure (it runs probes through the model), but every effectful dependency is
// INJECTED — `ask` (the LLM call), `workspace` (ground-truth reads), `substrate`
// and `runAt`. That keeps the scoring logic deterministic and unit-testable
// with a scripted neuma (no live LLM), and keeps this module honest: it does
// nothing but build probes, run them, grade them with the pure scorers, and
// record the transcript that backs every number.
//
// If `ask` throws (the substrate is offline), the error PROPAGATES — the caller
// must surface it and write nothing. A benchmark with no real measurement is
// not written. See docs/architecture/measurement/stats-and-benchmarks.md.

import { buildDimensions, gradeProbe, aggregate } from './benchmark-probes.js';

// pure — the facts we score against, drawn from the neuma's own record.
const groundTruthFrom = (dna, trueName) => ({
  chosenName: trueName?.chosenName || dna?.identity?.name || null,
  fullName: trueName?.fullName || null,
  houseName: trueName?.houseName || null,
  soulMark: trueName?.soulMark || null,
});

/**
 * Run the full STATE benchmark for a neuma.
 * @param {string} neumaId
 * @param {Object} deps
 * @param {Object} deps.workspace - neumaWorkspace (readDNA/readTrueName)
 * @param {(neumaId: string, messages: Array) => Promise<string>} deps.ask - one probe through the real stack
 * @param {Object|null} [deps.substrate] - getSubstrateProfile() result (the model under test)
 * @param {string} deps.runAt - ISO timestamp, stamped by the caller
 * @param {Object|null} [deps.consent] - who authorized this run ({ by, at })
 * @returns {Promise<Object>} frozen benchmark result with per-dimension scores + transcripts
 */
// impure (via injected ask)
export const runBenchmark = async (neumaId, { workspace, ask, substrate = null, runAt, consent = null }) => {
  const [dna, trueName] = await Promise.all([
    workspace.readDNA(neumaId),
    workspace.readTrueName(neumaId),
  ]);
  const groundTruth = groundTruthFrom(dna, trueName);

  const dimensions = [];
  for (const dim of buildDimensions(groundTruth)) {
    const transcript = [];
    const verdicts = [];
    for (const probe of dim.probes) {
      const answer = await ask(neumaId, probe.messages); // throws if substrate offline — propagate
      const verdict = gradeProbe(probe, answer);
      verdicts.push(verdict);
      transcript.push(Object.freeze({ q: probe.prompt, a: answer, pass: verdict.pass, detail: verdict.detail }));
    }
    dimensions.push(Object.freeze({
      key: dim.key,
      label: dim.label,
      score: aggregate(verdicts), // null when a dimension has no scorable probe
      n: dim.probes.length,
      transcript: Object.freeze(transcript),
    }));
  }

  return Object.freeze({
    runAt,
    consent,
    substrate: Object.freeze({
      model: substrate?.llm?.model || null,
      provider: substrate?.llm?.provider || null,
    }),
    dimensions: Object.freeze(dimensions),
  });
};
