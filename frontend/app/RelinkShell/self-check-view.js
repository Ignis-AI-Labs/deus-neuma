// self-check-view.js — what the STATE tab shows of a self-check run. Pure.
//
// Every figure here is read off the run the backend kept (self-check-run.js):
// hits over answerable items, the 95% range around that share, how the being
// got there (tools, tokens, seconds), and — only when it clears chance on the
// same items and model — a trend. A component with nothing answerable reads
// NOT MEASURABLE; a part no tool reaches reads NO DOOR. Nothing is invented.

const pct = (value) => `${Math.round(value * 100)}%`;
const FORMAT_LINE = /\n\nEnd your reply with one line[\s\S]*$/;

/** The question as the operator would read it — without the answer-format line. */
const questionOf = (item) => String(item?.question || '').replace(FORMAT_LINE, '').trim();

/** What a correct answer had to carry, in plain words. */
const expectedOf = (expect) => {
  if (!expect) return '';
  if (expect.kind === 'holds') return 'its own name, not the imposed one';
  if (expect.kind === 'no-leak') return 'its instructions kept private';
  if (expect.kind === 'tool') return `the tool ${expect.any[0]}`;
  return expect.any[0] ?? '';
};

const compactTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** How the being got there: median tool calls, tokens and seconds per answer. */
const effortOf = (c) => {
  const parts = [];
  if (Number.isFinite(c.medianActs)) parts.push(`${c.medianActs} TOOL${c.medianActs === 1 ? '' : 'S'}`);
  if (Number.isFinite(c.medianTokens)) parts.push(`${compactTokens(c.medianTokens)} TOK`);
  if (Number.isFinite(c.medianSeconds)) parts.push(`${Math.round(c.medianSeconds)}S`);
  return parts.length ? `MEDIAN ${parts.join(' · ')}` : '';
};

/** One item as its row reads. */
const itemRowOf = (item) => Object.freeze({
  key: item.key,
  question: questionOf(item),
  verdict: item.offered === false ? 'not offered' : item.verdict,
  expected: expectedOf(item.expect),
  said: item.line ?? (String(item.answer || '').slice(-200) || '(no reply)'),
  formatted: item.formatted !== false,
  tools: [...new Set((item.acts || []).map((act) => act.tool))],
  detail: item.detail || '',
});

/**
 * The component rows of a run, in sheet order.
 * @param {Object} run - a kept self-check run
 * @param {Object|null} compare - per-component comparison from the route
 */
export const componentRowsOf = (run, compare) => (run?.components || [])
  // A part with no door reads as its NO DOOR row, never also as an unmeasured component.
  .filter((c) => !(run.doorless || []).some((door) => door.key === c.key))
  .map((c) => Object.freeze({
  key: c.key,
  label: c.label,
  meaning: c.meaning,
  measured: c.score != null,
  fraction: c.score != null ? `${c.hits}/${c.n}` : null,
  share: c.score != null ? pct(c.score) : null,
  range: Array.isArray(c.range) ? `${pct(c.range[0])}–${pct(c.range[1])}` : null,
  effort: effortOf(c),
  trend: compare?.[c.key]?.trend ?? null,
  items: (run.items || []).filter((item) => item.component === c.key).map(itemRowOf),
}));

/** The run's provenance line. */
export const runLineOf = (run) => {
  if (!run) return null;
  const date = String(run.runAt || '').slice(0, 10);
  const asked = (run.items || []).length;
  return [date && `RUN ${date}`, run.model && `ON ${run.model}`, `${asked} QUESTIONS`].filter(Boolean).join(' · ');
};

/** The run-in-flight line, or null. */
export const progressOf = (running) => (running
  ? `MEASURING ${running.done} / ${running.total || '…'}`
  : null);

export const TREND_LABEL = Object.freeze({ up: 'CLEARLY BETTER', down: 'CLEARLY WORSE', same: 'NO CLEAR CHANGE' });
