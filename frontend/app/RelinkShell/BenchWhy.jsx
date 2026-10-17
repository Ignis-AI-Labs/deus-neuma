// BenchWhy — THE WHY panels, pure rendering (the law is bench-why-view.js,
// the IO use-bench-why.js):
//
//   WhyItMissed — a matched set's diagnosis: the findings in plain words,
//     every arm's misses by cause (count + a stacked bar over all items),
//     what it lost and gained against BARE on the same items, worked
//     examples per cause, what could not be diagnosed, COPY DIAGNOSIS.
//   WhatHappened — one run's stages with their verdicts and its log tails,
//     COPY WHAT HAPPENED.
//
// Each panel asks for its data once its id is known (an effect — the static
// render tests never fire it) and renders the entry it is handed.
// No sound imports — node-renderable.

import { useEffect, useRef, useState } from 'react';
import './BenchWhy.css';
import { CopyWord } from './copy-word.jsx';
import { diagnosisView, evidenceView } from './bench-why-view.js';

const Pending = ({ entry, what, onRetry }) => {
  if (!entry || entry.state === 'loading') return <p className="why-note label-data">READING {what}…</p>;
  if (entry.state === 'error') {
    return (
      <p className="why-note is-error">
        {entry.error}
        {onRetry ? <button type="button" className="bl-btn label-data why-retry" onClick={onRetry}>TRY AGAIN</button> : null}
      </p>
    );
  }
  return null;
};

// A log tail opens at its END — the last lines are where a stage says why it died.
const LogTail = ({ text }) => {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  return <pre ref={ref} className="why-log-tail">{text}</pre>;
};

const Examples = ({ row }) => {
  const [open, setOpen] = useState(false);
  if (!row.examples.length) return null;
  return (
    <div className="why-examples">
      <button type="button" className="bl-fold-toggle label-data" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {row.name} — WHAT IT ACTUALLY WROTE
      </button>
      {open ? row.examples.map((ex) => (
        <div key={ex.id} className="why-example-group">
          <p className="why-example-head label-data"><span className={`why-swatch is-${ex.id}`} aria-hidden="true" />{ex.words} · {ex.count}</p>
          {ex.items.map((it) => (
            <div key={it.docId} className="why-example">
              <p className="why-example-meta label-data">
                ITEM {it.docId}{it.gold ? ` · EXPECTED ${it.gold}` : ''}{it.broke ? ` · BROKE ${it.broke}` : ''}
              </p>
              <pre className="why-example-answer">{it.answer}</pre>
              {it.wire ? <p className="why-example-meta label-data">{it.wire}</p> : null}
            </div>
          ))}
        </div>
      )) : null}
    </div>
  );
};

/**
 * @param {{comparisonId: string, entry: ?object, onRequest: (id: string) => void, focusArm?: ?string, title?: string}} props
 */
export const WhyItMissed = ({ comparisonId, entry, onRequest, focusArm = null, title = 'WHY IT MISSED' }) => {
  useEffect(() => { if (comparisonId) onRequest?.(comparisonId); }, [comparisonId, onRequest]);
  if (!comparisonId) return null;
  const ready = entry?.state === 'ready' ? diagnosisView(entry.data.diagnosis, focusArm) : null;
  return (
    <section className="bx-sec why">
      <p className="bx-kicker label-data why-head">
        {title}
        {ready ? <CopyWord text={entry.data.markdown} className="why-copy" /> : null}
      </p>
      {ready ? (
        <>
          {ready.mismatch ? (
            <p className="why-mismatch" role="alert" data-testid="why-sample-mismatch">
              <strong>SAMPLE MISMATCH</strong> — {ready.mismatch.arms.join(', ')} did not answer the same questions as
              BARE MODEL. Each score is real; the comparison between arms is not.
            </p>
          ) : null}
          {ready.findings.length ? (
            <ul className="why-findings">
              {ready.findings.map((f) => <li key={f}>{f}</li>)}
            </ul>
          ) : null}
          {ready.rows.length ? (
            <>
              <div className="why-legend label-data">
                {ready.causes.map((c) => <span key={c.id} className="why-legend-item"><span className={`why-swatch is-${c.id}`} aria-hidden="true" />{c.words}</span>)}
              </div>
              <div className="bx-table-wrap">
                <table className="atlas-table why-table">
                  <thead>
                    <tr>
                      <th className="label-data">ARM</th>
                      <th className="label-data">PASSED</th>
                      <th className="label-data">MISSES BY CAUSE</th>
                      {ready.causes.map((c) => <th key={c.id} className="label-data" title={c.words}><span className={`why-swatch is-${c.id}`} aria-hidden="true" />{c.short}</th>)}
                      <th className="label-data">VS BARE — LOST · GAINED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ready.rows.map((r) => (
                      <tr key={r.arm} className={r.focus ? 'is-on' : ''}>
                        <td><span className={`atlas-glyph is-${r.arm}`} aria-hidden="true" /> {r.name}</td>
                        <td>{r.passed} <span className="bx-x">{r.score}</span></td>
                        <td>
                          <span className="why-bar" role="img" aria-label={`${r.missed} misses`}>
                            {r.bar.map((b) => <span key={b.id} className={`why-bar-part is-${b.id}`} style={{ width: `${b.frac * 100}%` }} />)}
                          </span>
                        </td>
                        {r.counts.map((n, i) => <td key={ready.causes[i].id} className={n ? '' : 'is-dim'}>{n || '·'}</td>)}
                        <td className="why-vs" title={r.vsBare?.lostBy || undefined}>
                          {r.vsBare ? `−${r.vsBare.lost} · +${r.vsBare.gained}` : '—'}
                          {r.vsBare?.lostBy ? <span className="why-vs-by">{r.vsBare.lostBy}</span> : null}
                          {r.vsBare?.shared ? <span className="why-vs-by is-alert">{r.vsBare.shared}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ready.rows.some((r) => r.blind) ? (
                <p className="why-note">
                  {ready.rows.filter((r) => r.blind).map((r) => r.name).join(', ')} recorded no per-request telemetry, so a budget cut there reads as a blank or wrong answer.
                </p>
              ) : null}
              {ready.rows.map((r) => <Examples key={r.arm} row={r} />)}
            </>
          ) : null}
          {ready.skipped.length ? (
            <div className="why-skipped">
              <p className="label-data why-skipped-head">NOT DIAGNOSED</p>
              {ready.skipped.map((s) => <p key={s.runId} className="why-note"><strong>{s.name}</strong> — {s.reason}</p>)}
            </div>
          ) : null}
        </>
      ) : <Pending entry={entry} what="THE DIAGNOSIS" onRetry={() => onRequest?.(comparisonId)} />}
    </section>
  );
};

/**
 * @param {{runId: string, entry: ?object, onRequest: (id: string) => void}} props
 */
export const WhatHappened = ({ runId, entry, onRequest }) => {
  useEffect(() => { if (runId) onRequest?.(runId); }, [runId, onRequest]);
  if (!runId) return null;
  const ready = entry?.state === 'ready' ? evidenceView(entry.data) : null;
  return (
    <section className="bx-sec why">
      <p className="bx-kicker label-data why-head">
        WHAT HAPPENED — EVERY STAGE, AND WHAT IT LOGGED
        {ready && !ready.empty ? <CopyWord text={ready.copyText} className="why-copy" /> : null}
      </p>
      {ready ? (
        ready.empty ? <p className="why-note">This run recorded no stages and kept no logs.</p> : (
          <>
            <div className="why-stages">
              {ready.stages.map((s, i) => (
                <span key={`${s.stage}-${i}`} className={`why-stage is-${s.register}`}>
                  <span className="label-data">{s.stage}</span>
                  <span className="why-stage-verdict label-data">{s.text}</span>
                  <span className="why-stage-time label-data">{s.duration}</span>
                </span>
              ))}
            </div>
            {ready.logs.map((l) => (
              <div key={l.path} className="why-log">
                <p className="why-log-head label-data">{l.kind} · {l.path} · {l.note}</p>
                <LogTail text={l.tail} />
              </div>
            ))}
          </>
        )
      ) : <Pending entry={entry} what="THE RUN'S LOGS" onRetry={() => onRequest?.(runId)} />}
    </section>
  );
};
