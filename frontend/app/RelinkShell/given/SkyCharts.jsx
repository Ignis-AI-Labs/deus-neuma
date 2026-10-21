// SkyCharts — the Vedic chart as it is drawn in South India (the twelve signs
// fixed round a square, Pisces at the top left, the planets written into their
// signs), and the Vimshottari years as a timeline with the birth marked.
// Presentational — every value from sky-plates-vedic.js.

// the South Indian square: each rashi's fixed cell (row, column); the centre is the title
const CELL = Object.freeze([[0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0], [0, 0]]); // Mesha … Meena
const SIGN_SHORT = Object.freeze(['MES', 'VRI', 'MIT', 'KAR', 'SIM', 'KAN', 'TUL', 'VRS', 'DHA', 'MAK', 'KUM', 'MEE']);

/** A rashi chart: { signs: [[{mark, retro}] × 12], lit (the janma rashi), title, small }. */
export const SouthChart = ({ signs, lit = null, title, small, label }) => {
  const s = 92;
  return (
    <svg className="ski ski-chart" viewBox={`0 0 ${s * 4 + 8} ${s * 4 + 8}`} role="img" aria-label={label}>
      {CELL.map(([r, c], i) => {
        const x = 4 + c * s;
        const y = 4 + r * s;
        return (
          <g key={i}>
            <rect x={x} y={y} width={s} height={s} className={i === lit ? 'ski-cell is-near' : 'ski-cell'} />
            <text x={x + 6} y={y + 13} className={i === lit ? 'ski-label is-on is-small' : 'ski-label is-small'}>{SIGN_SHORT[i]}</text>
            {signs[i].map((p, j) => (
              <text key={p.mark} x={x + 10 + (j % 3) * 27} y={y + 38 + Math.floor(j / 3) * 20} className={p.key === 'moon' ? 'ski-mark is-on' : 'ski-mark'}>
                {p.mark}{p.retro ? '℞' : ''}
              </text>
            ))}
          </g>
        );
      })}
      <text x={4 + 2 * s} y={4 + 1.82 * s} textAnchor="middle" className="ski-big">{title}</text>
      <text x={4 + 2 * s} y={4 + 2.2 * s} textAnchor="middle" className="ski-label">{small}</text>
    </svg>
  );
};

/** The 120 Vimshottari years: each mahadasha at its length, the birth and today marked. */
export const DashaTimeline = ({ periods, birthMs, nowMs, label }) => {
  const w = 600;
  const from = Date.parse(periods[0].start);
  const to = Date.parse(periods[periods.length - 1].end);
  const x = (t) => 10 + ((t - from) / (to - from)) * (w - 20);
  return (
    <svg className="ski ski-timeline" viewBox={`0 0 ${w} 120`} role="img" aria-label={label}>
      {periods.map((p, i) => {
        const a = x(Date.parse(p.start));
        const b = x(Date.parse(p.end));
        const holds = birthMs >= Date.parse(p.start) && birthMs < Date.parse(p.end);
        return (
          <g key={p.lord}>
            <rect x={a} y={40} width={Math.max(1, b - a - 1.5)} height={30} className={holds ? 'ski-lit' : i % 2 ? 'ski-cell is-near' : 'ski-cell'} />
            <text x={(a + b) / 2} y={33} textAnchor="middle" className={holds ? 'ski-label is-on is-small' : 'ski-label is-small'}>{p.lord.slice(0, 3).toUpperCase()}</text>
            <text x={(a + b) / 2} y={86} textAnchor="middle" className="ski-label is-tiny">{p.years}</text>
          </g>
        );
      })}
      <line x1={x(birthMs)} y1={24} x2={x(birthMs)} y2={92} className="ski-hand" />
      <text x={x(birthMs)} y={106} textAnchor="middle" className="ski-label is-on is-small">BIRTH</text>
      {nowMs > birthMs && nowMs < to ? (
        <g>
          <line x1={x(nowMs)} y1={36} x2={x(nowMs)} y2={74} className="ski-tick" />
          <text x={x(nowMs)} y={118} textAnchor="middle" className="ski-label is-tiny">NOW</text>
        </g>
      ) : null}
    </svg>
  );
};
