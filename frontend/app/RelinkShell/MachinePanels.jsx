// MachinePanels — the machine as parts, each read where it lives: the GPU, the
// CPU and its cores, memory and its DIMMs, the drives, the board and its
// cooling — every reading that matters for thermal control, drawn as an
// instrument rather than a line of text.
//
// Every temperature stands against its chip's OWN high and critical marks
// (backend/services/machine-thermals.js); the shaping is machine-view.js.

import { Bar, Chip, Dial, Drift, Lanes, StackBar, Thermo, Trace, heatTone } from './hud-instruments.jsx';
import { ratioOf } from './hud-geometry.js';
import { ATX_TOLERANCE, boardRows, cpuView, dimmRows, driveRows, fanGroups, hotRows, railView, ramParts, thermalAxis } from './machine-view.js';
import { Panel } from './sub-panel.jsx';

const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const gb = (mb) => (Number.isFinite(mb) ? (mb / 1024).toFixed(1) : '—');
const ghz = (mhz) => (Number.isFinite(mhz) ? (mhz / 1000).toFixed(2) : '—');
const deg = (v) => (Number.isFinite(v) ? `${v.toFixed(0)}°` : '—');
const markList = (row) => [{ kind: 'high', at: row.high }, { kind: 'crit', at: row.crit }];

/** One temperature as a bar on its group's axis, marked at its own limits. */
const HeatBar = ({ row, axis }) => (
  <Bar name={row.name} value={row.value} max={axis} marks={markList(row)} text={deg(row.value)} tone={heatTone(row.state)} title={row.title} />
);

/** Everything past its own mark, named — the strip leads the console only when something is. */
export const AlertStrip = ({ machine }) => {
  if (!machine?.alerts?.length) return null;
  const r = machine.readings;
  const hot = hotRows([...dimmRows(r), ...driveRows(r), ...boardRows(r), ...cpuView(r).cores, cpuView(r).pkg].filter(Boolean));
  const other = machine.alerts.filter((a) => !hot.some((h) => a.includes(`(${h.chip})`)));
  return (
    <div className="hud-alerts" role="status" title={machine.alerts.join('\n')}>
      <span className="hud-alerts-count">{machine.alerts.length}</span>
      <span className="hud-alerts-label">PAST THEIR OWN MARK</span>
      {hot.map((h) => <Chip key={h.key} k={h.name} v={`${h.value.toFixed(1)}° / ${n0(h.state === 'critical' ? h.crit : h.high)}°`} tone={heatTone(h.state)} />)}
      {other.map((a) => <Chip key={a} k="GPU" v={a.replace(/^GPU /, '')} tone="hot" />)}
    </div>
  );
};

export const GpuPanel = ({ g, tel, alerts = [], fanService, temps, span }) => {
  const util = g?.utilPct ?? tel?.utilPct;
  const powerScale = g?.powerMaxW ?? g?.powerLimitW;
  const capped = Number.isFinite(g?.powerLimitW) && g.powerLimitW < powerScale;
  const limited = alerts.some((a) => /^GPU clocks limited/.test(a));
  return (
    <Panel title="GPU" aside={g?.name} span={span}>
      <div className="hud-row">
        <Dial label="LOAD" ratio={ratioOf(util, 100)} value={n0(util)} unit="%" tone="live" />
        <Dial label={tel?.unified ? 'MEMORY' : 'VRAM'} ratio={ratioOf(tel?.usedMB, tel?.totalMB)} value={gb(tel?.usedMB)} unit="G" sub={`of ${gb(tel?.totalMB)}G`} />
        <Dial label="POWER" ratio={ratioOf(g?.powerW ?? tel?.powerW, powerScale)} value={n0(g?.powerW ?? tel?.powerW)} unit="W" sub={`limit ${n0(g?.powerLimitW)}W`} marks={capped ? [ratioOf(g.powerLimitW, powerScale)] : []} />
        <Dial label="FAN" ratio={ratioOf(g?.fanPct, 100)} value={n0(g?.fanPct)} unit="%" tone="live" sub={fanService?.active ? (fanService.benchRunning ? 'bench hold' : 'auto') : 'no service'} />
        <Trace label="TEMP" values={temps.values} capacity={temps.capacity} span={temps.span} unit="°C" floor={50} current={tel?.tempC ?? g?.tempC} />
      </div>
      <div className="hud-cols">
        <div className="hud-stack-col">
          <Bar name="CORE" value={g?.smMHz} max={g?.smMaxMHz} text={`${n0(g?.smMHz)}/${n0(g?.smMaxMHz)} MHz`} tone="live" />
          <Bar name="MEMORY" value={g?.memMHz} max={g?.memMaxMHz} text={`${n0(g?.memMHz)}/${n0(g?.memMaxMHz)} MHz`} tone="live" />
          <Bar name="MEM BUS" value={g?.memUtilPct} max={100} text={`${n0(g?.memUtilPct)}%`} tone="live" />
        </div>
        <div className="hud-stack-col">
          <span className="hud-label">PCIE LINK</span>
          <Lanes width={g?.pcie?.width} widthMax={g?.pcie?.widthMax} gen={g?.pcie?.gen} />
          <div className="hud-chips">
            <Chip k="STATE" v={g?.pstate ?? '—'} />
            <Chip k="DRIVER" v={g?.driver ?? '—'} />
            <Chip k="PERSIST" v={String(g?.persistence ?? '—').toUpperCase()} />
            <Chip k="CLOCK LIMIT" v={g?.clockReasons?.length ? g.clockReasons.join(', ').toUpperCase() : 'NONE'} tone={limited ? 'hot' : undefined} />
          </div>
        </div>
      </div>
    </Panel>
  );
};

export const CpuPanel = ({ cpu, readings, span }) => {
  const { pkg, cores } = cpuView(readings);
  const [l1, l5, l15] = cpu?.load ?? [];
  return (
    <Panel title="CPU" aside={cpu?.model} span={span}>
      <div className="hud-row">
        <Dial label="CLOCK · GHZ" ratio={ratioOf(cpu?.avgMHz, cpu?.maxMHz)} value={ghz(cpu?.avgMHz)} tone="live" sub={`peak ${ghz(cpu?.peakMHz)} · max ${ghz(cpu?.maxMHz)}`} marks={Number.isFinite(cpu?.peakMHz) ? [ratioOf(cpu.peakMHz, cpu.maxMHz)] : []} />
        <Dial label="LOAD" ratio={ratioOf(l1, cpu?.threads)} value={Number.isFinite(l1) ? l1.toFixed(1) : '—'} sub={`of ${n0(cpu?.threads)} threads`} />
        {pkg ? <Dial label="PACKAGE" ratio={ratioOf(pkg.value, pkg.crit ?? pkg.high)} value={n0(pkg.value)} unit="°C" sub={`high ${n0(pkg.high)}`} marks={pkg.high && pkg.crit ? [ratioOf(pkg.high, pkg.crit)] : []} tone={heatTone(pkg.state)} title={pkg.title} /> : null}
        <div className="hud-stack-col hud-grow">
          <Bar name="1 MIN" value={l1} max={cpu?.threads} text={Number.isFinite(l1) ? l1.toFixed(2) : '—'} />
          <Bar name="5 MIN" value={l5} max={cpu?.threads} text={Number.isFinite(l5) ? l5.toFixed(2) : '—'} />
          <Bar name="15 MIN" value={l15} max={cpu?.threads} text={Number.isFinite(l15) ? l15.toFixed(2) : '—'} />
        </div>
      </div>
      {cores.length ? (
        <>
          <span className="hud-label">CORES · °C · DEEPER SHADE = NEARER ITS OWN HIGH MARK ({n0(cores[0].high)}°)</span>
          <div className="hud-cores">
            {cores.map((c) => (
              <span key={c.key} className={`hud-core is-${heatTone(c.state)}`} style={{ '--heat': ratioOf(c.value, c.high ?? 100) ?? 0 }} title={c.title}>
                <b>{n0(c.value)}</b><i>{c.name}</i>
              </span>
            ))}
          </div>
        </>
      ) : null}
      <div className="hud-chips">
        <Chip k="GOVERNOR" v={String(cpu?.governor ?? '—').toUpperCase()} />
        <Chip k="ENERGY" v={String(cpu?.energyPreference ?? '—').replace(/_/g, ' ').toUpperCase()} />
        <Chip k="TURBO" v={cpu?.turbo === null || cpu?.turbo === undefined ? '—' : cpu.turbo ? 'ON' : 'OFF'} />
      </div>
    </Panel>
  );
};

export const MemoryPanel = ({ ram, readings, span }) => {
  const dimms = dimmRows(readings);
  const axis = thermalAxis(dimms);
  const limit = ram?.server?.cacheLimitMB;
  return (
    <Panel title="MEMORY" aside={Number.isFinite(ram?.totalMB) ? `${gb(ram.totalMB)} GB` : null} span={span}>
      <StackBar parts={ramParts(ram)} total={ram?.totalMB} />
      {ram?.swapTotalMB ? <Bar name="SWAP" value={ram.swapUsedMB} max={ram.swapTotalMB} text={`${gb(ram.swapUsedMB)}/${gb(ram.swapTotalMB)}G`} /> : null}
      <div className="hud-chips">
        {/* 0 = the RAM prompt cache is OFF (serving-launch-config.js, 2026-10-13). */}
        <Chip k="PROMPT CACHE" v={limit === 0 ? 'OFF' : Number.isFinite(limit) ? `${gb(limit)}G LIMIT` : '—'} />
      </div>
      {dimms.length ? (
        <div className="hud-thermos">
          {dimms.map((d) => <Thermo key={d.key} row={d} axis={axis} />)}
          <span className="hud-thermos-axis"><span>{axis}°</span><span>0°</span></span>
        </div>
      ) : null}
    </Panel>
  );
};

export const StoragePanel = ({ readings, span }) => {
  const drives = driveRows(readings);
  const axis = thermalAxis(drives);
  return (
    <Panel title="STORAGE" aside={`${drives.length} DRIVES · 0–${axis}°C`} span={span}>
      {drives.length ? drives.map((d) => <HeatBar key={d.key} row={d} axis={axis} />) : <p className="sub-empty-row label-data">no drive reported a temperature</p>}
    </Panel>
  );
};

const RotorIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    <circle cx="6" cy="6" r="5.5" />
    <path d="M6 6 C6 3 8 2 9 3 M6 6 C9 6 10 8 9 9 M6 6 C6 9 4 10 3 9 M6 6 C3 6 2 4 3 3" />
  </svg>
);

export const BoardPanel = ({ readings, span }) => {
  const board = boardRows(readings);
  const axis = thermalAxis(board);
  const fans = fanGroups(readings);
  const rails = railView(readings);
  return (
    <Panel title="BOARD · COOLING" aside={`TEMPS 0–${axis}°C`} span={span}>
      <div className="hud-grid2">
        {board.map((b) => <HeatBar key={b.key} row={b} axis={axis} />)}
      </div>
      <div className="hud-cols">
        <div className="hud-stack-col">
          <span className="hud-label">FANS</span>
          {fans.map((g) => (
            <div key={g.source} className="hud-fans">
              <span className="hud-fans-src">{g.source}</span>
              {g.spinning.map((f) => <span key={f.key} className="hud-fan"><RotorIcon />{f.name}<b>{n0(f.rpm)}</b><span className="hud-unit">rpm</span></span>)}
              {g.idle ? <span className="hud-fan is-idle">{g.idle} HEADER{g.idle > 1 ? 'S' : ''} AT 0 RPM</span> : null}
            </div>
          ))}
        </div>
        <div className="hud-stack-col">
          <span className="hud-label">RAILS · ATX ±{ATX_TOLERANCE * 100}%</span>
          {rails.named.map((r) => <Drift key={r.key} name={r.name} value={r.value} drift={r.drift} tolerance={ATX_TOLERANCE} />)}
          {rails.bare.length ? (
            <details className="hud-more">
              <summary className="hud-label">{rails.bare.length} BOARD INPUTS (UNLABELLED BY THE CHIP)</summary>
              <div className="hud-chips">{rails.bare.map((r) => <Chip key={r.key} k={r.name} v={`${r.value.toFixed(2)}V`} />)}</div>
            </details>
          ) : null}
        </div>
      </div>
    </Panel>
  );
};
