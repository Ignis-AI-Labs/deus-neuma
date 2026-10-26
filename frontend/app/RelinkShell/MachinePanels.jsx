// MachinePanels — the machine as parts, each read where it lives: the GPU, the
// CPU and its cores, memory and its DIMMs, the drives (the board and its
// cooling are BoardPanel.jsx). Every reading is drawn as an instrument; a
// group's unit is said once in its label, not on every row.
//
// Every temperature stands against its chip's OWN high and critical marks
// (backend/services/machine-thermals.js) and is toned by its level
// (machine-health.js); the shaping is machine-view.js.

import { Bar, Chip, Dial, Lanes, StackBar, Thermo, Trace } from './hud-instruments.jsx';
import { ratioOf } from './hud-geometry.js';
import { cpuView, dimmRows, driveGroups, driveRows, ramParts, thermalAxis } from './machine-view.js';
import { gpuLimits } from './machine-health.js';
import { HeatBar, rowTone } from './heat-bar.jsx';
import { Panel } from './sub-panel.jsx';

const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const gb = (mb) => (Number.isFinite(mb) ? (mb / 1024).toFixed(1) : '—');
const ghz = (mhz) => (Number.isFinite(mhz) ? (mhz / 1000).toFixed(2) : '—');

export const GpuPanel = ({ g, tel, level, fanService, temps, span }) => {
  const util = g?.utilPct ?? tel?.utilPct;
  const powerScale = g?.powerMaxW ?? g?.powerLimitW;
  const capped = Number.isFinite(g?.powerLimitW) && g.powerLimitW < powerScale;
  const limits = gpuLimits(g);
  const maxOp = g?.tempLimits?.maxOperatingC;
  return (
    <Panel title="GPU" aside={g?.name} span={span} part="gpu" level={level}>
      <div className="hud-row">
        <Trace label="TEMP" values={temps.values} capacity={temps.capacity} span={temps.span} unit="°C" floor={50} current={tel?.tempC ?? g?.tempC}
          note={Number.isFinite(maxOp) ? `MAX ${n0(maxOp)}°` : null} />
        <Dial label="LOAD" ratio={ratioOf(util, 100)} value={n0(util)} unit="%" tone="live" />
        {/* Filling the card is the serving's design (GPU SHARE governs it): a share, never an alarm. */}
        <Dial label={tel?.unified ? 'MEMORY' : 'VRAM'} ratio={ratioOf(tel?.usedMB, tel?.totalMB)} value={gb(tel?.usedMB)} unit="G" sub={`of ${gb(tel?.totalMB)}`} tone="live" />
        <Dial label="POWER" ratio={ratioOf(g?.powerW ?? tel?.powerW, powerScale)} value={n0(g?.powerW ?? tel?.powerW)} unit="W" sub={`limit ${n0(g?.powerLimitW)}`} marks={capped ? [ratioOf(g.powerLimitW, powerScale)] : []} />
        <Dial label="FAN" ratio={ratioOf(g?.fanPct, 100)} value={n0(g?.fanPct)} unit="%" tone="live" sub={fanService?.active ? (fanService.benchRunning ? 'bench hold' : 'auto') : 'no service'} />
      </div>
      <div className="hud-cols">
        <div className="hud-stack-col">
          <span className="hud-label">CLOCKS · MHZ</span>
          <Bar name="Core" value={g?.smMHz} max={g?.smMaxMHz} text={`${n0(g?.smMHz)} / ${n0(g?.smMaxMHz)}`} tone="live" />
          <Bar name="Memory" value={g?.memMHz} max={g?.memMaxMHz} text={`${n0(g?.memMHz)} / ${n0(g?.memMaxMHz)}`} tone="live" />
          <Bar name="Mem bus" value={g?.memUtilPct} max={100} text={`${n0(g?.memUtilPct)}%`} tone="live" />
        </div>
        <div className="hud-stack-col">
          <span className="hud-label">PCIE LINK</span>
          <Lanes width={g?.pcie?.width} widthMax={g?.pcie?.widthMax} gen={g?.pcie?.gen} />
          <div className="hud-chips">
            <Chip k="STATE" v={g?.pstate ?? '—'} />
            <Chip k="DRIVER" v={g?.driver ?? '—'} />
            <Chip k="PERSIST" v={String(g?.persistence ?? '—').toUpperCase()} />
            <Chip k="CLOCK LIMIT" v={limits.length ? limits.join(', ').toUpperCase() : 'NONE'} tone={limits.length ? 'hot' : undefined} />
          </div>
        </div>
      </div>
    </Panel>
  );
};

/** The core heatmap's key: the shade runs from 0° to the cores' own high mark. */
const HeatKey = ({ high }) => (
  <span className="hud-heatkey" aria-hidden="true"><span>0</span><i /><span>{n0(high)}° high</span></span>
);

export const CpuPanel = ({ cpu, readings, level, span }) => {
  const { pkg, cores } = cpuView(readings);
  const loads = [['1 min', cpu?.load?.[0]], ['5 min', cpu?.load?.[1]], ['15 min', cpu?.load?.[2]]];
  return (
    <Panel title="CPU" aside={cpu?.model} span={span} part="cpu" level={level}>
      <div className="hud-row">
        {pkg ? <Dial label="PACKAGE" ratio={ratioOf(pkg.value, pkg.crit ?? pkg.high)} value={n0(pkg.value)} unit="°C" sub={`high ${n0(pkg.high)}`} marks={pkg.high && pkg.crit ? [ratioOf(pkg.high, pkg.crit)] : []} tone={rowTone(pkg)} title={pkg.title} /> : null}
        <Dial label="CLOCK · GHZ" ratio={ratioOf(cpu?.avgMHz, cpu?.maxMHz)} value={ghz(cpu?.avgMHz)} tone="live" sub={`peak ${ghz(cpu?.peakMHz)} · max ${ghz(cpu?.maxMHz)}`} marks={Number.isFinite(cpu?.peakMHz) ? [ratioOf(cpu.peakMHz, cpu.maxMHz)] : []} />
        <div className="hud-stack-col hud-grow">
          <span className="hud-label">LOAD · OF {n0(cpu?.threads)} THREADS</span>
          {loads.map(([name, v]) => <Bar key={name} name={name} value={v} max={cpu?.threads} text={Number.isFinite(v) ? v.toFixed(2) : '—'} />)}
        </div>
      </div>
      {cores.length ? (
        <>
          <div className="hud-label-row"><span className="hud-label">CORES · °C</span><HeatKey high={cores[0].high} /></div>
          <div className="hud-cores">
            {cores.map((c) => (
              <span key={c.key} className={`hud-core is-${rowTone(c)}`} style={{ '--heat': ratioOf(c.value, c.high ?? 100) ?? 0 }} title={c.title}>
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

export const MemoryPanel = ({ ram, readings, level, span }) => {
  const dimms = dimmRows(readings);
  const axis = thermalAxis(dimms);
  const limit = ram?.server?.cacheLimitMB;
  return (
    <Panel title="MEMORY" aside={Number.isFinite(ram?.totalMB) ? `${gb(ram.totalMB)} GB` : null} span={span} part="memory" level={level}>
      <StackBar parts={ramParts(ram)} total={ram?.totalMB} />
      {ram?.swapTotalMB ? <Bar name="Swap" value={ram.swapUsedMB} max={ram.swapTotalMB} text={`${gb(ram.swapUsedMB)} / ${gb(ram.swapTotalMB)}G`} /> : null}
      <div className="hud-chips">
        {/* 0 = the RAM prompt cache is OFF (serving-launch-config.js, 2026-10-13). */}
        <Chip k="PROMPT CACHE" v={limit === 0 ? 'OFF' : Number.isFinite(limit) ? `${gb(limit)}G LIMIT` : '—'} />
      </div>
      {dimms.length ? (
        <>
          <span className="hud-label">DIMMS · °C</span>
          <div className="hud-thermos">
            {dimms.map((d) => <Thermo key={d.key} row={d} axis={axis} tone={rowTone(d)} />)}
            <span className="hud-thermos-axis"><span>{axis}</span><span>0</span></span>
          </div>
        </>
      ) : null}
    </Panel>
  );
};

export const StoragePanel = ({ readings, drives, level, span }) => {
  const rows = driveRows(readings, drives);
  const axis = thermalAxis(rows);
  return (
    <Panel title="STORAGE" aside={`${rows.length} DRIVES · °C`} span={span} part="storage" level={level}>
      {rows.length ? driveGroups(rows).map((g) => (
        <div key={g.model} className="hud-group">
          <span className="hud-label is-name">{g.model}{g.rows.length > 1 ? ` ×${g.rows.length}` : ''}</span>
          {g.rows.map((d) => <HeatBar key={d.key} row={d} axis={axis} />)}
        </div>
      )) : <p className="sub-empty-row label-data">no drive reported a temperature</p>}
    </Panel>
  );
};
