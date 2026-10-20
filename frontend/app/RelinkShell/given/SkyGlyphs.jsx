// SkyGlyphs — the sky instruments drawn as boards and glyphs: a day count's
// whole cycle as a grid with its day lit (the 260-day count, the 35-day
// weton, the 210-day pawukon), the Long Count in Maya numerals, the four
// pillars in their characters with the month's sovereign hexagram, the
// Dreamspell's oracle cross. Presentational — every value from sky-plates.js.

// The stems and branches in the characters they are written in.
const STEM_HANZI = Object.freeze(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']);
const BRANCH_HANZI = Object.freeze(['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']);

/** A whole cycle as rows × columns of days, its day lit; the lit row and column carry a faint cross-hair. */
export const DayGrid = ({ rows, cols, lit, rowLabels = null, colLabels = null, label }) => {
  const cell = 14;
  const gap = 3;
  const left = rowLabels ? (rowLabels.some((l) => l.length > 8) ? 132 : 92) : 4;
  const top = colLabels ? 22 : 4;
  const w = left + cols * (cell + gap) + 4;
  const h = top + rows * (cell + gap) + 4;
  const x = (c) => left + c * (cell + gap);
  const y = (r) => top + r * (cell + gap);
  return (
    <svg className="ski ski-grid" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <rect x={x(0) - 2} y={y(lit.row) - 2} width={cols * (cell + gap) + 1} height={cell + 4} className="ski-cross" />
      <rect x={x(lit.col) - 2} y={y(0) - 2} width={cell + 4} height={rows * (cell + gap) + 1} className="ski-cross" />
      {rowLabels ? rowLabels.map((l, r) => (
        <text key={l} x={left - 10} y={y(r) + cell / 2} textAnchor="end" dominantBaseline="central" className={r === lit.row ? 'ski-label is-on' : 'ski-label is-small'}>{l.toUpperCase()}</text>
      )) : null}
      {colLabels ? colLabels.map((l, c) => (
        <text key={l} x={x(c) + cell / 2} y={top - 10} textAnchor="middle" dominantBaseline="central" className={c === lit.col ? 'ski-label is-on' : 'ski-label is-small'}>{l}</text>
      )) : null}
      {Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const on = r === lit.row && c === lit.col;
        return <rect key={i} x={x(c)} y={y(r)} width={cell} height={cell} className={on ? 'ski-lit' : 'ski-cell'} />;
      })}
    </svg>
  );
};

/** One Maya numeral, 0–19: bars of five beneath dots of one; zero is the shell. */
const MayaGlyph = ({ glyph }) => (
  <svg className="ski-numeral" viewBox="0 0 64 64" aria-hidden="true">
    {glyph.zero ? (
      <g className="ski-shell">
        <ellipse cx="32" cy="34" rx="22" ry="12" />
        <path d="M14 32 Q32 22 50 32 M18 38 Q32 30 46 38" />
      </g>
    ) : (
      <g>
        {Array.from({ length: glyph.dots }, (_, i) => (
          <circle key={`d${i}`} cx={32 + (i - (glyph.dots - 1) / 2) * 12} cy={58 - glyph.bars * 12 - 8} r="4.2" className="ski-lit" />
        ))}
        {Array.from({ length: glyph.bars }, (_, i) => (
          <rect key={`b${i}`} x="8" y={52 - i * 12} width="48" height="7" className="ski-lit" />
        ))}
      </g>
    )}
  </svg>
);

/** The Long Count, place by place, b'ak'tun at the top as the monuments read. */
export const LongCount = ({ places }) => (
  <ol className="ski-lc">
    {places.map((p) => (
      <li key={p.name} className="ski-lc-row">
        <MayaGlyph glyph={p.glyph} />
        <span className="ski-lc-n">{p.n}</span>
        <span className="ski-lc-name label-data">{p.name}</span>
        <span className="ski-lc-unit label-data">× {p.unit}</span>
      </li>
    ))}
  </ol>
);

/** A hexagram's six lines, bottom first in the data, drawn top first as written. */
const Hexagram = ({ lines }) => (
  <svg className="ski-hex" viewBox="0 0 80 84" aria-hidden="true">
    {[...lines].reverse().map((yang, i) => (yang
      ? <rect key={i} x="4" y={4 + i * 13} width="72" height="7" className="ski-lit" />
      : <g key={i}><rect x="4" y={4 + i * 13} width="31" height="7" className="ski-lit" /><rect x="45" y={4 + i * 13} width="31" height="7" className="ski-lit" /></g>))}
  </svg>
);

/** The four pillars — hour, day, month, year, read right to left as the tradition writes them — and the month's hexagram. */
export const Pillars = ({ pillars, hexagram }) => (
  <div className="ski-pillars">
    <div className="ski-pillar-row">
      {pillars.map((p) => (
        <div key={p.name} className={`ski-pillar${p.name === 'DAY' ? ' is-master' : ''}`}>
          <span className="ski-pillar-name label-data">{p.name}</span>
          <span className="ski-pillar-glyph" lang="zh">{STEM_HANZI[p.stem.index]}</span>
          <span className="ski-pillar-sub label-data">{p.stem.pinyin} · {p.stem.polarity} {p.stem.element}</span>
          <span className="ski-pillar-glyph" lang="zh">{BRANCH_HANZI[p.branch.index]}</span>
          <span className="ski-pillar-sub label-data">{p.branch.pinyin} · {p.branch.animal}</span>
        </div>
      ))}
    </div>
    {hexagram?.lines ? (
      <div className="ski-hexagram">
        <Hexagram lines={hexagram.lines} />
        <span className="ski-hexagram-n">{hexagram.number}</span>
        <span className="ski-hexagram-name label-data">{hexagram.name}</span>
        <span className="ski-hexagram-sub label-data">THE MONTH’S SOVEREIGN HEXAGRAM · 1 OF 12</span>
      </div>
    ) : null}
  </div>
);

/** The Dreamspell oracle: the birth seal at the centre, its four partners round it. */
export const OracleCross = ({ oracle }) => (
  <div className="ski-oracle" aria-label="The Dreamspell oracle">
    {[['guide', 'GUIDE'], ['antipode', 'ANTIPODE'], ['destiny', 'DESTINY'], ['analog', 'ANALOG'], ['occult', 'OCCULT']].map(([k, t]) => (
      <div key={k} className={`ski-oracle-cell is-${k}`}>
        <span className="label-data">{t}</span>
        <span className="ski-oracle-v">{oracle[k] || '—'}</span>
      </div>
    ))}
  </div>
);

// the Lo Shu square as it is drawn — every row, column and diagonal sums to fifteen
const LO_SHU = Object.freeze([4, 9, 2, 3, 5, 7, 8, 1, 6]);

/** The Lo Shu magic square, the year's number lit; a second reading (the mewa) ringed when it differs. */
export const LoShu = ({ star, mewa = null }) => (
  <svg className="ski ski-loshu" viewBox="0 0 240 240" role="img" aria-label={`The Lo Shu square, the year's number ${star} lit`}>
    {LO_SHU.map((n, i) => {
      const x = 12 + (i % 3) * 74;
      const y = 12 + Math.floor(i / 3) * 74;
      return (
        <g key={n}>
          <rect x={x} y={y} width="68" height="68" className={n === star ? 'ski-lit' : 'ski-cell'} />
          {mewa && mewa !== star && n === mewa ? <rect x={x + 4} y={y + 4} width="60" height="60" className="ski-ring-on" /> : null}
          <text x={x + 34} y={y + 36} textAnchor="middle" dominantBaseline="central" className={n === star ? 'ski-big is-dark' : 'ski-big'}>{n}</text>
        </g>
      );
    })}
  </svg>
);
