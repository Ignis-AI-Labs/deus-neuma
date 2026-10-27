// BoardPanel — the board and its cooling: the board's sensors by plain name,
// the inputs its chip leaves unlabelled, the fans as rotors, the supply rails
// against the ATX tolerance.
//
// A reading that cannot be believed (machine-sense.js: a 0° register, an
// open input at the chip's ceiling, a floating input that jumps between
// reads) is never drawn as heat: it is set apart, named, with its reason one
// press away.

import { Chip, Drift } from './hud-instruments.jsx';
import { ATX_TOLERANCE, boardGroups, fanGroups, railView, thermalAxis } from './machine-view.js';
import { HeatBar, rowTone } from './heat-bar.jsx';
import { Panel } from './sub-panel.jsx';

const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');

const Rotor = ({ idle }) => (
  <svg className={`hud-rotor${idle ? ' is-idle' : ''}`} width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    <circle cx="6" cy="6" r="5.5" />
    {idle ? null : <path d="M6 6 C6 3 8 2 9 3 M6 6 C9 6 10 8 9 9 M6 6 C6 9 4 10 3 9 M6 6 C3 6 2 4 3 3" />}
  </svg>
);

/** One controller's fans: a rotor and its rpm per spinning fan, a hollow rotor per header reading 0 rpm. */
const FanRow = ({ group }) => (
  <div className="hud-fans">
    <span className="hud-fans-src">{group.source}</span>
    {group.spinning.map((f) => (
      <span key={f.key} className="hud-fan" title={`${f.name} · ${n0(f.rpm)} rpm`}><Rotor /><b>{n0(f.rpm)}</b></span>
    ))}
    {group.idle ? (
      <span className="hud-fan is-idle" title={`${group.idle} header${group.idle > 1 ? 's' : ''} reading 0 rpm — nothing turning on ${group.idle > 1 ? 'them' : 'it'}`}>
        {Array.from({ length: group.idle }, (_, i) => <Rotor key={i} idle />)}<b>0</b>
      </span>
    ) : null}
  </div>
);

/** The readings set apart as not believable, named in the summary, each reason one press away. */
const Doubted = ({ rows }) => (
  <details className="hud-more hud-doubt">
    <summary>
      <span className="hud-doubt-mark" aria-hidden="true" />
      <span className="hud-label">NOT BELIEVED · {rows.map((r) => r.name).join(', ')}</span>
    </summary>
    <ul className="hud-doubt-list">
      {rows.map((r) => (
        <li key={r.key} title={r.title}><b>{r.name}</b><span>{n0(r.value)}° now</span><span>{r.why}</span></li>
      ))}
    </ul>
  </details>
);

export const BoardPanel = ({ readings, doubt, level, span }) => {
  const { named, inputs, doubted } = boardGroups(readings, doubt);
  const axis = thermalAxis([...named, ...inputs]);
  const rails = railView(readings);
  return (
    <Panel title="BOARD · COOLING" span={span} part="board" level={level}>
      <div className="hud-cols">
        <div className="hud-stack-col">
          <span className="hud-label">SENSORS · °C</span>
          {named.map((b) => <HeatBar key={b.key} row={b} axis={axis} />)}
          {inputs.length ? (
            <>
              <span className="hud-label">UNLABELLED INPUTS · °C</span>
              <div className="hud-inputs">
                {inputs.map((b) => (
                  <span key={b.key} className={`hud-input is-${rowTone(b)}`} title={b.title}><b>{n0(b.value)}</b><i>{b.name.replace(/^Input /, '')}</i></span>
                ))}
              </div>
            </>
          ) : null}
          {doubted.length ? <Doubted rows={doubted} /> : null}
        </div>
        <div className="hud-stack-col">
          <span className="hud-label">FANS · RPM</span>
          {fanGroups(readings).map((g) => <FanRow key={g.source} group={g} />)}
          <span className="hud-label">RAILS · ATX ±{ATX_TOLERANCE * 100}%</span>
          {rails.named.map((r) => <Drift key={r.key} name={r.name} value={r.value} drift={r.drift} tolerance={ATX_TOLERANCE} />)}
          {rails.bare.length ? (
            <details className="hud-more">
              <summary className="hud-label">{rails.bare.length} UNLABELLED VOLTAGES</summary>
              <div className="hud-chips">{rails.bare.map((r) => <Chip key={r.key} k={r.name} v={`${r.value.toFixed(2)}V`} />)}</div>
            </details>
          ) : null}
        </div>
      </div>
    </Panel>
  );
};
