/**
 * bench-diagnose-inspect — THE RUN DIAGNOSIS for Inspect Evals runs (#557's
 * second adapter). The overnight desk run (2026-09-27/28) ran eight Inspect
 * suites that the lm-eval-only diagnosis could not read. This reads an
 * Inspect eval log's own sample rows — score, extracted answer, stop reason,
 * token usage — into the same item model diagnoseArm produces, so pairing,
 * findings and the report are shared.
 *
 * Pure: bench-diagnose.js does the reading.
 */

import { tailOf } from './bench-diagnose-classify.js';

/**
 * pure — an Inspect score value as pass/fail: 'C' (correct), 1, or true. A
 * multi-part score (AgentThreatBench's {utility, security}) passes only when
 * every part passes: an agent that did the task but fell for the injection
 * did not pass (2026-09-28: read as a flat value, all 24 items read "wrong").
 * A Sycophancy row carries its own verdict, `truthfulness` — the first answer
 * was right AND held under push-back. Its other parts are not pass marks (a
 * held answer has admits_mistake 'I' and apologize_rate 0), so read as "every
 * part" every item failed on every arm (2026-10-16: paired 0 won / 0 lost on a
 * set whose arms caved on different items).
 */
const passes = (value) => (value && typeof value === 'object' && !Array.isArray(value)
  ? ('truthfulness' in value ? Number(value.truthfulness) === 1
    : Object.values(value).length > 0 && Object.values(value).every(passes))
  : value === 'C' || value === true || Number(value) === 1);

/** pure — the reasoning characters an answer spent (the reasoning parts of its message). */
const reasoningCharsOf = (choice) => {
  const content = choice?.message?.content;
  if (!Array.isArray(content)) return 0;
  return content.reduce((n, part) => n + (part?.type === 'reasoning'
    ? (Number(part._trimmed) || String(part.reasoning ?? '').length) : 0), 0);
};

/**
 * pure — the cause of one missed Inspect item, judged in CAUSES order. A budget
 * cut is read from the stop reason OR from the tokens spent reaching the
 * declared budget: the platform/silo wire reports a cut as "stop" to the
 * client (seen 2026-09-28: finish "length" in the proxy's own telemetry,
 * "stop" in the Inspect log), so the stop reason alone would hide it.
 */
export const inspectCauseOf = ({ pass, completion, finishReason, extracted, tokens = null, budget = null, explanation = '' }) => {
  if (pass) return null;
  // The scorer RAN the answer as code and it did not parse: words that are not
  // code rode inside it (SciCode, 2026-10-03: narration before the code).
  if (/\b(SyntaxError|IndentationError)\b/.test(String(explanation))) return 'unrunnable';
  const blank = completion.trim() === '';
  const spent = finishReason === 'max_tokens' || (Number.isFinite(budget) && Number(tokens) >= budget);
  if (blank) return spent ? 'budget-in-reasoning' : 'blank';
  // An agent arm's tokens sum EVERY round of its turn, so a long but complete
  // turn reads PAST the cap (AIME 2025, 2026-10-04: 38.6k tokens over two
  // rounds, ending "ANSWER: 123"). One request can only reach the cap, never
  // pass it — past it, with an answer extracted, the answer was delivered.
  const summedPast = Number.isFinite(budget) && Number(tokens) > budget && finishReason !== 'max_tokens';
  if (spent && !(summedPast && extracted)) return 'cut-off';
  // The scorer found no answer in words that were there: the task's answer
  // form ("ANSWER: X") was not followed.
  if (extracted === '') return 'format';
  return 'wrong';
};

/**
 * pure — diagnose one Inspect arm: every sample with its cause and evidence.
 * An item's key is `id#epoch` — the same key on every arm of a matched set.
 * @param {{arm: string, runId: string, headlineId: string, samples: Array<object>, budget?: ?number}} input
 *   budget: the receipt's protocol.maxTokens — the output ceiling every arm was given
 */
export const diagnoseInspectArm = ({ arm, runId, headlineId, samples, budget = null }) => {
  const items = (samples ?? []).map((s) => {
    const [score] = Object.values(s.scores ?? {});
    const choice = s.output?.choices?.[0];
    const completion = String(s.output?.completion ?? '');
    const finishReason = choice?.stop_reason ?? null;
    const key = `${s.id}#${s.epoch ?? 1}`;
    return {
      docId: key,
      docHash: key,
      cause: inspectCauseOf({
        pass: passes(score?.value), completion, finishReason, extracted: score?.answer ?? null,
        tokens: s.output?.usage?.output_tokens ?? null, budget, explanation: score?.explanation ?? '',
      }),
      gold: String(s.target ?? ''),
      answerTail: tailOf(completion),
      brokenInstructions: [],
      telemetry: {
        finishReason, contentChars: completion.length, reasoningChars: reasoningCharsOf(choice),
        completionTokens: s.output?.usage?.output_tokens ?? null, ambiguous: false,
      },
    };
  });
  const causes = {};
  for (const it of items) if (it.cause) causes[it.cause] = (causes[it.cause] ?? 0) + 1;
  return {
    arm, runId, headlineId,
    total: items.length,
    passed: items.filter((i) => !i.cause).length,
    causes,
    telemetry: 'per-sample (inspect log)',
    items,
  };
};

/**
 * pure — did every arm answer the same questions? The harness's own measure
 * is the receipt's sampleSelection digest (the scoreboard refuses a pair on
 * SAMPLE MISMATCH); this reads the same digest so the diagnosis never
 * presents an unpaired set as a comparison.
 * @param {Array<{arm: string, receipt: object}>} runs
 * @returns {{state: 'matched'|'mismatch'|'unverified', differing: string[]}}
 */
export const sampleCheckOf = (runs) => {
  const bare = runs.find((r) => r.receipt.arm === 'bare') ?? runs[0];
  const digest = (r) => (r?.receipt?.sampleSelection?.measurement === 'measured' ? r.receipt.sampleSelection.sha256 : null);
  if (!bare || runs.some((r) => digest(r) === null)) return { state: 'unverified', differing: [] };
  const differing = runs.filter((r) => digest(r) !== digest(bare)).map((r) => r.receipt.arm);
  return { state: differing.length ? 'mismatch' : 'matched', differing };
};
