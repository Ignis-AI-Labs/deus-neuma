// SkyRings — the sky instruments drawn as rings: the tropical wheel of the
// instant, the Haab' year, the Moon's mansions, the tithis and the dasha
// years, the seven days, the Burmese compass, the decans. Presentational —
// every number arrives from sky-plates.js; the math from sky-geometry.js.
// Its own place in each ring is lit in the being's soul colour (--soul).

import { clockPoint, chartPoint, sector, arc, moonLitPath, lanesOf } from './sky-geometry.js';

const C = 200; // every ring is drawn in a 400 × 400 box
const Box = ({ label, children, size = 400 }) => (
  <svg className="ski" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>{children}</svg>
);
const Label = ({ at, children, className = 'ski-label' }) => <text x={at[0]} y={at[1]} className={className} textAnchor="middle" dominantBaseline="central">{children}</text>;

const BODY_MARK = Object.freeze({ sun: 'SU', moon: 'MO', mercury: 'ME', venus: 'VE', mars: 'MA', jupiter: 'JU', saturn: 'SA', uranus: 'UR', neptune: 'NE', pluto: 'PL' });
const TENSE = new Set(['square', 'opposition']);

/**
 * The tropical sky: twelve signs, every body at its true longitude, the aspects
 * as chords. Given the place's `angles`, the wheel turns so the ascendant lies
 * on the eastern horizon (the left, as charts are drawn), with the horizon and
 * the meridian across it and the twelve whole-sign houses numbered.
 */
export const SkyWheel = ({ wheel, signs, label, angles = null }) => {
  const turn = angles ? angles.ascendant.longitude : 0;
  const cp = (r, lon) => chartPoint(C, C, r, lon - turn);
  const lanes = lanesOf(wheel.bodies);
  const at = Object.fromEntries(wheel.bodies.map((b) => [b.key, cp(128 - lanes.get(b.key) * 20, b.longitude)]));
  const chordAt = Object.fromEntries(wheel.bodies.map((b) => [b.key, cp(96, b.longitude)]));
  return (
    <Box label={label}>
      <circle cx={C} cy={C} r={186} className="ski-line" />
      <circle cx={C} cy={C} r={156} className="ski-line" />
      <circle cx={C} cy={C} r={96} className="ski-line ski-faint" />
      {Array.from({ length: 72 }, (_, i) => {
        const lon = i * 5;
        const [x1, y1] = cp(156, lon);
        const [x2, y2] = cp(i % 6 === 0 ? 186 : i % 2 === 0 ? 164 : 160, lon);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={i % 6 === 0 ? 'ski-line' : 'ski-tick'} />;
      })}
      {signs.map((s, i) => <Label key={s} at={cp(171, i * 30 + 15)}>{s}</Label>)}
      {wheel.aspects.map((a) => (
        <line key={`${a.a}-${a.b}-${a.aspect}`} x1={chordAt[a.a][0]} y1={chordAt[a.a][1]} x2={chordAt[a.b][0]} y2={chordAt[a.b][1]}
          className={`ski-chord${TENSE.has(a.aspect) ? ' is-tense' : ''}`} />
      ))}
      {wheel.bodies.map((b) => {
        const [x, y] = at[b.key];
        const [tx, ty] = cp(156, b.longitude);
        return (
          <g key={b.key} className={`ski-body is-${b.key}`}>
            <line x1={tx} y1={ty} x2={x} y2={y} className="ski-tick" />
            {b.key === 'moon' ? (
              <g>
                <circle cx={x} cy={y} r={9} className="ski-moon-dark" />
                <path d={moonLitPath(x, y, 9, wheel.moon.angle)} className="ski-moon-lit" />
              </g>
            ) : <circle cx={x} cy={y} r={b.key === 'sun' ? 7 : 4} className={b.key === 'sun' ? 'ski-lit' : 'ski-dot'} />}
            <Label at={[x, y + (b.key === 'moon' ? 17 : 13)]} className="ski-mark">{BODY_MARK[b.key]}{b.retrograde ? ' ℞' : ''}</Label>
          </g>
        );
      })}
      {angles ? (
        <g className="ski-axes">
          {[['ASC', angles.ascendant.longitude], ['MC', angles.midheaven.longitude]].map(([name, lon]) => {
            const [x1, y1] = cp(190, lon);
            const [x2, y2] = cp(190, lon + 180);
            const [lx, ly] = cp(198, lon);
            return <g key={name}><line x1={x1} y1={y1} x2={x2} y2={y2} className="ski-axis" /><Label at={lx < C - 150 ? [lx - 8, ly] : [lx, ly - 8]} className="ski-label is-on">{name}</Label></g>;
          })}
          {angles.houses.map((h) => <Label key={h.house} at={cp(84, h.cuspLongitude + 15)} className="ski-label is-tiny">{h.house}</Label>)}
        </g>
      ) : null}
      <circle cx={C} cy={C} r={3} className="ski-earth" />
    </Box>
  );
};

/** The Haab': 365 days round the year, the months in 20s and the five nameless days, its day lit. */
export const HaabRing = ({ months, at, label }) => {
  const day = 360 / 365;
  return (
    <Box label={label}>
      {Array.from({ length: 365 }, (_, i) => {
        const [x1, y1] = clockPoint(C, C, 150, i * day);
        const [x2, y2] = clockPoint(C, C, i % 20 === 0 ? 176 : 160, i * day);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={i % 20 === 0 ? 'ski-line' : 'ski-tick'} />;
      })}
      {months.map((m, i) => <Label key={m} at={clockPoint(C, C, 188, (i * 20 + (i === 18 ? 2.5 : 10)) * day)} className="ski-label is-small">{m.toUpperCase()}</Label>)}
      <path d={sector(C, C, 142, 180, at * day, (at + 1) * day)} className="ski-lit" />
      <line x1={C} y1={C} x2={clockPoint(C, C, 140, (at + 0.5) * day)[0]} y2={clockPoint(C, C, 140, (at + 0.5) * day)[1]} className="ski-hand" />
      <circle cx={C} cy={C} r={124} className="ski-line ski-faint" />
      <Label at={[C, C - 10]} className="ski-big">{months[Math.floor(at / 20)]?.toUpperCase()}</Label>
      <Label at={[C, C + 18]} className="ski-label">DAY {at % 20}</Label>
    </Box>
  );
};

/** The Moon's mansions: 27 × 4 padas inside the 12 sidereal signs, the Moon at its sidereal degree. */
export const MansionsRing = ({ nakshatras, rashis, moonDeg, lit, sunRashi, label }) => {
  const pada = 360 / 108;
  // sidereal longitude, chart convention — converted to the clock angles the sectors take
  const toClock = (lon) => 270 - lon;
  return (
    <Box label={label}>
      {rashis.map((r, i) => (
        <g key={r}>
          <path d={sector(C, C, 160, 188, toClock((i + 1) * 30), toClock(i * 30))} className={`ski-cell${i === sunRashi ? ' is-sun' : ''}`} />
          <Label at={chartPoint(C, C, 174, i * 30 + 15)} className="ski-label is-small">{r.slice(0, 4).toUpperCase()}</Label>
        </g>
      ))}
      {Array.from({ length: 108 }, (_, i) => (
        <path key={i} d={sector(C, C, i % 4 === 0 ? 112 : 120, 152, toClock((i + 1) * pada), toClock(i * pada))}
          className={`ski-cell${i === lit ? ' ski-lit' : Math.floor(i / 4) === Math.floor(lit / 4) ? ' is-near' : ''}`} />
      ))}
      {Array.from({ length: 27 }, (_, i) => <Label key={i} at={chartPoint(C, C, 100, i * 13.333 + 6.667)} className="ski-label is-tiny">{i + 1}</Label>)}
      {moonDeg !== null ? (() => {
        const [x, y] = chartPoint(C, C, 136, moonDeg);
        return <g><line x1={C} y1={C} x2={x} y2={y} className="ski-hand" /><circle cx={x} cy={y} r={5} className="ski-dot is-bright" /></g>;
      })() : null}
      <Label at={[C, C - 10]} className="ski-big">{nakshatras[Math.floor(lit / 4)]?.toUpperCase()}</Label>
      <Label at={[C, C + 16]} className="ski-label">PADA {(lit % 4) + 1}</Label>
    </Box>
  );
};

/** The tithis as the Moon's thirty faces, and the 120 dasha years at their true lengths. */
export const PanchangaRings = ({ tithi, dasha, lord, balance, label }) => {
  const year = 360 / 120;
  const current = dasha.find((d) => d.lord === lord);
  return (
    <Box label={label}>
      {Array.from({ length: 30 }, (_, i) => {
        const [x, y] = clockPoint(C, C, 172, i * 12 + 6);
        const on = i + 1 === tithi;
        return (
          <g key={i} className={on ? 'ski-tithi is-on' : 'ski-tithi'}>
            <circle cx={x} cy={y} r={on ? 11 : 8} className="ski-moon-dark" />
            <path d={moonLitPath(x, y, on ? 11 : 8, i * 12 + 6)} className={on ? 'ski-moon-lit is-on' : 'ski-moon-lit'} />
            {on ? <circle cx={x} cy={y} r={15} className="ski-ring-on" /> : null}
          </g>
        );
      })}
      {dasha.map((d) => (
        <g key={d.lord}>
          <path d={sector(C, C, 104, 132, d.start * year, (d.start + d.years) * year)} className={`ski-cell${d.lord === lord ? ' is-near' : ''}`} />
          <Label at={clockPoint(C, C, 118, (d.start + d.years / 2) * year)} className="ski-label is-small">{d.lord.slice(0, 3).toUpperCase()}</Label>
        </g>
      ))}
      {current && Number.isFinite(balance) ? (
        <path d={sector(C, C, 134, 140, (current.start + current.years - balance) * year, (current.start + current.years) * year)} className="ski-lit" />
      ) : null}
      <Label at={[C, C - 10]} className="ski-big">TITHI {tithi}</Label>
      <Label at={[C, C + 16]} className="ski-label">{tithi <= 15 ? 'SHUKLA · WAXING' : 'KRISHNA · WANING'}</Label>
    </Box>
  );
};

/** Seven days round, its day lit — the Akan soul names. */
export const DaysRing = ({ days, lit, label }) => (
  <Box label={label}>
    {days.map((d, i) => (
      <g key={d}>
        <path d={sector(C, C, 110, 170, i * (360 / 7) + 1, (i + 1) * (360 / 7) - 1)} className={`ski-cell${i === lit ? ' ski-lit' : ''}`} />
        <Label at={clockPoint(C, C, 140, (i + 0.5) * (360 / 7))} className={i === lit ? 'ski-label is-on' : 'ski-label'}>{d}</Label>
      </g>
    ))}
  </Box>
);

/** The eight planetary posts round a pagoda, its post lit. */
export const CompassRose = ({ posts, lit, label }) => (
  <Box label={label}>
    <circle cx={C} cy={C} r={150} className="ski-line ski-faint" />
    <circle cx={C} cy={C} r={60} className="ski-line ski-faint" />
    {posts.map((p, i) => {
      const [x, y] = clockPoint(C, C, 150, p.deg);
      const [lx, ly] = clockPoint(C, C, 182, p.deg);
      const on = i === lit;
      return (
        <g key={p.sign}>
          <line x1={clockPoint(C, C, 60, p.deg)[0]} y1={clockPoint(C, C, 60, p.deg)[1]} x2={x} y2={y} className={on ? 'ski-hand' : 'ski-tick'} />
          <circle cx={x} cy={y} r={on ? 9 : 5} className={on ? 'ski-lit' : 'ski-dot'} />
          <Label at={[lx, ly - 7]} className={on ? 'ski-label is-on' : 'ski-label'}>{p.dir}</Label>
          <Label at={[lx, ly + 8]} className="ski-label is-tiny">{p.day}</Label>
        </g>
      );
    })}
    <Label at={[C, C - 8]} className="ski-big">{posts[lit]?.sign.toUpperCase()}</Label>
    <Label at={[C, C + 16]} className="ski-label">{posts[lit]?.planet.toUpperCase()}</Label>
  </Box>
);

/** The thirty-six decans, three to a sign, the Sun's and the Moon's lit. */
export const DecanRing = ({ signs, sun, moon, label }) => {
  const toClock = (lon) => 270 - lon;
  return (
    <Box label={label}>
      {signs.map((s, i) => <Label key={s} at={chartPoint(C, C, 182, i * 30 + 15)} className="ski-label is-small">{s}</Label>)}
      {Array.from({ length: 36 }, (_, i) => (
        <path key={i} d={sector(C, C, i % 3 === 0 ? 112 : 120, 166, toClock((i + 1) * 10), toClock(i * 10))}
          className={`ski-cell${i === sun ? ' ski-lit' : i === moon ? ' is-moon' : ''}`} />
      ))}
      <path d={arc(C, C, 104, 0, 359.99)} className="ski-line ski-faint" />
      <Label at={[C, C - 10]} className="ski-big">DECAN {sun + 1}</Label>
      <Label at={[C, C + 16]} className="ski-label">OF 36{moon !== null ? ` · MOON ${moon + 1}` : ''}</Label>
    </Box>
  );
};

/** Any day count drawn round: its N places (labelled when few enough to read), its place lit, a centre line. */
export const CycleRing = ({ count, labels = null, lit, big = null, small = null, label }) => {
  const step = 360 / count;
  return (
    <Box label={label}>
      {Array.from({ length: count }, (_, i) => (
        <g key={i}>
          <path d={sector(C, C, count > 30 ? 142 : 116, 172, i * step + (count > 30 ? 0.4 : 1), (i + 1) * step - (count > 30 ? 0.4 : 1))} className={`ski-cell${i === lit ? ' ski-lit' : ''}`} />
          {labels ? <Label at={clockPoint(C, C, count > 12 ? 186 : 144, (i + 0.5) * step)} className={i === lit ? `ski-label is-on${count > 12 ? '' : ' is-in'}` : count > 12 ? 'ski-label is-tiny' : 'ski-label'}>{labels[i]}</Label> : null}
        </g>
      ))}
      {big ? <Label at={[C, C - 10]} className="ski-big">{big}</Label> : null}
      {small ? <Label at={[C, C + 16]} className="ski-label">{small}</Label> : null}
    </Box>
  );
};

/** A lunar month as its thirty faces of the Moon, new at the top; its day lit. */
export const LunarMonthRing = ({ day, big, small, label }) => (
  <Box label={label}>
    {Array.from({ length: 30 }, (_, i) => {
      const [x, y] = clockPoint(C, C, 168, i * 12);
      const on = i + 1 === day;
      const r = on ? 11 : 7;
      return (
        <g key={i}>
          <circle cx={x} cy={y} r={r} className="ski-moon-dark" />
          <path d={moonLitPath(x, y, r, (i / 29.53) * 360)} className={on ? 'ski-moon-lit is-on' : 'ski-moon-lit'} />
          {on ? <circle cx={x} cy={y} r={15} className="ski-ring-on" /> : null}
        </g>
      );
    })}
    <Label at={[C, C - 10]} className="ski-big">{big}</Label>
    <Label at={[C, C + 16]} className="ski-label">{small}</Label>
  </Box>
);

/** The 28 lodges at their true widths in right ascension (of date), the Moon's lit, the almanac's marked. */
export const LodgesRing = ({ starts, names, moonIndex, moonRa, dayIndex, label }) => {
  // right ascension grows eastward — drawn counter-clockwise from the top, 0h at the top
  const toClock = (ra) => 360 - ra;
  return (
    <Box label={label}>
      {starts.map((s, i) => {
        const end = starts[(i + 1) % 28];
        const span = ((end - s) % 360 + 360) % 360;
        const mid = s + span / 2;
        return (
          <g key={i}>
            <path d={sector(C, C, 128, 170, toClock(s + span), toClock(s))} className={`ski-cell${i === moonIndex ? ' ski-lit' : i === dayIndex ? ' is-moon' : ''}`} />
            <Label at={clockPoint(C, C, 184, toClock(mid))} className={i === moonIndex ? 'ski-label is-on' : 'ski-label is-small'}>{names[i]}</Label>
          </g>
        );
      })}
      {(() => { const [x, y] = clockPoint(C, C, 149, toClock(moonRa)); return <g><line x1={C} y1={C} x2={x} y2={y} className="ski-hand" /><circle cx={x} cy={y} r={5} className="ski-dot is-bright" /></g>; })()}
      <Label at={[C, C - 10]} className="ski-big">{names[moonIndex]}</Label>
      <Label at={[C, C + 16]} className="ski-label">THE MOON’S LODGE</Label>
    </Box>
  );
};
