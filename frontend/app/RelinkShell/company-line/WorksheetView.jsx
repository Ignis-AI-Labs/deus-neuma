// WorksheetView — a handed-on worksheet as the operator inspects it: SURVEY's
// candidates with their evidence, MEASURE's canvases as tables (a level per
// factor and player, each source one press away), SHAPE's ERRC grid and
// offer, CHOOSE's gap and kill criteria, PROVE's buyer results. Every source
// is shown — a figure without its source is not inspectable (SHINKEI).
// Pure rendering; NO sound imports — renderable under node.

const Source = ({ source }) => (/^https:\/\//.test(String(source))
  ? <a className="cline-link" href={source} target="_blank" rel="noopener noreferrer">{source}</a>
  : <span>{String(source ?? '—')}</span>);

const list = (v) => (Array.isArray(v) ? v : []);

const Survey = ({ w }) => (
  <ul className="cline-ws-list">
    {list(w.candidates).map((c) => (
      <li key={c.name}>
        <b>{c.name}</b> <span className="label-data">{String(c.path).toUpperCase()}{c.noncustomers ? ` · ${String(c.noncustomers).toUpperCase()} NONCUSTOMERS` : ''}</span>
        <p className="cline-move-t">{c.gap}</p>
        <ul className="cline-ws-src">{list(c.evidence).map((e, i) => <li key={i}>{e.claim} — <Source source={e.source} /></li>)}</ul>
      </li>
    ))}
  </ul>
);

const Canvas = ({ cv }) => {
  const players = list(cv.players);
  return (
    <div className="cline-ws-canvas">
      <p className="label-data">CANVAS — {cv.candidate}</p>
      <table className="cline-ws-table">
        <thead><tr><th className="label-data">FACTOR</th>{players.map((p) => <th key={p} className="label-data">{p}</th>)}</tr></thead>
        <tbody>
          {list(cv.factors).map((f) => (
            <tr key={f.name}>
              <td>{f.name}</td>
              {players.map((p) => {
                const l = list(f.levels).find((x) => x.player === p);
                return <td key={p} className="label-data" title={l ? String(l.source) : ''}>{l ? l.level : '—'}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cline-move-t">{cv.reading}</p>
      <details className="cline-floor">
        <summary className="label-data">EVERY LEVEL&apos;S SOURCE</summary>
        <ul className="cline-ws-src">
          {list(cv.factors).flatMap((f) => list(f.levels).map((l) => (
            <li key={`${f.name}:${l.player}`}>{f.name} · {l.player} · {l.level} — <Source source={l.source} /></li>
          )))}
        </ul>
      </details>
    </div>
  );
};

const Shape = ({ w }) => (
  <>
    <p className="label-data">THE GAP — {w.candidate}</p>
    <div className="cline-ws-errc">
      {['eliminate', 'reduce', 'raise', 'create'].map((k) => (
        <div key={k}><p className="label-data">{k.toUpperCase()}</p><ul>{list(w.errc?.[k]).map((x) => <li key={x}>{x}</li>)}</ul></div>
      ))}
    </div>
    <p className="cline-move-t">FOR: {w.forWhom}</p>
    <p className="cline-move-t">{w.offer}</p>
    <p className="label-data">{w.priceBand?.low}–{w.priceBand?.high} {w.priceBand?.currency} · {w.priceBand?.basis}</p>
    <p className="cline-hands-what">“{w.tagline}”</p>
    <ul className="cline-ws-src">{list(w.painPoints).map((p, i) => <li key={i}>{String(p.stage).toUpperCase()}: {p.pain} — <Source source={p.source} /></li>)}</ul>
  </>
);

const Choose = ({ w }) => (
  <>
    <p className="label-data">THE GAP — {w.candidate}</p>
    <p className="cline-move-t">{w.why}</p>
    <ul className="cline-ws-src">{list(w.killCriteria).map((k) => <li key={k}>WE STOP IF: {k}</li>)}</ul>
  </>
);

const Prove = ({ w }) => (
  <>
    <p className="label-data">THE GAP — {w.candidate}{w.standIns ? ' · SOME RESPONSES ARE STAND-INS' : ' · EVERY RESPONSE REAL'}</p>
    <ul className="cline-ws-src">
      {list(w.results).map((r, i) => <li key={i}>{String(r.kind).toUpperCase()} · {r.who} · {r.date} — {r.outcome} — <Source source={r.source} /></li>)}
    </ul>
    <p className="cline-move-t">{w.summary}</p>
  </>
);

const VIEWS = Object.freeze({
  survey: Survey,
  measure: ({ w }) => <>{list(w.canvases).map((cv) => <Canvas key={cv.candidate} cv={cv} />)}</>,
  shape: Shape,
  choose: Choose,
  prove: Prove,
});

/** @param {{stageId: string, worksheet: ?object}} props */
export const WorksheetView = ({ stageId, worksheet }) => {
  const View = VIEWS[stageId];
  if (!View || !worksheet) return null;
  return <div className="cline-ws" data-worksheet={stageId}><View w={worksheet} /></div>;
};
