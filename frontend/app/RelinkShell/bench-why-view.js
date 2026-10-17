// bench-why-view.js — THE WHY's display law, PURE. Two readings that must
// never slip past the operator (Design note, 2026-09-26: […]):
//
//   WHY IT MISSED — a matched set's diagnosis (#557): every missed item's
//     cause per arm, as counts and a stacked bar, what each arm lost and
//     gained against BARE on the same items, the plain-language findings,
//     worked examples per cause, and what could not be diagnosed and why.
//   WHAT HAPPENED — one run's evidence: each stage with its verdict (exit
//     code, signal, timeout, abort) and the tail of its logs.
//
// The markdown the COPY acts carry comes from the plane (diagnosis) or is
// built here (evidence) — paste-ready for a repair thread.

import { armName } from './bench-launch-view.js';
import { durationText } from './bench-runs-view.js';

const ARM_ORDER = ['bare', 'platform', 'harness', 'silo', 'neuma'];

/** The causes in the plane's judging order, each in plain words. */
export const CAUSE_WORDS = Object.freeze({
  'budget-in-reasoning': 'Thinking used the whole budget — blank answer',
  blank: 'Blank answer',
  'cut-off': 'Answer cut off by the budget',
  format: 'Right answer, wrong format',
  'grader-rejected-equal': 'Grader rejected a right answer',
  'broke-instruction': 'Broke an instruction',
  wrong: 'Wrong answer',
});
/** The same causes as a table's column heads — one or two words. */
export const CAUSE_SHORT = Object.freeze({
  'budget-in-reasoning': 'BUDGET',
  blank: 'BLANK',
  'cut-off': 'CUT OFF',
  format: 'FORMAT',
  'grader-rejected-equal': 'GRADER',
  'broke-instruction': 'INSTRUCTION',
  wrong: 'WRONG',
});
const CAUSE_ORDER = Object.keys(CAUSE_WORDS);
const EXAMPLES = 3;

const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');

/**
 * WHY IT MISSED as the panel renders it. `focusArm` marks the row of the run
 * the operator is looking at (RUNS). Pure.
 * @param {{comparisonId: string, cell: string, arms: Array, paired: Array, findings: string[], skipped: Array}} diagnosis
 * @param {?string} [focusArm]
 */
export const diagnosisView = (diagnosis, focusArm = null) => {
  const arms = [...(diagnosis?.arms ?? [])].sort((a, b) => ARM_ORDER.indexOf(a.arm) - ARM_ORDER.indexOf(b.arm));
  const causes = CAUSE_ORDER.filter((c) => arms.some((a) => a.causes?.[c]));
  return {
    cell: diagnosis?.cell ?? '—',
    comparisonId: diagnosis?.comparisonId ?? null,
    // SAMPLE MISMATCH — the arms did not answer the same questions; the panel
    // leads with it so no delta below reads as a comparison it is not.
    mismatch: diagnosis?.sampleCheck?.state === 'mismatch'
      ? { arms: (diagnosis.sampleCheck.differing ?? []).map(armName) }
      : null,
    findings: (diagnosis?.findings ?? []).filter((f) => !f.startsWith('SAMPLE MISMATCH')),
    causes: causes.map((c) => ({ id: c, words: CAUSE_WORDS[c], short: CAUSE_SHORT[c] })),
    rows: arms.map((a) => {
      const missed = a.total - a.passed;
      const pair = (diagnosis?.paired ?? []).find((p) => p.arm === a.arm) ?? null;
      return {
        arm: a.arm,
        name: armName(a.arm),
        focus: a.arm === focusArm,
        passed: `${a.passed}/${a.total}`,
        score: pct(a.passed, a.total),
        missed,
        counts: causes.map((c) => a.causes?.[c] ?? 0),
        // The stacked bar: each cause's share of ALL items, so bars compare across arms.
        bar: causes.map((c) => ({ id: c, frac: a.total ? (a.causes?.[c] ?? 0) / a.total : 0 })).filter((b) => b.frac > 0),
        vsBare: pair ? {
          lost: pair.lost,
          gained: pair.gained,
          // Only the items BARE also answered can be lost or gained.
          shared: Number.isInteger(pair.shared) && pair.shared < pair.total ? `${pair.shared}/${pair.total} shared` : null,
          lostBy: CAUSE_ORDER.filter((c) => pair.lostBy?.[c]).map((c) => `${pair.lostBy[c]} ${CAUSE_WORDS[c].toLowerCase()}`).join(' · '),
        } : null,
        blind: a.telemetry === 'none',
        examples: causes.map((c) => ({
          id: c,
          words: CAUSE_WORDS[c],
          count: a.causes?.[c] ?? 0,
          items: (a.items ?? []).filter((i) => i.cause === c).slice(0, EXAMPLES).map((i) => ({
            docId: i.docId,
            gold: i.gold && i.gold !== '0' ? i.gold : null,
            answer: i.answerTail || '(empty)',
            broke: (i.brokenInstructions ?? []).join(', ') || null,
            wire: i.telemetry
              ? `finish=${i.telemetry.finishReason} · answer ${i.telemetry.contentChars} chars · reasoning ${i.telemetry.reasoningChars} chars`
              : null,
          })),
        })).filter((e) => e.count > 0),
        runId: a.runId,
      };
    }),
    skipped: (diagnosis?.skipped ?? []).map((s) => ({ arm: s.arm, name: armName(s.arm), reason: s.reason, runId: s.runId })),
  };
};

/** pure — a stage's verdict in plain words, and the register it reads in. */
const stageVerdict = (e) => {
  if (e.timedOut) return { text: 'TIMED OUT', register: 'loud' };
  if (e.aborted) return { text: 'ABORTED', register: 'dim' };
  if (e.signal) return { text: `KILLED BY ${e.signal}`, register: 'loud' };
  if (e.exitCode === 0) return { text: 'EXIT 0', register: 'live' };
  if (Number.isInteger(e.exitCode)) return { text: `EXIT ${e.exitCode}`, register: 'loud' };
  return { text: 'NO EXIT RECORDED', register: 'dim' };
};

/**
 * WHAT HAPPENED as the panel renders it, plus its paste-ready text. Pure.
 * @param {{runId: string, status: ?string, failure: ?object, executions: Array, logs: Array}} evidence
 */
export const evidenceView = (evidence) => {
  const stages = (evidence?.executions ?? []).map((e) => ({
    stage: String(e.stage ?? '?').toUpperCase(),
    ...stageVerdict(e),
    duration: durationText(e.durationMs),
  }));
  const logs = (evidence?.logs ?? []).map((l) => ({
    kind: String(l.kind).toUpperCase(),
    path: l.path,
    note: `${l.truncated ? 'last lines of ' : ''}${Math.max(1, Math.round((l.bytes ?? 0) / 1024))} KB`,
    tail: l.tail,
  }));
  const f = evidence?.failure;
  const copyText = [
    `## BENCH RUN — WHAT HAPPENED · ${evidence?.runId ?? '?'}`,
    `Status: ${evidence?.status ?? '?'}${f ? ` · ${f.code ?? ''}${f.stage ? ` at ${f.stage}` : ''}` : ''}`,
    '',
    '### Stages',
    ...(stages.length ? stages.map((s) => `- ${s.stage}: ${s.text} · ${s.duration}`) : ['- none recorded']),
    ...logs.flatMap((l) => ['', `### ${l.kind} (${l.path}, ${l.note})`, '```', l.tail, '```']),
  ].join('\n');
  return { stages, logs, copyText, empty: !stages.length && !logs.length };
};
