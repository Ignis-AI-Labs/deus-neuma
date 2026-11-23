// PipelineReview — THE BENCHMARK (Design note, 2026-11-22: […]).
// One audience a line: of its newest leads, the share that MEET the written standard at each stage, and how long the
// waits were. The row opens onto the whole of it: what is wrong with the setup, where the companies came from, every
// check of the standard with how many failed it (a check opens onto the companies and why), and every lead graded.
// Graded from the records alone (backend sales/pipeline-review.js): it costs nothing and can be read at any moment.
// impure — reads the review through the revenue routes.
import { useEffect, useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { getPipelineReview } from '../../../services/revenue-client.js';

const n = (v) => Number(v || 0).toLocaleString('en-US');
const pct = (rate) => (rate == null ? null : `${Math.round(rate * 100)}%`);
const stageOf = (r, id) => r.stages.find((s) => s.id === id);
const stageCell = (id) => ({
  cell: (r) => { const s = stageOf(r, id); return s.reached ? `${pct(s.rate)}${s.fails ? ` · ${n(s.fails)} FAIL` : ''}` : null; },
  sort: (r) => stageOf(r, id).rate ?? -1,
  tone: (r) => { const s = stageOf(r, id); return !s.reached ? undefined : s.fails ? 'alert' : s.rate === 1 ? 'on' : undefined; },
  title: (r) => { const s = stageOf(r, id); return s.reached ? `${s.meets} of ${s.reached} meet the standard, ${s.weak} weak, ${s.fails} fail` : 'no lead has reached this stage'; },
});
const stepOf = (r, id) => r.steps.find((s) => s.id === id);
const GRADE = Object.freeze({ meets: 'MEETS', weak: 'WEAK', fails: 'FAILS', none: null });
const gradeCell = (id) => ({ cell: (row) => GRADE[row.grades[id]], tone: (row) => (row.grades[id] === 'fails' ? 'alert' : row.grades[id] === 'meets' ? 'on' : undefined) });
const SIZES = Object.freeze([[10, 'NEWEST 10'], [25, 'NEWEST 25'], [100, 'NEWEST 100'], [500, 'ALL']]);

// One audience, whole: read when its row is opened, and again when the batch size is changed.
const ReviewWhole = ({ id, name }) => {
  const [size, setSize] = useState(25);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { let on = true; setError(null); getPipelineReview(id, size).then((r) => { if (on) setReview(r?.reviews?.[0] ?? null); }, (e) => { if (on) setError(e.message); }); return () => { on = false; }; }, [id, size]);
  if (error) return <p className="sec-error" role="alert">{error}</p>;
  if (!review) return <p className="spl-note label-data" role="status">GRADING…</p>;
  const checks = review.stages.flatMap((s) => s.checks.map((c) => ({ ...c, stage: s.name, reached: s.reached })));
  return (
    <div className="spl-standing" data-review-whole={id}>
      <div className="spl-run-row" role="group" aria-label={`how many of the leads of ${name} to grade`}>
        {SIZES.map(([count, words]) => <button key={count} type="button" className="sec-scan label-data" aria-pressed={size === count} data-review-size={count} onClick={() => setSize(count)}>{words}</button>)}
        <span className="spl-note label-data" role="status">{n(review.size)} OF {n(review.of)} LEADS GRADED · {n(review.whole.reachedEmail)} HAVE AN EMAIL · {n(review.whole.noMustFailed)} OF THOSE FAIL NO MUST · {n(review.whole.clean)} MEET EVERY CHECK</span>
      </div>
      {review.findings.map((f) => <p key={f} className="spl-standing-next" data-review-finding="">THE SETUP: {f}</p>)}
      <Sheet label={`the standard for ${name}`} rows={checks} rowKey={(c) => c.id} rowName={(c) => c.says} rowAttrs={(c) => ({ 'data-review-check': c.id })}
        detailLabel={() => 'the companies that failed it, and why'}
        detail={(c) => (c.failed ? (
          <Sheet label={`failed ${c.id} for ${name}`} rows={c.examples} rowKey={(e) => `${e.domain}:${e.email}`}
            columns={[{ head: 'COMPANY', cell: (e) => e.domain, exact: true }, { head: 'ADDRESS', cell: (e) => e.email, exact: true }, { head: 'WHY', cell: (e) => e.why, wrap: true }]} />
        ) : null)}
        columns={[
          { head: 'THE STANDARD', cell: (c) => c.says, wrap: true },
          { head: 'STAGE', cell: (c) => c.stage },
          { head: 'WEIGHT', cell: (c) => (c.must ? 'MUST' : 'SHOULD'), title: (c) => (c.must ? 'a lead that fails it should not have got through' : 'a lead that fails it got through, and a better one was possible') },
          { head: 'FAILED BY', cell: (c) => (c.reached ? `${n(c.failed)} OF ${n(c.reached)}` : null), sort: (c) => c.failed, tone: (c) => (c.failed ? (c.must ? 'alert' : undefined) : c.reached ? 'on' : undefined) },
        ]} />
      {review.discovery.sources.length ? (
        <Sheet label={`where the companies of ${name} came from`} rows={review.discovery.sources} rowKey={(s) => s.source}
          columns={[
            { head: 'SOURCE', cell: (s) => s.words.toUpperCase() },
            { head: 'SCREENED', cell: (s) => n(s.scored), sort: (s) => s.scored },
            { head: 'A FIT', cell: (s) => n(s.fit), sort: (s) => s.fit },
            { head: 'IN 100', cell: (s) => (s.scored ? Math.round(s.rate * 100) : null), sort: (s) => s.rate ?? -1, tone: (s) => (s.grade === 'fails' ? 'alert' : s.grade === 'meets' ? 'on' : undefined) },
            { head: 'VERDICT', cell: (s) => ({ meets: 'MEETS — 15 IN 100 OR MORE', weak: 'WEAK', fails: 'FAILS — STOP GATHERING FROM IT', none: 'TOO FEW SCREENED TO JUDGE' }[s.grade]) },
          ]} />
      ) : null}
      <Sheet label={`how long each step took for ${name}`} rows={review.steps} rowKey={(s) => s.id}
        columns={[
          { head: 'STEP', cell: (s) => s.name.toUpperCase() },
          { head: 'TYPICAL', cell: (s) => (s.measured ? s.medianWords.toUpperCase() : null), sort: (s) => s.median ?? -1 },
          { head: 'SLOWEST', cell: (s) => (s.measured ? s.slowestWords.toUpperCase() : null), sort: (s) => s.slowest ?? -1 },
          { head: 'MEASURED', cell: (s) => n(s.measured) },
          { head: 'WHOSE WAIT', cell: (s) => s.whose.toUpperCase() },
        ]} />
      <Sheet label={`every graded lead of ${name}`} rows={review.rows} rowKey={(r) => r.leadId} rowName={(r) => r.domain} rowAttrs={(r) => ({ 'data-review-lead': r.leadId })}
        detailLabel={() => 'every check it failed, and why'}
        detail={(r) => (r.fails.length ? (
          <ul className="spl-standing-src" aria-label={`what ${r.domain} failed`}>
            {r.fails.map((f) => <li key={f.check}><b>{f.must ? 'MUST' : 'SHOULD'}</b> — {f.why}</li>)}
          </ul>
        ) : null)}
        columns={[
          { head: 'COMPANY', cell: (r) => r.domain, exact: true },
          { head: 'ADDRESS', cell: (r) => r.email, exact: true },
          { head: 'FILTER', ...gradeCell('filter') },
          { head: 'WHO', ...gradeCell('address') },
          { head: 'VALIDATION', ...gradeCell('validate') },
          { head: 'RESEARCH', ...gradeCell('research') },
          { head: 'EMAIL', ...gradeCell('email') },
          { head: 'FAILED', cell: (r) => (r.fails.length ? n(r.fails.length) : null), sort: (r) => r.fails.length },
          { head: 'EMAIL IS', cell: (r) => (r.emailState ? r.emailState.toUpperCase() : null) },
        ]} />
    </div>
  );
};

/** @param {{inView: Set<string>, stamp: string}} props - inView: the audiences on show · stamp: changes when a run starts or ends, and the review is read again */
export const PipelineReview = ({ inView, stamp }) => {
  const [reviews, setReviews] = useState([]);
  useEffect(() => { let on = true; getPipelineReview().then((r) => { if (on) setReviews(r?.reviews ?? []); }, () => {}); return () => { on = false; }; }, [stamp]);
  const rows = reviews.filter((r) => r.size && inView.has(r.segment.id));
  if (!rows.length) return null;
  const graded = rows.reduce((t, r) => t + r.size, 0);
  const failing = rows.reduce((t, r) => t + r.stages.reduce((x, s) => x + s.fails, 0), 0);
  const clean = rows.reduce((t, r) => t + r.whole.clean, 0);
  return (
    <Fold id="pipeline-review" title="PIPELINE REVIEW" level={2} stats={[`${n(graded)} LEADS GRADED`, failing ? `${n(failing)} STAGE FAILS` : 'NO STAGE FAILS', `${n(clean)} CLEAN END TO END`]}>
      <Sheet label="the pipeline review" rows={rows} rowKey={(r) => r.segment.id} rowName={(r) => r.segment.name} rowAttrs={(r) => ({ 'data-review': r.segment.id })}
        detail={(r) => <ReviewWhole id={r.segment.id} name={r.segment.name} />} detailLabel={() => 'every check, every company that failed it, every lead'}
        columns={[
          { head: 'AUDIENCE', cell: (r) => r.segment.name },
          { head: 'GRADED', cell: (r) => n(r.size), sort: (r) => r.size },
          { head: 'DISCOVERY', cell: (r) => pct(r.discovery.rate), sort: (r) => r.discovery.rate ?? -1, tone: (r) => (r.discovery.grade === 'fails' ? 'alert' : r.discovery.grade === 'meets' ? 'on' : undefined), title: (r) => (r.discovery.rate == null ? 'no source screened enough to judge' : `${r.discovery.fit} of ${r.discovery.scored} screened companies were a fit; the standard is 15 in 100`) },
          { head: 'FILTER', ...stageCell('filter') },
          { head: 'WHO', ...stageCell('address') },
          { head: 'VALIDATION', ...stageCell('validate') },
          { head: 'RESEARCH', ...stageCell('research') },
          { head: 'EMAIL', ...stageCell('email') },
          { head: 'CLEAN', cell: (r) => `${n(r.whole.clean)} OF ${n(r.size)}`, sort: (r) => r.whole.clean },
          { head: 'LEAD → RESEARCH', cell: (r) => (stepOf(r, 'research').measured ? stepOf(r, 'research').medianWords.toUpperCase() : null), sort: (r) => stepOf(r, 'research').median ?? -1 },
          { head: 'RESEARCH → EMAIL', cell: (r) => (stepOf(r, 'email').measured ? stepOf(r, 'email').medianWords.toUpperCase() : null), sort: (r) => stepOf(r, 'email').median ?? -1 },
        ]} />
      <p className="spl-note label-data">EACH NUMBER IS THE SHARE OF THE AUDIENCE&apos;S NEWEST 25 LEADS THAT MEET THE WRITTEN STANDARD AT THAT STAGE. OPEN A ROW FOR THE STANDARD ITSELF, CHECK BY CHECK, AND THE COMPANIES THAT FAILED IT. IT IS GRADED FROM THE RECORDS: NOTHING IS SPENT, AND THE SAME LEADS GRADE THE SAME EVERY TIME.</p>
    </Fold>
  );
};
