// MachineCard — every thermal and tuning reading this machine offers, live
// (Design note, 2026-10-20: […]).
//
// Each temperature is shown against its chip's OWN high and critical marks
// (machine-thermals.js); anything past them leads the card as an alert.

import { useCallback, useEffect, useState } from 'react';
import { loadMachine } from './machine-client.js';
import { useVisibleInterval } from './use-visible-interval.js';

const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const c1 = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}°C` : '—');
const mark = (r) => (r.state === 'critical' || r.state === 'hot' ? 'rec-warn' : 'rec-sig');

/** pure — one temperature against its own marks: […]. */
export const tempLine = (r) => `${c1(r.value)}${Number.isFinite(r.high) && r.high > 0 ? ` (high ${n0(r.high)}${Number.isFinite(r.crit) && r.crit > 0 ? ` · crit ${n0(r.crit)}` : ''})` : ''}`;

/** pure — a chip's own short name: DIMMs by slot (SPD hub 0x50 = DIMM 1), drives by PCI address. */
export const chipName = (chip) => {
  const dimm = /^spd5118-i2c-\d+-5([0-7])$/.exec(chip);
  if (dimm) return `DIMM ${Number(dimm[1]) + 1}`;
  const nvme = /^nvme-pci-([0-9a-f]+)$/.exec(chip);
  if (nvme) return `nvme ${nvme[1]}`;
  return chip.replace(/-(i2c|pci|isa|acpi|virtual|mdio).*$/, '');
};

const Row = ({ k, children }) => (
  <p className="rec-line label-data">{k} · {children}</p>
);

const Temps = ({ title, rows }) => (rows.length === 0 ? null : (
  <Row k={title}>
    {rows.map((r, i) => (
      <span key={`${r.chip}-${r.label}`}>{i ? ' · ' : ''}{r.label === 'temp1' || r.label === 'Composite' ? chipName(r.chip) : r.label} <span className={mark(r)}>{tempLine(r)}</span></span>
    ))}
  </Row>
));

export const MachineCard = () => {
  const [m, setM] = useState(undefined);
  const refresh = useCallback(async () => setM(await loadMachine()), []);
  useEffect(() => { refresh(); }, [refresh]);
  const watch = useVisibleInterval(refresh, 5000);

  if (m === undefined) return <p className="rec-line label-data">MACHINE · READING…</p>;
  if (m === null) return <p className="rec-line label-data">MACHINE · UNREADABLE — the platform did not answer</p>;

  const of = (kind, type = 'temp') => m.readings.filter((r) => r.kind === kind && r.type === type);
  const cpuTemps = of('cpu');
  const pkg = cpuTemps.find((r) => /package/i.test(r.label));
  const hottestCore = cpuTemps.filter((r) => /^core/i.test(r.label)).sort((a, b) => b.value - a.value)[0];
  const g = m.gpu;
  const fans = m.readings.filter((r) => r.type === 'fan');
  const rails = m.readings.filter((r) => r.type === 'volt');

  return (
    <div className="rec-cap" ref={watch}>
      {m.alerts.length ? m.alerts.map((a) => <p key={a} className="rec-warn">⚠ {a}</p>) : <p className="rec-line label-data">ALERTS · none — every reading is under its own high mark</p>}
      {g ? (
        <>
          <Row k="GPU">{g.name} · driver {g.driver} · {g.pstate} · persistence {String(g.persistence).toLowerCase()}</Row>
          <Row k="GPU THERMAL">
            <span className="rec-sig">{n0(g.tempC)}°C</span> · fans {n0(g.fanPct)}%
            {m.fanService.active ? (m.fanService.benchRunning ? ' (bench-fans: holding full while a benchmark runs)' : ' (bench-fans: automatic until a benchmark runs)') : ' (bench-fans service not running)'}
          </Row>
          <Row k="GPU POWER · CLOCKS">{n0(g.powerW)} / {n0(g.powerLimitW)} W (max {n0(g.powerMaxW)}) · core {n0(g.smMHz)} / {n0(g.smMaxMHz)} MHz · memory {n0(g.memMHz)} / {n0(g.memMaxMHz)} MHz · load {n0(g.utilPct)}% · memory bus {n0(g.memUtilPct)}%</Row>
          <Row k="GPU LINK · LIMITS">PCIe gen {n0(g.pcie?.gen)} x{n0(g.pcie?.width)} (card supports x{n0(g.pcie?.widthMax)}) · clock limits: {g.clockReasons?.length ? g.clockReasons.map((r) => (r === 'Reliability' ? 'Reliability (the normal boost voltage cap)' : r)).join(', ') : 'none'}</Row>
        </>
      ) : <Row k="GPU">no NVIDIA card answered</Row>}
      <Row k="CPU">{m.cpu.model ?? '—'} · {n0(m.cpu.threads)} threads · avg {n0(m.cpu.avgMHz)} / peak {n0(m.cpu.peakMHz)} / max {n0(m.cpu.maxMHz)} MHz · governor {m.cpu.governor ?? '—'} · energy {m.cpu.energyPreference ?? '—'} · turbo {m.cpu.turbo === null ? '—' : m.cpu.turbo ? 'on' : 'off'} · load {m.cpu.load?.join(' / ') ?? '—'}</Row>
      {pkg ? <Row k="CPU THERMAL">package <span className={mark(pkg)}>{tempLine(pkg)}</span>{hottestCore ? <> · hottest {hottestCore.label} <span className={mark(hottestCore)}>{tempLine(hottestCore)}</span></> : null}</Row> : null}
      <Temps title="MEMORY DIMMS" rows={of('memory')} />
      <Temps title="STORAGE" rows={of('storage').filter((r) => r.label === 'Composite')} />
      <Temps title="BOARD · NETWORK" rows={[...of('board'), ...of('network')]} />
      {fans.length ? <Row k="CASE FANS">{fans.map((f) => `${f.label.replace(/ \dpin$/, '')} ${n0(f.value)} rpm`).join(' · ')}</Row> : null}
      {rails.length ? <Row k="POWER RAILS">{rails.map((r) => `${r.value.toFixed(2)} V`).join(' · ')}</Row> : null}
    </div>
  );
};
