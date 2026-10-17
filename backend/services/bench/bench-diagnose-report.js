/**
 * bench-diagnose-report — the run diagnosis as one markdown block the
 * operator copies into a repair thread (#557). Pure: the diagnosis arrives
 * whole from bench-diagnose.js.
 */

import { CAUSES } from './bench-diagnose-classify.js';

const EXAMPLES_PER_CAUSE = 3;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

/** pure — one example line: doc, gold, what the arm wrote, what the wire saw. */
const exampleLine = (item) => {
  const t = item.telemetry;
  const wire = t ? ` · finish=${t.finishReason}, answer ${t.contentChars} chars, reasoning ${t.reasoningChars} chars${t.ambiguous ? ' (link ambiguous)' : ''}` : '';
  const broke = item.brokenInstructions.length ? ` · broke: ${item.brokenInstructions.join(', ')}` : '';
  const gold = item.gold && item.gold !== '0' ? ` · gold \`${item.gold}\`` : '';
  return `  - doc ${item.docId}${gold}${broke}${wire}\n    > ${item.answerTail || '(empty)'}`;
};

/** pure — WHAT THE BEING TOUCHED (#564): one arm's tool trail, for the audit. */
const toolUseLines = (a) => {
  const t = a.toolUse;
  const head = `- **${a.arm}**: ${t.calls} tool call(s) across ${t.answersWithTools} of ${t.answers} answers`;
  if (!t.recorded) return [`${head} — only counted; these receipts predate the tool trail, so what was touched is not on record.`];
  const more = (n) => (n ? ` (+${n} more)` : '');
  return [
    `${head}; ${t.failed} did not succeed.`,
    `  - by tool: ${Object.entries(t.byTool).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`,
    `  - web: ${t.webTargets.map((u) => `\`${u}\``).join(', ') || 'none'}${more(t.webTargetsMore)}`,
    `  - writes: ${t.writeTargets.map((u) => `\`${u}\``).join(', ') || 'none'}${more(t.writeTargetsMore)}`,
  ];
};

/**
 * pure — the whole report.
 * @param {{comparisonId: string, cell: string, arms: Array, paired: Array, findings: string[], skipped: Array}} diagnosis
 * @returns {string} markdown
 */
export const renderDiagnosis = (diagnosis) => {
  const { comparisonId, cell, arms, paired, findings, skipped } = diagnosis;
  const causeKeys = Object.keys(CAUSES).filter((c) => arms.some((a) => a.causes[c]));
  const lines = [
    `## BENCH RUN DIAGNOSIS — ${cell} · ${comparisonId}`,
    '',
    '### What is getting in the way',
    ...findings.map((f) => `- ${f}`),
    '',
    '### Misses by cause',
    `| Arm | Passed | ${causeKeys.join(' | ')} | Telemetry |`,
    `| --- | --- | ${causeKeys.map(() => '---').join(' | ')} | --- |`,
    ...arms.map((a) => `| ${a.arm} | ${a.passed}/${a.total} (${pct(a.passed, a.total)}) | ${causeKeys.map((c) => a.causes[c] ?? 0).join(' | ')} | ${a.telemetry} |`),
  ];
  if (paired.length) {
    lines.push('', '### Against BARE (same items, by doc_hash)',
      '| Arm | Shared items | Lost vs BARE | Lost by cause | Gained vs BARE |', '| --- | --- | --- | --- | --- |',
      ...paired.map((p) => `| ${p.arm} | ${p.shared ?? '?'}/${p.total ?? '?'} | ${p.lost} | ${Object.entries(p.lostBy).map(([c, n]) => `${c} ${n}`).join(', ') || '—'} | ${p.gained} |`));
  }
  if (diagnosis.verdicts?.length) {
    lines.push('', '### Whose miss (model = BARE missed it too · harness = BARE answered it · identity = HARNESS answered it)',
      '| Arm | Model | Harness | Harness by cause | Identity | Unjudged |', '| --- | --- | --- | --- | --- | --- |',
      ...diagnosis.verdicts.map((v) => `| ${v.arm} | ${v.model} | ${v.harness} | ${Object.entries(v.harnessBy).map(([c, n]) => `${c} ${n}`).join(', ') || '—'} | ${v.arm === 'neuma' ? v.identity : '—'} | ${v.unjudged} |`));
  }
  lines.push('', '### Causes', ...causeKeys.map((c) => `- **${c}** — ${CAUSES[c]}`));
  const touched = arms.filter((a) => a.toolUse);
  if (touched.length) lines.push('', '### What the being touched (audit)', ...touched.flatMap(toolUseLines));
  for (const a of arms) {
    const missed = a.items.filter((i) => i.cause);
    if (!missed.length) continue;
    lines.push('', `### ${a.arm.toUpperCase()} — examples (${a.runId})`);
    for (const c of causeKeys) {
      const some = missed.filter((i) => i.cause === c).slice(0, EXAMPLES_PER_CAUSE);
      if (some.length) lines.push(`- **${c}** (${a.causes[c]})`, ...some.map(exampleLine));
    }
  }
  if (skipped?.length) {
    lines.push('', '### Not diagnosed', ...skipped.map((s) => `- ${s.arm} (${s.runId}): ${s.reason}`));
  }
  return lines.join('\n');
};
