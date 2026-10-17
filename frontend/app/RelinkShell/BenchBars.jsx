// BenchBars — one chart model (bench-share-card.js, served by /summary)
// drawn on the desk, pure rendering. The same law as the share card: a
// fixed 0–100% track (no truncated axis), gray layers stepping up the ladder
// when the arms are ordinal, the one highlighted bar in --signal and named by
// its label, numbers in text ink. Every value is printed beside its bar, so
// the hover title on the track only restates it — it never gates a number.

export const BenchBars = ({ chart }) => {
  if (!chart?.bars?.length) return null;
  return (
    <div className={`bench-bars${chart.deltaHeader ? ' has-delta' : ''}`} role="table" aria-label={chart.title}>
      {chart.deltaHeader ? (
        <div className="bench-bars-row is-head" role="row">
          <span role="columnheader" className="bench-bars-label label-data">{chart.rowHeader?.toUpperCase()}</span>
          <span role="columnheader" className="bench-bars-track-head label-data">0% — 100%</span>
          <span role="columnheader" className="bench-bars-value label-data">SCORE</span>
          <span role="columnheader" className="bench-bars-delta label-data">{chart.deltaHeader.toUpperCase()}</span>
        </div>
      ) : null}
      {chart.bars.map((bar, i) => (
        <div key={bar.label} role="row" className={`bench-bars-row${bar.highlight ? ' is-top' : ''}`}>
          <span role="cell" className="bench-bars-label label-data">{bar.label}</span>
          <span role="cell" className="bench-bars-track" title={`${bar.label} — ${bar.display}${bar.delta ? ` (${bar.delta} vs BARE)` : ''}`}>
            <span
              className={`bench-bars-fill${chart.ordinal ? ` is-layer-${Math.min(i, 3)}` : ''}`}
              style={{ width: `${Math.max(0, Math.min(1, bar.value)) * 100}%` }}
            />
          </span>
          <span role="cell" className="bench-bars-value label-data">{bar.display}</span>
          {chart.deltaHeader ? <span role="cell" className="bench-bars-delta label-data">{bar.delta ?? '—'}</span> : null}
        </div>
      ))}
    </div>
  );
};
