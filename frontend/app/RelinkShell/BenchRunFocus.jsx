// BenchRunFocus — THE FOCUS of the RUNS ledger, pure rendering: one run in
// depth. Its score and change against bare, what it cost (instruments), why
// it stopped when it did not land, its siblings in the same matched set (a
// click steps to one), WHAT HAPPENED inside it (stages + log tails) when it
// did not land, WHY its set missed what it missed, then its provenance — ids, subject, environment,
// approval and THE HASHES with the COPY act. The law is bench-ledger-view.js
// (the shape) and bench-runs-view.js (the provenance).
// No sound imports — node-renderable (the static-markup view tests).

import { CopyWord } from './copy-word.jsx';
import { runFocus } from './bench-ledger-view.js';
import { runDetailView } from './bench-runs-view.js';
import { WhyItMissed, WhatHappened } from './BenchWhy.jsx';

export const BenchRunFocus = ({ row, runs, nowMs, onSelect, onOpenSuite, why = null }) => {
  const f = runFocus(row, runs, nowMs);
  const detail = runDetailView(row);
  return (
    <div className="lx-focus kx-cascade" key={row.runId}>
      <header className="lx-head">
        <p className="lx-kicker label-data">
          <span className={`atlas-glyph is-${f.arm}`} aria-hidden="true" /> {f.armName}
          <span className={`lx-status is-${f.register}`}>{f.mark}</span>
        </p>
        <p className="lx-title">
          {f.suiteId}
          {f.tier ? <span className="bx-tag label-data">{f.tier}</span> : null}
        </p>
        {f.meaning ? <p className="bx-meaning">{f.meaning}</p> : null}
      </header>

      <section className="bx-sec lx-score-sec">
        <div className="lx-score">
          <p className={`lx-num${f.status === 'succeeded' ? '' : ' is-dim'}`}>{f.score}</p>
          <div className="lx-score-side">
            {f.delta ? <p className={`lx-delta label-data is-${f.deltaSign}`}>{f.delta}</p> : null}
            {f.metricId ? <p className="bx-meta label-data">{f.metricId}</p> : null}
          </div>
          {onOpenSuite && f.suiteId !== '—' ? (
            <button type="button" className="bl-btn label-data lx-open" onClick={() => onOpenSuite(f.suiteId)}>
              OPEN IN REPORTS →
            </button>
          ) : null}
        </div>
        {f.failure ? (
          <div className={`lx-failure${f.invalidation ? ' is-invalidated' : ''}`} role="note">
            {f.invalidation ? (
              <p className="label-data">
                INVALIDATED — STRUCK FROM THE RECORD, IT NEVER SCORES
                {f.invalidation.was ? ` · IT HAD READ ${f.invalidation.was}` : ''}
                {f.invalidation.by ? ` · BY ${f.invalidation.by}` : ''}
                {f.invalidation.at ? ` · ${String(f.invalidation.at).slice(0, 16).replace('T', ' ')}` : ''}
              </p>
            ) : (
              <p className="label-data">WHY IT STOPPED{f.failure.stage ? ` — AT ${String(f.failure.stage).toUpperCase()}` : ''}{f.failure.code ? ` · ${f.failure.code}` : ''}</p>
            )}
            {f.failure.message ? (
              <>
                <pre className="lx-failure-msg">{f.failure.message}</pre>
                <CopyWord text={f.failure.message} className="lx-copy" />
              </>
            ) : null}
          </div>
        ) : null}
        <dl className="lx-instruments">
          {f.instruments.map((i) => (
            <div key={i.label} className="lx-inst">
              <dt className="label-data">{i.label}</dt>
              <dd>{i.value}{i.sub ? <span className="lx-inst-sub label-data">{i.sub}</span> : null}</dd>
            </div>
          ))}
        </dl>
      </section>

      {f.siblings.length > 1 ? (
        <section className="bx-sec">
          <p className="bx-kicker label-data">THE SET — LAUNCHED TOGETHER, SAME QUESTIONS</p>
          <div className="lx-siblings">
            {f.siblings.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={s.current}
                className={`lx-sib${s.current ? ' is-on' : ''}`}
                onClick={() => onSelect(s.key)}
              >
                <span className="lx-sib-arm label-data"><span className={`atlas-glyph is-${s.arm}`} aria-hidden="true" /> {s.name}{s.retry ? ` · ${s.retry}` : ''}</span>
                <span className="lx-sib-score">{s.score}</span>
                <span className={`lx-status is-${s.register}`}>{s.mark}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {why && (f.status === 'failed' || f.status === 'aborted' || f.status === 'other') ? (
        <WhatHappened runId={row.runId} entry={why.evidence(row.runId)} onRequest={why.requestEvidence} />
      ) : null}
      {why && row.comparisonId ? (
        <WhyItMissed
          comparisonId={row.comparisonId}
          entry={why.diagnosis(row.comparisonId)}
          onRequest={why.requestDiagnosis}
          focusArm={row.arm}
          title="WHY IT MISSED — EVERY WRONG ANSWER IN THIS SET, BY CAUSE"
        />
      ) : null}

      <section className="bx-sec">
        <p className="bx-kicker label-data">PROVENANCE</p>
        <dl className="lx-prov">
          {detail.lines.map((line) => (
            <div key={line.label} className="lx-prov-row">
              <dt className="label-data">{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
        {detail.hashes.length > 0 ? (
          <>
            <p className="bx-kicker label-data">
              THE HASHES — VERIFY THE RUN AGAINST ITS ARTIFACTS <CopyWord text={detail.copyText} className="lx-copy" />
            </p>
            <dl className="lx-prov">
              {detail.hashes.map((hash) => (
                <div key={hash.label} className="lx-prov-row">
                  <dt className="label-data">{hash.label}</dt>
                  <dd><code className="lx-hash">{hash.value}</code></dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </section>
    </div>
  );
};
