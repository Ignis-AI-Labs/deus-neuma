// BenchLibrary — REPORTS → LIBRARY, pure rendering: every proof certificate
// and night bundle in ONE list, newest first, that the operator moves
// through — ‹ PREV / NEXT › (and ←/→ on the focused pane), a filter, and the
// rail. A proof reads as its certificate (with its exports and SHARE THIS);
// a bundle reads as its artifacts — REPORT.md through <Markdown> (XSS-safe by
// construction), metrics.csv as a table, receipts/queue as readable JSON.
// The IO (which item, which artifact) lives in use-bench-reports.js.

import './BenchApp.css';
import './BenchApp-reports.css';
import { EmptyState } from './empty-state.jsx';
import { Markdown } from './Markdown.jsx';
import { ARTIFACT_KEYS, bundleLabel, parseMetricsCsv, shortRunId, proofRow, proofScoreLine } from './bench-view.js';
import { LIBRARY_FILTERS, positionLabel, libraryIndex } from './bench-summary-view.js';

// The metrics artifact as a table — one row per (run, metric).
const MetricsTable = ({ text }) => {
  const rows = parseMetricsCsv(text);
  if (rows.length === 0) {
    return <EmptyState title="NO METRIC ROWS — THE WINDOW SCORED NOTHING" />;
  }
  return (
    <table className="bench-table">
      <thead>
        <tr>
          <th className="label-data">RUN</th>
          <th className="label-data">ARM</th>
          <th className="label-data">STATUS</th>
          <th className="label-data">ATT</th>
          <th className="label-data">METRIC</th>
          <th className="label-data">VALUE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.runId}-${row.metric}-${i}`} className={/fail/i.test(row.status) ? 'is-loud' : ''}>
            <td className="label-data" title={row.runId}>{shortRunId(row.runId)}</td>
            <td className="label-data">{row.arm.toUpperCase()}</td>
            <td className="label-data">{row.status.toUpperCase()}</td>
            <td className="label-data">{row.attempt ?? '—'}</td>
            <td className="label-data">{row.metric}</td>
            <td className="label-data">{row.value ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// receipts/queue — JSON when it parses, raw text otherwise. Never markup.
const JsonBlock = ({ text }) => {
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch { /* raw text stands */ }
  return <pre className="bench-pre">{pretty}</pre>;
};

const ProofPane = ({ id, proof, onShare }) => (
  !proof?.receipt ? <EmptyState title="READING THE CERTIFICATE…" /> : (
    <>
      <p className="bench-line label-data is-signal">{proofScoreLine(proof.receipt)}</p>
      <div className="bench-controls">
        <button type="button" className="bench-btn label-data" onClick={() => onShare({ kind: 'proof', id })}>SHARE THIS</button>
        <button type="button" className="bench-btn label-data" disabled={proof.busy} onClick={proof.onExportMd}>EXPORT — MARKDOWN</button>
        <button type="button" className="bench-btn label-data" disabled={proof.busy} onClick={proof.onExportPdf}>EXPORT — PDF</button>
      </div>
      {proof.certificate ? (
        <div className="bench-report-md"><Markdown text={proof.certificate} /></div>
      ) : null}
    </>
  )
);

const BundlePane = ({ bundle }) => (
  <>
    <div className="bench-art-tabs">
      {ARTIFACT_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={`bench-btn label-data${bundle.artifact === key ? ' is-on' : ''}`}
          onClick={() => bundle.onArtifact(key)}
        >
          {key.toUpperCase()}
        </button>
      ))}
    </div>
    {bundle.loading ? (
      <EmptyState title="READING THE ARTIFACT…" />
    ) : bundle.artifact === 'report' && bundle.report ? (
      <div className="bench-report-md"><Markdown text={bundle.report} /></div>
    ) : bundle.artifactText === null || bundle.artifactText === undefined ? (
      <EmptyState title="THE BUNDLE CARRIES NO SUCH ARTIFACT" />
    ) : bundle.artifact === 'metrics' ? (
      <MetricsTable text={bundle.artifactText} />
    ) : (
      <JsonBlock text={bundle.artifactText} />
    )}
  </>
);

const railLabel = (item, nowMs) =>
  (item.kind === 'proof' ? proofRow(item, nowMs) : bundleLabel(item, nowMs));

export const BenchLibrary = ({
  items, ready, filter, onFilter, selected, onSelect, onStep, proof, bundle, onShare, nowMs,
}) => {
  const at = libraryIndex(items, selected);
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
  };
  return (
    <div className="bench-library">
      <div className="bench-library-bar">
        <span className="bench-controls">
          {LIBRARY_FILTERS.map((f) => (
            <button key={f.id} type="button" className={`bench-btn label-data${filter === f.id ? ' is-on' : ''}`} onClick={() => onFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </span>
        <span className="bench-controls">
          <button type="button" className="bench-btn label-data" disabled={at <= 0} onClick={() => onStep(-1)} aria-label="newer">‹ NEWER</button>
          <span className="bench-library-pos label-data">{positionLabel(items, selected)}</span>
          <button type="button" className="bench-btn label-data" disabled={items.length === 0 || at >= items.length - 1} onClick={() => onStep(1)} aria-label="older">OLDER ›</button>
        </span>
      </div>
      <div className="bench-reports">
        <div className="bench-rail">
          {!ready ? (
            <EmptyState title="READING THE LIBRARY…" />
          ) : items.length === 0 ? (
            <EmptyState title="NOTHING HERE YET — RUN THE PROOF SUITE OR A NIGHT FROM LAUNCH" />
          ) : (
            <ul className="bench-rail-list">
              {items.map((item) => {
                const row = railLabel(item, nowMs);
                const on = selected?.kind === item.kind && selected?.id === item.id;
                return (
                  <li key={item.key}>
                    <button type="button" className={`bench-rail-item label-data${on ? ' is-on' : ''}`} onClick={() => onSelect(item)} title={item.id}>
                      <span className="bench-rail-kind">{item.kind === 'proof' ? 'PROOF CERTIFICATE' : 'NIGHT BUNDLE'}</span>
                      <span className="bench-rail-id">{row.id}</span>
                      <span className="bench-rail-age">{row.age}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {/* The pane takes focus so ←/→ step without reaching for the buttons. */}
        <div className="bench-report-pane" tabIndex={0} onKeyDown={onKey}>
          {!selected ? (
            <EmptyState title="CHOOSE A REPORT — OR STEP WITH ‹ ›" />
          ) : selected.kind === 'proof' ? (
            <ProofPane id={selected.id} proof={proof} onShare={onShare} />
          ) : (
            <BundlePane bundle={bundle} />
          )}
        </div>
      </div>
    </div>
  );
};
