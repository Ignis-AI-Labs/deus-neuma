// bench-run-chip-view — what the composer's BENCHMARK chip says, pure
// (Design note, 2026-10-15: […]).
//
// From GET /api/v1/bench/live: `live` is every runner on this machine (any
// desk, any launcher), the one holding the GPU with items done of total;
// `chain` is THIS desk's matched set, which knows the arms still to come and
// covers the minute or two before an arm takes the GPU. Nothing running →
// null, and the chip renders nothing (the empty-string law).

/** The chip asks an open BENCH window to turn to LIVE (BenchApp.jsx listens). */
export const BENCH_WATCH_EVENT = 'neuma:bench-watch';

const fraction = (run) => (Number.isInteger(run?.done) && Number.isInteger(run?.total) && run.total > 0
  ? Math.min(1, run.done / run.total) : null);

/** One running benchmark as a line: […]. Pure. */
export const liveRunLine = (run) => [
  run?.cell || '?',
  run?.arm ? `${run.arm} arm` : null,
  fraction(run) !== null ? `${run.done} of ${run.total} items` : null,
  `${run?.minutes ?? 0} min`,
].filter(Boolean).join(' · ');

/**
 * @param {{live?: Array<object>, chain?: object|null}} data
 * @returns {null | {label: string, detail: string, fill: number|null}}
 */
export const benchChipView = (data) => {
  const live = Array.isArray(data?.live) ? data.live : [];
  const chain = data?.chain?.state === 'running' ? data.chain : null;
  if (!live.length && !chain) return null;
  const run = live.find((r) => Number.isInteger(r.total)) || live[0] || null;
  const cell = run?.cell || chain?.cell || 'benchmark';
  const arm = run?.arm || chain?.currentArm || null;
  const items = fraction(run) !== null ? `${run.done}/${run.total}` : null;
  const left = chain ? chain.arms.slice((chain.currentIndex ?? 0) + 1) : [];
  return {
    label: ['BENCHMARK', cell, arm, items].filter(Boolean).join(' · '),
    detail: [
      run ? `${arm ? `${arm} arm` : 'running'} · ${run.minutes} min${items ? ` · ${run.done} of ${run.total} items` : ''}` : 'starting — the arm takes the GPU in a minute or two',
      left.length ? `then ${left.join(', ')}` : null,
      live.length > 1 ? `${live.length} runs on this machine` : null,
    ].filter(Boolean).join(' · '),
    fill: fraction(run),
  };
};

const MARK = (ok) => (ok ? '✓' : '✗');
const scoreOf = (value) => (typeof value === 'number' ? String(Math.round(value * 100) / 100) : null);

/**
 * THE CHAT'S CARD for a benchmark it launched (Design note, 2026-10-15: […]).
 * Reads the run from what the desk knows: this desk's set (`chain`), the
 * machine's live runners (`live`), and the sealed runs ledger (`runs`) — the
 * last is what a resumed chat, or a restarted desk, still has. Pure.
 * @param {{comparisonId: string, cell: string, arms: string[]}} bench
 * @param {{live?: Array, chain?: object|null, runs?: Array}} seen
 * @returns {{state: 'running'|'done'|'failed'|'stopped'|'unknown', line: string, fill: number|null}}
 */
export const benchRunCardView = (bench, { live = [], chain = null, runs = [] } = {}) => {
  const mine = chain?.comparisonId === bench.comparisonId ? chain : null;
  const sealed = runs.filter((r) => r.comparisonId === bench.comparisonId);
  const scored = (arm) => {
    const run = sealed.find((r) => r.arm === arm);
    const score = run ? scoreOf(run.primaryMetric?.value ?? run.value) : null;
    return score !== null ? ` ${score}` : '';
  };
  if (mine?.state === 'running') {
    const run = live.find((r) => r.cell === bench.cell && r.arm === mine.currentArm) || null;
    const items = fraction(run) !== null ? ` · ${run.done} of ${run.total} items` : '';
    const done = mine.outcomes.map((o) => `${o.arm} ${MARK(o.ok)}${scored(o.arm)}`);
    return {
      state: 'running',
      line: [`running · ${mine.currentArm} arm${items}${run ? ` · ${run.minutes} min` : ''}`, ...done].join(' · '),
      fill: fraction(run),
    };
  }
  if (mine) {
    const marks = mine.outcomes.map((o) => (o.skipped ? `${o.arm} —` : `${o.arm} ${MARK(o.ok)}${scored(o.arm)}`)).join(' · ');
    const failed = mine.state === 'failed' || mine.outcomes.some((o) => !o.skipped && !o.ok);
    return {
      state: mine.state === 'stopped' ? 'stopped' : failed ? 'failed' : 'done',
      line: `${mine.state === 'stopped' ? 'stopped' : failed ? 'finished with a failed arm' : 'finished'} · ${marks}`,
      fill: null,
    };
  }
  if (sealed.length) {
    const marks = bench.arms.map((arm) => {
      const run = sealed.find((r) => r.arm === arm);
      return run ? `${arm} ${MARK(run.status === 'succeeded')}${scored(arm)}` : `${arm} —`;
    }).join(' · ');
    const all = bench.arms.every((arm) => sealed.some((r) => r.arm === arm && r.status === 'succeeded'));
    return { state: all ? 'done' : 'failed', line: `${all ? 'finished' : 'did not finish every arm'} · ${marks}`, fill: null };
  }
  if (live.some((r) => r.cell === bench.cell)) {
    return { state: 'running', line: 'running', fill: null };
  }
  return { state: 'unknown', line: 'not running — its receipts are in BENCH → RUNS', fill: null };
};
