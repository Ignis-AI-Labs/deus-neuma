// BenchShare — REPORTS → SHARE, pure rendering: pick a result, pick a size,
// and take it out to the world as a PNG card (copy to the clipboard or save
// the file) or a Markdown table (copy — renders on Reddit, GitHub, Discord
// and most forums). The preview IS the exported PNG — the server's own
// render with the faces embedded — so what the operator sees is what posts.

import './BenchApp.css';
import './BenchApp-reports.css';
import { EmptyState } from './empty-state.jsx';
import { SHARE_SIZES, shareOptions } from './bench-summary-view.js';

export const BenchShare = ({
  summary, source, size, onSource, onSize, pngUrl, markdown, busy, notice, refusal,
  onCopyImage, onSavePng, onCopyMarkdown,
}) => {
  if (!summary) return <EmptyState title="READING EVERY RECEIPT…" />;
  const groups = shareOptions(summary);
  if (groups.length === 0) return <EmptyState title="NOTHING TO SHARE YET — RUN A BENCHMARK FIRST" />;
  const value = source ? `${source.kind}|${source.id}` : '';
  return (
    <div className="bench-share">
      <div className="bench-share-controls">
        <label className="bench-field">
          <span className="bench-field-label label-data">RESULT</span>
          <select className="bench-input label-data" value={value} onChange={(e) => onSource(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="bench-field">
          <span className="bench-field-label label-data">SIZE</span>
          <span className="bench-controls">
            {SHARE_SIZES.map((s) => (
              <button key={s.id} type="button" className={`bench-btn label-data${size === s.id ? ' is-on' : ''}`} onClick={() => onSize(s.id)} title={s.hint}>
                {s.label} <span className="bench-dim">{s.hint}</span>
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className="bench-controls">
        <button type="button" className="bench-btn is-signal-btn label-data" disabled={busy || !pngUrl} onClick={onCopyImage}>COPY IMAGE</button>
        <button type="button" className="bench-btn label-data" disabled={busy || !pngUrl} onClick={onSavePng}>SAVE PNG</button>
        <button type="button" className="bench-btn label-data" disabled={busy || !markdown} onClick={onCopyMarkdown}>COPY MARKDOWN</button>
        {notice ? <span className="bench-line label-data is-signal">{notice}</span> : null}
      </div>
      {refusal ? <p className="bench-line label-data is-alert">{refusal}</p> : null}
      <div className={`bench-share-preview is-${size}`}>
        {pngUrl ? (
          <img src={pngUrl} alt="the share card, exactly as it exports" className={busy ? 'is-stale' : ''} />
        ) : (
          <EmptyState title={busy ? 'DRAWING THE CARD…' : 'CHOOSE A RESULT'} />
        )}
      </div>
      {markdown ? (
        <>
          <p className="bench-sub-head label-data">MARKDOWN — AS IT COPIES</p>
          <pre className="bench-pre">{markdown}</pre>
        </>
      ) : null}
    </div>
  );
};
